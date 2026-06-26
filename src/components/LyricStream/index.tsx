/**
 * [INPUT]: 依赖 stores/index 的 useChatStore
 * [OUTPUT]: 对外提供 LyricStream 组件
 * [POS]: 核心对话流，歌词式渐进显示最近 6 条消息
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores";

const VISIBLE = 6;

// 越靠近当前越亮，opacity 梯度
const opacityMap = [0.08, 0.15, 0.3, 0.5, 0.75, 1];

export function LyricStream() {
  const messages = useChatStore((s) => s.messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = messages.slice(-VISIBLE);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <section className="relative w-full max-w-3xl mx-auto flex flex-col items-center justify-end h-full pb-4 lyric-gradient pointer-events-none select-none">
      <div className="flex flex-col items-center text-center w-full space-y-6 px-8">
        {visible.map((msg, i) => {
          const opacity = opacityMap[i + (VISIBLE - visible.length)];
          const isCurrent = i === visible.length - 1;
          const isUser = msg.sender === "user";

          return (
            <div
              key={msg.id}
              style={{ opacity }}
              className={`transition-all duration-700 w-full ${
                isCurrent ? "py-4" : ""
              }`}
            >
              {isCurrent ? (
                <p
                  className={`text-display leading-tight text-glow px-4 ${
                    isUser ? "text-on-surface" : "text-primary"
                  }`}
                  style={{ fontSize: "clamp(24px, 4vw, 48px)" }}
                >
                  {isUser ? `"${msg.text}"` : msg.text}
                </p>
              ) : (
                <p className="text-body-lg text-on-surface-variant">
                  {msg.text}
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
