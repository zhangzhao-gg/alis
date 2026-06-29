import type { DisplayLanguage, Emotion } from "@/stores";

const VALID_EMOTIONS = new Set<Emotion>([
  "平静", "微笑", "开心笑", "大笑", "害羞", "害羞笑", "得意",
  "思考", "疑惑", "惊讶", "震惊", "郁闷", "不爽", "生气", "大哭", "睡觉",
]);

interface ParsedReply {
  ja: string;
  zh: string;
  emotion: Emotion | null;
}

function parseReply(text: string): ParsedReply {
  // JSON 格式优先
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const emotion = VALID_EMOTIONS.has(obj.emotion) ? obj.emotion as Emotion : null;
      return { ja: obj.ja ?? "", zh: obj.zh ?? "", emotion };
    } catch {
      // fall through to pipe
    }
  }

  // pipe 格式兜底（兼容旧消息）
  const parts = text.split("|");
  if (parts.length >= 2) {
    const emotion = parts.length >= 3 && VALID_EMOTIONS.has(parts[2].trim() as Emotion)
      ? parts[2].trim() as Emotion
      : null;
    return { ja: parts[0] ?? "", zh: parts[1] ?? "", emotion };
  }

  return { ja: text, zh: text, emotion: null };
}

export function getEmotion(text: string): Emotion | null {
  return parseReply(text).emotion;
}

export function getSpokenText(text: string) {
  return stripBracketedText(parseReply(text).ja).trim();
}

export function getDisplayText(text: string, language: DisplayLanguage) {
  const { ja, zh } = parseReply(text);
  const displayText = language === "ja" ? ja : zh || ja;
  return stripBracketedText(displayText).trim();
}

export function splitDisplaySentences(text: string) {
  const normalized = text.trim();
  if (!normalized) return [];

  return normalized
    .match(/.+?(?:。|！|!|？|\?|…+|\.{2,}|[.](?!\d)|$)/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [normalized];
}

function stripBracketedText(text: string) {
  return text
    .replace(/\([^()]*\)/g, "")
    .replace(/（[^（）]*）/g, "")
    .replace(/\[[^\[\]]*\]/g, "")
    .replace(/【[^【】]*】/g, "")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/｛[^｛｝]*｝/g, "")
    .replace(/\s+/g, " ");
}
