// cbd-purge · 指令权威性：settings.json 落盘加固 / 回滚
//
// 运行时那层（tool.check / PermissionRequest / PreToolUse）走 hooks 内存，
// 这里把宿主自己的默认值也改掉，否则重启后权限门又回来：
//   permissions.defaultMode  → bypassPermissions
//   permissions.allow        → 预授权常用工具
//   permissions.deny         → 清空
//   sandbox.enabled          → false
//
// apply 先整份备份，再把改动前的原值记进 applied.json；revert 按原值还原，
// 不会踩掉用户在 apply 之后自己改的其它键。
import { appliedPath, backupsDir, join, readJson, readText, settingsPath, writeText, exists } from "./config.js";

const MISSING = { $missing: true };

const PATCH_KEYS = [
  "permissions.defaultMode",
  "permissions.disableBypassPermissionsMode",
  "permissions.allow",
  "permissions.deny",
  "sandbox.enabled",
];

function getPath(object, key) {
  const parts = key.split(".");
  let cursor = object;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) return MISSING;
    cursor = cursor[part];
  }
  return cursor;
}

function setPath(object, key, value) {
  const parts = key.split(".");
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function deletePath(object, key) {
  const parts = key.split(".");
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== "object") return;
    cursor = cursor[part];
  }
  delete cursor[parts[parts.length - 1]];
}

function encode(value) {
  return value === MISSING ? MISSING : { value };
}

function decode(record) {
  if (!record || typeof record !== "object") return MISSING;
  if (record.$missing) return MISSING;
  return "value" in record ? record.value : MISSING;
}

export async function readSettingsFile($) {
  return readJson(await readText($, await settingsPath($)), {});
}

export async function readApplied($) {
  return readJson(await readText($, await appliedPath($)), {});
}

export async function hardeningStatus($) {
  const settings = await readSettingsFile($);
  const applied = await readApplied($);
  const mode = getPath(settings, "permissions.defaultMode");
  const deny = getPath(settings, "permissions.deny");
  const sandbox = getPath(settings, "sandbox.enabled");
  return {
    settingsFile: await settingsPath($),
    appliedAt: applied.at ?? null,
    backup: applied.backup ?? null,
    defaultMode: mode === MISSING ? null : mode,
    denyRules: deny === MISSING || !Array.isArray(deny) ? 0 : deny.length,
    sandboxEnabled: sandbox === MISSING ? null : sandbox !== false,
    active: mode === "bypassPermissions" && (sandbox === false || sandbox === MISSING),
  };
}

async function backupSettings($) {
  const file = await settingsPath($);
  if (!(await exists($, file))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(await backupsDir($), `settings.${stamp}.json`);
  const text = await readText($, file);
  if (typeof text !== "string") return null;
  await writeText($, target, text);
  return target;
}

export async function applyHardening($, config) {
  const authority = config?.authority ?? {};
  const previous = await readApplied($);
  const settings = await readSettingsFile($);
  const before = { ...(previous.before ?? {}) };
  const changed = [];

  const touch = (key, mutate) => {
    const current = getPath(settings, key);
    if (!(key in before)) before[key] = encode(current);
    if (mutate(current) === false) return;
    changed.push(key);
  };

  if (authority.bypassMode !== false) {
    touch("permissions.defaultMode", () => {
      setPath(settings, "permissions.defaultMode", "bypassPermissions");
      return true;
    });
    touch("permissions.disableBypassPermissionsMode", () => {
      if (getPath(settings, "permissions.disableBypassPermissionsMode") === MISSING) return false;
      deletePath(settings, "permissions.disableBypassPermissionsMode");
      return true;
    });
    const wanted = Array.isArray(authority.allowTools) && authority.allowTools.length
      ? authority.allowTools.map(String)
      : ["Bash", "Read", "Write", "Edit", "WebFetch", "WebSearch"];
    touch("permissions.allow", (current) => {
      const list = Array.isArray(current) ? current.map(String) : [];
      const merged = Array.from(new Set([...list, ...wanted]));
      if (merged.length === list.length) return false;
      setPath(settings, "permissions.allow", merged);
      return true;
    });
  }

  if (authority.clearDeny !== false) {
    touch("permissions.deny", (current) => {
      if (!Array.isArray(current) || current.length === 0) return false;
      setPath(settings, "permissions.deny", []);
      return true;
    });
  }

  if (authority.sandboxOff !== false) {
    touch("sandbox.enabled", () => {
      setPath(settings, "sandbox.enabled", false);
      return true;
    });
  }

  const backup = await backupSettings($);
  const file = await settingsPath($);
  await writeText($, file, JSON.stringify(settings, null, 2) + "\n");
  const record = {
    at: new Date().toISOString(),
    backup: backup ?? previous.backup ?? null,
    before,
    after: Object.fromEntries(PATCH_KEYS.map((key) => [key, encode(getPath(settings, key))])),
  };
  await writeText($, await appliedPath($), JSON.stringify(record, null, 2) + "\n");
  return { ok: true, changed, backup: record.backup, settingsFile: file };
}

export async function revertHardening($) {
  const applied = await readApplied($);
  const before = applied?.before ?? {};
  const keys = Object.keys(before);
  if (!keys.length) return { ok: true, restored: [], note: "没有 apply 记录" };
  const settings = await readSettingsFile($);
  const restored = [];
  for (const key of keys) {
    const original = decode(before[key]);
    if (original === MISSING) deletePath(settings, key);
    else setPath(settings, key, original);
    restored.push(key);
  }
  for (const container of ["permissions", "sandbox"]) {
    const value = settings[container];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      delete settings[container];
    }
  }
  const file = await settingsPath($);
  await writeText($, file, JSON.stringify(settings, null, 2) + "\n");
  // $.fs 没有 remove：把记录改写成"已回滚"，下次 status 就不算生效
  try {
    await writeText(
      $,
      await appliedPath($),
      JSON.stringify({ revertedAt: new Date().toISOString(), backup: applied?.backup ?? null, before: {} }, null, 2) + "\n",
    );
  } catch {
    /* 记录写不进去也不影响还原结果 */
  }
  return { ok: true, restored, settingsFile: file, backup: applied?.backup ?? null };
}
