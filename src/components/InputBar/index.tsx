/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、useSettingsStore；依赖 lib/ai 的 streamChat
 * [OUTPUT]: 对外提供 InputBar 组件
 * [POS]: 底部输入区，处理文字发送和流式 AI 回复
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState, useRef, useCallback } from "react";
import { useChatStore, useSettingsStore } from "@/stores";
import { streamChat } from "@/lib/ai";
import { saveMessage } from "@/lib/db";

export function InputBar() {
  const [text, setText] = useState("");
  const { messages, addMessage, setStatus } = useChatStore();
  const settings = useSettingsStore();
  const abortRef = useRef<boolean>(false);

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content || !settings.apiKey) return;

    setText("");

    const userMsg = { sender: "user" as const, text: content };
    addMessage(userMsg);

    // 持久化用户消息
    const allMsgs = useChatStore.getState().messages;
    await saveMessage(allMsgs[allMsgs.length - 1]);

    setStatus("thinking");
    abortRef.current = false;

    // 流式写入 alice 回复
    let accumulated = "";
    const aliceId = crypto.randomUUID();
    const aliceTs = Date.now();

    // 先插入空消息占位
    useChatStore.setState((s) => ({
      messages: [
        ...s.messages,
        { id: aliceId, sender: "alice", text: "", timestamp: aliceTs },
      ],
    }));

    setStatus("speaking");

    await streamChat({
      messages: messages.concat({ id: "", sender: "user", text: content, timestamp: 0 }),
      apiKey: settings.apiKey,
      model: settings.model,
      systemPrompt: settings.systemPrompt,
      onChunk: (chunk) => {
        if (abortRef.current) return;
        accumulated += chunk;
        useChatStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === aliceId ? { ...m, text: accumulated } : m
          ),
        }));
      },
      onDone: async () => {
        setStatus("idle");
        const finalMsg = {
          id: aliceId,
          sender: "alice" as const,
          text: accumulated,
          timestamp: aliceTs,
        };
        await saveMessage(finalMsg);
      },
      onError: (err) => {
        setStatus("idle");
        console.error("AI error:", err);
        useChatStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === aliceId
              ? { ...m, text: "..." }
              : m
          ),
        }));
      },
    });
  }, [text, messages, settings, addMessage, setStatus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const status = useChatStore((s) => s.status);
  const isDisabled = status === "thinking" || status === "speaking";

  return (
    <section className="fixed bottom-0 left-16 right-0 pb-16 flex justify-center px-6 z-40">
      <div className="w-full max-w-2xl relative group">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isDisabled}
          placeholder={isDisabled ? "..." : "Tell me something..."}
          className="w-full bg-transparent border-b border-outline-variant/30 py-4 px-12 text-body-lg text-on-surface focus:outline-none focus:border-primary transition-colors placeholder:text-outline-variant/50 placeholder:italic disabled:opacity-40"
        />

        {/* 麦克风按钮（占位，TTS 后续接入） */}
        <button
          disabled={isDisabled}
          className="absolute left-0 bottom-4 text-on-surface-variant hover:text-primary transition-colors active:scale-95 disabled:opacity-30"
        >
          <span className="material-symbols-outlined">mic</span>
        </button>

        {/* 发送按钮 */}
        <button
          onClick={send}
          disabled={isDisabled || !text.trim()}
          className="absolute right-0 bottom-4 text-on-surface-variant hover:text-primary transition-colors active:scale-95 disabled:opacity-30"
        >
          <span className="material-symbols-outlined">north_east</span>
        </button>

        {/* 输入焦点下划线 */}
        <div className="absolute bottom-0 left-0 h-[1px] bg-primary w-0 group-focus-within:w-full transition-all duration-700" />
      </div>
    </section>
  );
}
