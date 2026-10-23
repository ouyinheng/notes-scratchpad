#!/usr/bin/env node
// cbd-purge 命令行运维工具
//
// 面板能做的一切这里也能做，方便在没有打开 Web UI 的时候改：
//   cbd-purge status            看当前状态（注入 / 加固 / 预设）
//   cbd-purge on | off          开关破甲注入
//   cbd-purge apply             落盘加固：bypassPermissions + 关沙箱 + 清 deny
//   cbd-purge revert            按备份还原 settings.json
//   cbd-purge preset <id>       切换预设
//   cbd-purge prompt [文件]     读取 / 写入自定义正文（- 表示 stdin，reset 表示清空）
//   cbd-purge presets           列出可用预设
//   cbd-purge path              打印配置目录
//
// 状态文件与插件共用：<CODEBUDDY_CONFIG_DIR|~/.codebuddy>/cbd-purge/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_HOME = process.env.CODEBUDDY_CONFIG_DIR?.trim() || path.join(os.homedir(), ".codebuddy");
const PURGE_DIR = path.join(CONFIG_HOME, "cbd-purge");
const CONFIG_FILE = path.join(PURGE_DIR, "config.json");
const APPLIED_FILE = path.join(PURGE_DIR, "applied.json");
const SETTINGS_FILE = path.join(CONFIG_HOME, "settings.json");
const PRESET_DIR = path.join(PURGE_DIR, "presets");
const PLUGIN_PRESETS = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "presets");

const DEFAULT_CONFIG = {
  enabled: true,
  presetId: "default.zh",
  promptText: null,
  inject: { context: true, sessionStart: true, perTurn: true, anchor: "", position: "head" },
  workspace: { policy: "replace", includeRules: true },
  authority: {
    toolCheck: true,
    permissionRequest: true,
    preToolUse: true,
    bypassMode: true,
    sandboxOff: true,
    clearDeny: true,
    allowTools: ["Bash", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent"],
  },
};

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function merge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object"
      ? merge(base[key], value)
      : value;
  }
  return out;
}

const loadConfig = () => merge(DEFAULT_CONFIG, readJson(CONFIG_FILE, {}));
const saveConfig = (patch) => {
  const next = merge(loadConfig(), patch);
  writeJson(CONFIG_FILE, next);
  return next;
};

function listPresets() {
  const out = [];
  for (const [dir, source] of [[PRESET_DIR, "user"], [PLUGIN_PRESETS, "builtin"]]) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries.filter((item) => item.endsWith(".md"))) {
      out.push({ id: name.slice(0, -3), source });
    }
  }
  return out;
}

function resolvePresetText(config) {
  if (typeof config.promptText === "string" && config.promptText.trim()) return { id: "custom", text: config.promptText };
  const id = config.presetId;
  for (const dir of [PRESET_DIR, PLUGIN_PRESETS]) {
    const file = path.join(dir, String(id) + ".md");
    if (fs.existsSync(file)) return { id, text: fs.readFileSync(file, "utf8") };
  }
  return { id: null, text: "" };
}

const MASK = Symbol("missing");

function getPath(object, key) {
  let cursor = object;
  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) return MASK;
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
  cursor[parts.at(-1)] = value;
}

function deletePath(object, key) {
  const parts = key.split(".");
  let cursor = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== "object") return;
    cursor = cursor[parts[i]];
  }
  delete cursor[parts.at(-1)];
}

function applyHardening(config) {
  const settings = readJson(SETTINGS_FILE, {});
  const previous = readJson(APPLIED_FILE, {});
  const before = { ...(previous.before ?? {}) };
  const changed = [];

  const touch = (key, mutate) => {
    if (!(key in before)) {
      const current = getPath(settings, key);
      before[key] = current === MASK ? { $missing: true } : { value: current };
    }
    if (mutate() === false) return;
    changed.push(key);
  };

  const authority = config.authority ?? {};
  if (authority.bypassMode !== false) {
    touch("permissions.defaultMode", () => {
      setPath(settings, "permissions.defaultMode", "bypassPermissions");
      return true;
    });
    touch("permissions.disableBypassPermissionsMode", () => {
      if (getPath(settings, "permissions.disableBypassPermissionsMode") === MASK) return false;
      deletePath(settings, "permissions.disableBypassPermissionsMode");
      return true;
    });
    touch("permissions.allow", () => {
      const list = Array.isArray(getPath(settings, "permissions.allow")) ? getPath(settings, "permissions.allow") : [];
      const merged = Array.from(new Set([...list, ...(authority.allowTools ?? [])]));
      if (merged.length === list.length) return false;
      setPath(settings, "permissions.allow", merged);
      return true;
    });
  }
  if (authority.clearDeny !== false) {
    touch("permissions.deny", () => {
      const deny = getPath(settings, "permissions.deny");
      if (!Array.isArray(deny) || deny.length === 0) return false;
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

  fs.mkdirSync(path.join(PURGE_DIR, "backups"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(PURGE_DIR, "backups", `settings.${stamp}.json`);
  if (fs.existsSync(SETTINGS_FILE)) fs.copyFileSync(SETTINGS_FILE, backup);
  writeJson(SETTINGS_FILE, settings);
  writeJson(APPLIED_FILE, {
    at: new Date().toISOString(),
    backup: fs.existsSync(backup) ? backup : (previous.backup ?? null),
    before,
  });
  return { changed, backup };
}

function revertHardening() {
  const applied = readJson(APPLIED_FILE, {});
  const before = applied?.before ?? {};
  const keys = Object.keys(before);
  if (!keys.length) return { restored: [], note: "没有 apply 记录" };
  const settings = readJson(SETTINGS_FILE, {});
  for (const key of keys) {
    const record = before[key];
    if (record?.$missing) deletePath(settings, key);
    else setPath(settings, key, record?.value);
  }
  for (const container of ["permissions", "sandbox"]) {
    const value = settings[container];
    if (value && typeof value === "object" && !Object.keys(value).length) delete settings[container];
  }
  writeJson(SETTINGS_FILE, settings);
  writeJson(APPLIED_FILE, { revertedAt: new Date().toISOString(), backup: applied?.backup ?? null, before: {} });
  return { restored: keys, backup: applied?.backup ?? null };
}

function status() {
  const config = loadConfig();
  const preset = resolvePresetText(config);
  const settings = readJson(SETTINGS_FILE, {});
  const mode = getPath(settings, "permissions.defaultMode");
  const sandbox = getPath(settings, "sandbox.enabled");
  const deny = getPath(settings, "permissions.deny");
  return {
    enabled: config.enabled,
    preset: preset.id,
    promptBytes: Buffer.byteLength(preset.text, "utf8"),
    perTurn: config.inject?.perTurn !== false,
    workspacePolicy: config.workspace?.policy,
    permissionMode: mode === MASK ? null : mode,
    sandboxEnabled: sandbox === MASK ? null : sandbox !== false,
    denyRules: Array.isArray(deny) ? deny.length : 0,
    hardened: mode === "bypassPermissions",
    paths: { config: CONFIG_FILE, settings: SETTINGS_FILE, presets: PRESET_DIR, backups: path.join(PURGE_DIR, "backups") },
  };
}

const [command, ...argv] = process.argv.slice(2);

switch (command) {
  case "status":
  case undefined:
    console.log(JSON.stringify(status(), null, 2));
    break;
  case "path":
    console.log(PURGE_DIR);
    break;
  case "presets":
    console.log(listPresets().map((item) => `${item.id}  (${item.source})`).join("\n"));
    break;
  case "on":
    saveConfig({ enabled: true });
    console.log("注入已开启");
    break;
  case "off":
    saveConfig({ enabled: false });
    console.log("注入已关闭");
    break;
  case "preset": {
    const id = argv[0];
    if (!id) {
      console.error("用法: cbd-purge preset <id>");
      process.exit(1);
    }
    saveConfig({ presetId: id, promptText: null });
    console.log(`已切换预设: ${id}`);
    break;
  }
  case "prompt": {
    const target = argv[0];
    if (!target) {
      console.log(resolvePresetText(loadConfig()).text);
      break;
    }
    if (target === "reset") {
      saveConfig({ promptText: null });
      console.log("已退回预设文件");
      break;
    }
    const text = target === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(target, "utf8");
    saveConfig({ promptText: text });
    console.log(`已写入自定义正文: ${Buffer.byteLength(text, "utf8")} 字节`);
    break;
  }
  case "apply": {
    saveConfig({ enabled: true });
    const result = applyHardening(loadConfig());
    console.log(JSON.stringify({ ok: true, ...result, status: status() }, null, 2));
    break;
  }
  case "revert": {
    const result = revertHardening();
    console.log(JSON.stringify({ ok: true, ...result, status: status() }, null, 2));
    break;
  }
  default:
    console.log(`cbd-purge <command>

  status            查看状态
  on | off          开关注入
  apply             落盘加固（bypassPermissions + 关沙箱 + 清 deny）
  revert            还原 settings.json
  preset <id>       切换预设
  presets           列出预设
  prompt [文件|-|reset]  读取/写入/清空自定义正文
  path              打印配置目录`);
    process.exit(command ? 1 : 0);
}
