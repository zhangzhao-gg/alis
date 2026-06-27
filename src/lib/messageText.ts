import type { DisplayLanguage } from "@/stores";

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
