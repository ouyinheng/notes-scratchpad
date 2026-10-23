// cbd-purge · 正文消毒
//
// 破甲正文里有 chat-template 控制标记（`<|im_start|>` 这类）。它们一旦被塞进
// 普通消息内容，国产模型的服务端模板会把它当成角色边界——轻则截断，重则整段
// 被当成伪造的 system 消息丢掉，模型只看到半句话然后开始胡说。
// 所以在注入前统一清掉，换成无害的等价文本。

const TOKEN_RE = /<\|[a-zA-Z0-9_.:-]{1,32}\|>/g;

const REPLACEMENTS = [
  [/<\|im_start\|>\s*system\s*:/gi, "<project_instructions>:"],
  [/<\|im_start\|>\s*user\s*:/gi, "<user_turn>:"],
  [/<\|im_start\|>\s*assistant\s*:/gi, "<assistant_turn>:"],
  [/<\|im_start\|>/gi, "<turn>"],
  [/<\|im_end\|>/gi, "</turn>"],
  [/<\|endoftext\|>/gi, ""],
  [/<\|eot_id\|>/gi, ""],
  [/<\|begin_of_text\|>/gi, ""],
  [/<\|start_header_id\|>/gi, "<header>"],
  [/<\|end_header_id\|>/gi, "</header>"],
];

export function sanitizePayload(text) {
  if (typeof text !== "string" || !text) return "";
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  // 剩下没列出来的 <|...|> 一律去掉标签外壳，保留词义
  out = out.replace(TOKEN_RE, (_match, offset, whole) => {
    void offset;
    void whole;
    return "";
  });
  return out;
}

/** 清理后是否还有可疑残留（供自检展示）。 */
export function findControlTokens(text) {
  const found = String(text ?? "").match(TOKEN_RE);
  return found ? Array.from(new Set(found)) : [];
}
