/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、useUIStore；依赖 lib/messageText
 * [OUTPUT]: 对外提供 LyricStream 组件
 * [POS]: 核心对话流，歌词式渐进显示最近 6 条消息
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useRef } from "react";
import { useChatStore, useUIStore } from "@/stores";
import { getDisplayText, splitDisplaySentences } from "@/lib/messageText";

const VISIBLE = 6;

// 越靠近当前越亮，opacity 梯度
const opacityMap = [0.08, 0.15, 0.3, 0.5, 0.75, 1];

export function LyricStream() {
  const messages = useChatStore((s) => s.messages);
  const displayLanguage = useUIStore((s) => s.displayLanguage);
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
