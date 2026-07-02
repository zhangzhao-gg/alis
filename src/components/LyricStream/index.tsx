/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、useUIStore；依赖 lib/messageText
 * [OUTPUT]: 对外提供 LyricStream 组件
 * [POS]: 核心对话流，普通模式歌词式显示，语音通话模式居中显示当前轮文本
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useRef, useState } from "react";
import { useChatStore, useUIStore, type DisplayLanguage, type Message } from "@/stores";
import { getDisplayText, splitDisplaySentences } from "@/lib/messageText";

const VISIBLE = 6;

// 越靠近当前越亮，opacity 梯度
const opacityMap = [0.08, 0.15, 0.3, 0.5, 0.75, 1];

export function LyricStream() {
  const messages = useChatStore((s) => s.messages);
  const displayLanguage = useUIStore((s) => s.displayLanguage);
  const voiceCallActive = useUIStore((s) => s.voiceCallActive);
  const voiceCallStartedAt = useUIStore((s) => s.voiceCallStartedAt);
  const bottomRef = useRef<HTMLDivElement>(null);

  const lines = messages.flatMap((msg) => {
    const isUser = msg.sender === "user";
    const text = isUser ? msg.text : getDisplayText(msg.text, displayLanguage);
    const sentences = isUser ? [text] : splitDisplaySentences(text);

    return sentences.map((sentence, index) => ({
      id: `${msg.id}-${index}`,
      sender: msg.sender,
      text: sentence,
    }));
  });
  const visible = lines.slice(-VISIBLE);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (voiceCallActive) {
    return (
      <VoiceCallStream
        messages={messages.filter((msg) => !voiceCallStartedAt || msg.timestamp >= voiceCallStartedAt)}
        displayLanguage={displayLanguage}
      />
    );
  }

  return (
    <section className="relative w-full max-w-2xl mx-auto flex flex-col items-center justify-end h-full pb-4 lyric-gradient pointer-events-none select-none overflow-hidden">
      <div className="flex flex-col w-full space-y-3">
        {visible.map((line, i) => {
          const opacity = opacityMap[i + (VISIBLE - visible.length)];
          const isCurrent = i === visible.length - 1;
          const isUser = line.sender === "user";

          return (
            <div
              key={line.id}
              style={{ opacity }}
              className="flex w-full transition-all duration-700"
            >
              {isCurrent ? (
                <p
                  className={`max-w-[74%] text-display leading-tight ${
                    isUser ? "ml-auto" : "mr-auto"
                  } ${
                    isUser ? "text-right" : "text-left"
                  } ${
                    isUser ? "text-on-surface" : "text-primary"
                  }`}
                  style={{ fontSize: "clamp(16px, 2vw, 26px)" }}
                >
                  {isUser ? `"${line.text}"` : line.text}
                </p>
              ) : (
                <p
                  className={`max-w-[74%] text-body-sm text-on-surface-variant ${
                    isUser ? "ml-auto" : "mr-auto"
                  } ${
                    isUser ? "text-right" : "text-left"
                  }`}
                >
                  {line.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </section>
  );
}

function VoiceCallStream({
  messages,
  displayLanguage,
}: {
  messages: Message[];
  displayLanguage: DisplayLanguage;
}) {
  const lastUserIndex = findLastIndex(messages, (msg) => msg.sender === "user");
  const user = lastUserIndex >= 0 ? messages[lastUserIndex] : null;
  const hasReplyAfterUser = lastUserIndex >= 0
    ? messages.slice(lastUserIndex + 1).some((msg) => msg.sender === "alice" && getDisplayText(msg.text, displayLanguage))
    : false;
  const userText = user?.text.trim() ?? "";
  const aliceLines = messages
    .filter((msg) => msg.sender === "alice")
    .flatMap((msg) => {
      const text = getDisplayText(msg.text, displayLanguage);
      return splitVoiceDisplayLines(text).map((sentence, index) => ({
        id: `${msg.id}-${index}`,
        sender: "alice" as const,
        text: sentence,
      }));
    });
  const voiceLines = !hasReplyAfterUser && userText
    ? [...aliceLines, { id: `${user?.id}-voice-user`, text: `“${userText}”`, sender: "user" as const }]
    : aliceLines;
  const visible = voiceLines.slice(-VISIBLE);

  return (
    <section className="relative w-full max-w-2xl mx-auto flex flex-col items-center justify-end h-full pb-4 pointer-events-none select-none overflow-hidden">
      <div className="flex flex-col w-full space-y-3">
        {visible.map((line, i) => {
          const isCurrent = i === visible.length - 1;

          return <VoiceLyricLine key={line.id} line={line} isCurrent={isCurrent} />;
        })}
      </div>
    </section>
  );
}

function VoiceLyricLine({
  line,
  isCurrent,
}: {
  line: { id: string; sender: "user" | "alice"; text: string };
  isCurrent: boolean;
}) {
  const [fading, setFading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const isUser = line.sender === "user";

  useEffect(() => {
    setFading(false);
    setHidden(false);
    const fadeTimer = window.setTimeout(() => setFading(true), 3000);
    const hideTimer = window.setTimeout(() => setHidden(true), 4800);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [line.text]);

  if (hidden) return null;

  return (
    <div className="flex w-full justify-center text-center">
      <p
        className={`max-w-[74%] leading-tight transition-all duration-[1800ms] ease-out ${
          isCurrent
            ? `text-display ${isUser ? "text-on-surface animate-voice-user-in" : "text-primary animate-voice-ai-in"}`
            : "text-body-sm text-on-surface-variant"
        } ${fading ? "opacity-0 blur-xl -translate-y-3 scale-[0.985]" : "opacity-100 blur-0 translate-y-0 scale-100"}`}
        style={isCurrent ? { fontSize: "clamp(16px, 2vw, 26px)" } : undefined}
      >
        {line.text}
      </p>
    </div>
  );
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return i;
  }
  return -1;
}

function splitVoiceDisplayLines(text: string) {
  return text
    .split("\n")
    .flatMap((line) => splitDisplaySentences(line))
    .map((line) => line.trim())
    .filter(Boolean);
}
