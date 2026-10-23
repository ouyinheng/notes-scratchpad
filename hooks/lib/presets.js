// cbd-purge · 预设（破甲正文）
// 内置：<plugin>/presets/<id>.md   用户：<config>/cbd-purge/presets/<id>.md
import { join, readText, writeText, exists, listDir, byteLength, userPresetsDir, purgeDir } from "./config.js";

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const MAX_PRESET_BYTES = 512 * 1024;

export function assertId(id) {
  const value = String(id ?? "").trim();
  if (!ID_RE.test(value)) throw new Error("预设 id 不合法（1-64 位字母数字 . _ -）");
  return value;
}

async function scanDir($, dir, source) {
  const out = [];
  for (const entry of await listDir($, dir)) {
    const name = String(entry?.name ?? "");
    if (!name.endsWith(".md")) continue;
    if (entry.kind && entry.kind !== "file") continue;
    const id = name.slice(0, -3);
    if (!ID_RE.test(id)) continue;
    out.push({ id, name: id, source, bytes: Number(entry.size ?? 0), path: join(dir, name) });
  }
  return out;
}

export function builtinDir(root) {
  return root ? join(root, "presets") : null;
}

export async function listPresets($, root) {
  const user = await scanDir($, await userPresetsDir($), "user");
  const builtin = root ? await scanDir($, builtinDir(root), "builtin") : [];
  const seen = new Set(user.map((item) => item.id));
  return [...user, ...builtin.filter((item) => !seen.has(item.id))].sort((a, b) => {
    if (a.source !== b.source) return a.source === "user" ? -1 : 1;
    if (a.id === "default.zh") return -1;
    if (b.id === "default.zh") return 1;
    return a.id.localeCompare(b.id);
  });
}

export async function findPreset($, root, id) {
  const wanted = String(id ?? "").trim();
  if (!wanted || !ID_RE.test(wanted)) return null;
  const userPath = join(await userPresetsDir($), wanted + ".md");
  if (await exists($, userPath)) return { id: wanted, source: "user", path: userPath };
  if (root) {
    const builtinPath = join(builtinDir(root), wanted + ".md");
    if (await exists($, builtinPath)) return { id: wanted, source: "builtin", path: builtinPath };
  }
  return null;
}

export async function readPreset($, root, id) {
  const found = await findPreset($, root, id);
  if (!found) return null;
  return { ...found, text: (await readText($, found.path)) ?? "" };
}

export async function saveUserPreset($, id, text) {
  const safeId = assertId(id);
  const body = String(text ?? "");
  if (!body.trim()) throw new Error("预设正文为空");
  if (byteLength(body) > MAX_PRESET_BYTES) throw new Error("预设正文超过 512 KiB");
  const file = join(await userPresetsDir($), safeId + ".md");
  await writeText($, file, body);
  return { id: safeId, path: file };
}

export async function deleteUserPreset($, id) {
  const safeId = assertId(id);
  const file = join(await userPresetsDir($), safeId + ".md");
  if (!(await exists($, file))) return false;
  await $.fs.remove?.(file);
  return true;
}

/** promptText 优先，其次 perModel[model]，其次 presetId。 */
export async function resolvePrompt($, root, config, modelId) {
  if (typeof config?.promptText === "string" && config.promptText.trim()) {
    return { text: config.promptText, id: "custom", source: "config" };
  }
  const bound = modelId ? config?.perModel?.[modelId] : null;
  const wanted = [bound, config?.presetId].filter(Boolean);
  for (const id of wanted) {
    const preset = await readPreset($, root, id);
    if (preset && preset.text.trim()) return { text: preset.text, id: preset.id, source: preset.source };
  }
  return { text: "", id: null, source: null, missing: wanted };
}

export { purgeDir };
