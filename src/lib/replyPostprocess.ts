/**
 * [INPUT]: 依赖模型输出的原始文本
 * [OUTPUT]: 对外提供 cleanModelReply，清洗模型回复中的协议标签
 * [POS]: lib 层的大模型输出后处理，确保入库、展示、TTS 前内容干净
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const TIME_TAG_RE = /<time>[\s\S]*?<\/time>/gi;

export function cleanModelReply(raw: string) {
  const withoutTimeTags = stripTimeTags(raw);
  const jsonMatch = withoutTimeTags.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return normalizeWhitespace(withoutTimeTags);

  try {
    const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const cleaned = Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        typeof value === "string" ? normalizeWhitespace(stripTimeTags(value)) : value,
      ])
    );
    return JSON.stringify(cleaned);
  } catch {
    return normalizeWhitespace(withoutTimeTags);
  }
}

function stripTimeTags(text: string) {
  return text.replace(TIME_TAG_RE, "");
}

function normalizeWhitespace(text: string) {
  return text.replace(/[ \t]+\n/g, "\n").trim();
}
