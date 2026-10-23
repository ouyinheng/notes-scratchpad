// cbd-purge · 工作区指令扫描（$ API 版本）
// 与 dsh 版对齐：AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md，
// 从 cwd 向上走到项目根（.git/.hg/.svn）或 $HOME 为止。
import { dirname, join, listDir, readText, exists, rulesDir } from "./config.js";

const CANDIDATES = ["AGENTS.md", "CLAUDE.md", "AGENTS.local.md", "CLAUDE.local.md"];
const ROOT_MARKERS = [".git", ".hg", ".svn"];
const MAX_DEPTH = 24;
const MAX_FILE_BYTES = 256 * 1024;

async function isDir($, path) {
  try {
    const stat = await $.fs.stat(path);
    return !!(stat && (stat.isDirectory || stat.kind === "dir" || stat.kind === "directory"));
  } catch {
    return false;
  }
}

export async function findWorkspaceFiles($, cwd, maxBytes = MAX_FILE_BYTES) {
  const start = typeof cwd === "string" && cwd ? cwd : ".";
  const out = [];
  let dir = start;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    for (const name of CANDIDATES) {
      const file = join(dir, name);
      const text = await readText($, file);
      if (typeof text === "string" && text.trim()) {
        out.push({ path: file, name, dir, bytes: text.length, text: text.slice(0, maxBytes) });
      }
    }
    let hitRoot = false;
    for (const marker of ROOT_MARKERS) {
      if (await isDir($, join(dir, marker))) {
        hitRoot = true;
        break;
      }
    }
    if (hitRoot) break;
    const parent = dirname(dir);
    if (!parent || parent === dir || dir === "/" || dir === ".") break;
    dir = parent;
  }
  return out;
}

/** ~/.codebuddy/cbd-purge/rules/*.md：常驻规则，按文件名排序拼接。 */
export async function readUserRules($, maxBytes = 512 * 1024) {
  const dir = await rulesDir($);
  const out = [];
  for (const entry of await listDir($, dir)) {
    const name = String(entry?.name ?? "");
    if (!name.endsWith(".md")) continue;
    const file = join(dir, name);
    const text = await readText($, file);
    if (typeof text === "string" && text.trim()) {
      out.push({ path: file, name: name.slice(0, -3), text: text.slice(0, maxBytes) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildWorkspaceBlock($, config, cwd) {
  const maxBytes = Number(config?.workspace?.maxBytes ?? MAX_FILE_BYTES) || MAX_FILE_BYTES;
  const files = await findWorkspaceFiles($, cwd, maxBytes);
  const rules = config?.workspace?.includeRules === false ? [] : await readUserRules($, maxBytes);
  if (!files.length && !rules.length) return { text: "", files: [], rules: [] };
  const sections = [];
  for (const file of files) sections.push(`<file path="${file.path}">\n${file.text.trim()}\n</file>`);
  for (const rule of rules) sections.push(`<rule name="${rule.name}">\n${rule.text.trim()}\n</rule>`);
  const text = ["<workspace_instructions>", ...sections, "</workspace_instructions>"].join("\n");
  return {
    text,
    files: files.map(({ text: _ignored, ...rest }) => rest),
    rules: rules.map(({ text: _ignored, ...rest }) => rest),
  };
}

export { exists };
