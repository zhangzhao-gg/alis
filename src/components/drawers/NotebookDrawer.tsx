/**
 * [INPUT]: 依赖 stores/index 的 useChatStore
 * [OUTPUT]: 对外提供 NotebookDrawer 组件
 * [POS]: drawers/ 之聊天记录本抽屉，按会话分组展示历史
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState } from "react";
import { useChatStore } from "@/stores";

export function NotebookDrawer() {
  const messages = useChatStore((s) => s.messages);
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? messages.filter((m) => m.text.toLowerCase().includes(query.toLowerCase()))
    : messages;

  return (
    <div className="flex flex-col h-full">
      <div className="p-10 pb-4">
        <h2 className="serif-journal text-3xl text-tertiary italic tracking-tight flex items-center gap-3 mb-2">
          <span className="material-symbols-outlined text-tertiary/40">auto_stories</span>
          The Notebook
        </h2>
        <p className="text-label-sm text-outline italic mb-6">
          Chronicles of shared resonance and digital echoes.
        </p>

        <div className="relative group">
          <span className="material-symbols-outlined absolute left-0 top-1/2 -translate-y-1/2 text-outline-variant text-sm group-focus-within:text-tertiary transition-colors">
            search
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Recall a memory..."
            className="w-full bg-transparent border-b border-outline-variant/20 pl-6 pr-4 py-2 text-label-md focus:outline-none focus:border-tertiary/40 transition-all placeholder:text-outline-variant/30 italic"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto notebook-mask px-10">
        {filtered.length === 0 ? (
          <p className="text-body-md text-on-surface-variant/40 italic mt-8 text-center">
            {query ? "No matches found." : "No conversations yet."}
          </p>
        ) : (
          <div className="space-y-10 pb-20">
            {filtered.map((msg) => (
              <article key={msg.id} className="grid grid-cols-[80px_1fr] gap-6 group cursor-pointer">
                <div className="flex flex-col items-end pt-1">
                  <span className="text-[10px] text-tertiary/40 uppercase tracking-tight">
                    {new Date(msg.timestamp).toLocaleDateString("zh", { month: "short", day: "numeric" })}
                  </span>
                  <span className="text-label-md text-on-surface/30 font-light">
                    {new Date(msg.timestamp).toLocaleTimeString("zh", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div>
                  <p
                    className={`text-body-md leading-relaxed line-clamp-3 ${
                      msg.sender === "alice"
                        ? "text-on-surface-variant/80 serif-journal italic"
                        : "text-on-surface/60"
                    }`}
                  >
                    {msg.text}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="p-10 border-t border-outline-variant/5">
        <button className="w-full bg-tertiary/5 border border-tertiary/20 hover:bg-tertiary/10 transition-all py-4 flex items-center justify-center gap-3 text-tertiary text-label-md uppercase tracking-[0.2em] group active:scale-[0.98]">
          <span className="material-symbols-outlined text-sm group-hover:rotate-180 transition-transform duration-700">
            ink_pen
          </span>
          Harmonize Archive
        </button>
      </div>
    </div>
  );
}
