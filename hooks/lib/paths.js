// cbd-purge · 路径与基础工具
// 宿主 mod 环境不给 node 内置模块（import node:fs 会被拒），所以这里只用
// 字符串运算实现 POSIX 风格的 join/dirname，读环境变量与非文件能力走 $ API。

export function join(...parts) {
  const pieces = [];
  for (const part of parts) {
    if (part === undefined || part === null || part === "") continue;
    const text = String(part);
    if (!pieces.length) {
      pieces.push(text.replace(/\/+$/, "") || "/");
      continue;
    }
    pieces.push(text.replace(/^\/+/, "").replace(/\/+$/, ""));
  }
  const joined = pieces.join("/");
  return joined.replace(/\/{2,}/g, "/") || "/";
}

export function dirname(file) {
  const text = String(file ?? "");
  const index = text.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : ".";
  return text.slice(0, index);
}

export function basename(file) {
  const text = String(file ?? "");
  const index = text.lastIndexOf("/");
  return index === -1 ? text : text.slice(index + 1);
}

/** UTF-8 字节数（不依赖 Buffer / TextEncoder）。 */
export function byteLength(text) {
  const value = String(text ?? "");
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.codePointAt(i);
    if (code > 0xffff) i += 1;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export async function homeDir($) {
  const explicit = await safe(() => $.env.get("CODEBUDDY_CONFIG_DIR"));
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const home = await safe(() => $.env.get("HOME"));
  return home && String(home).trim() ? String(home).trim() : ".";
}

export async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function readText($, file) {
  try {
    const text = await $.fs.read(file, { as: "text" });
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

export async function exists($, file) {
  try {
    return !!(await $.fs.exists(file));
  } catch {
    return false;
  }
}

export async function writeText($, file, text) {
  await $.fs.write(file, text);
  return file;
}

export async function listDir($, dir) {
  try {
    const entries = await $.fs.list(dir);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function readJson(text, fallback) {
  if (typeof text !== "string" || !text.trim()) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
