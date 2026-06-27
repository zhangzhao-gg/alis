import type { DisplayLanguage, Emotion } from "@/stores";

const VALID_EMOTIONS = new Set<Emotion>([
  "平静", "微笑", "开心笑", "大笑", "害羞", "害羞笑", "得意",
  "思考", "疑惑", "惊讶", "震惊", "郁闷", "不爽", "生气", "大哭", "睡觉",
]);

export function getEmotion(text: string): Emotion | null {
  const parts = text.split("|");
  if (parts.length < 3) return null;
  const candidate = parts[2].trim() as Emotion;
  return VALID_EMOTIONS.has(candidate) ? candidate : null;
}

export function getSpokenText(text: string) {
  return stripBracketedText(splitBilingualText(text).ja).trim();
}

export function getDisplayText(text: string, language: DisplayLanguage) {
  const parts = splitBilingualText(text);
  const displayText = language === "ja" ? parts.ja : parts.zh || parts.ja;
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

function splitBilingualText(text: string) {
  const separatorIndex = text.indexOf("|");
  if (separatorIndex === -1) {
    return { ja: text, zh: text };
  }

  return {
    ja: text.slice(0, separatorIndex),
    zh: text.slice(separatorIndex + 1),
  };
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
