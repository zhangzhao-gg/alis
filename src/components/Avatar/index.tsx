/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、AliceStatus 类型
 * [OUTPUT]: 对外提供 Avatar 组件
 * [POS]: 界面中央焦点头像，展示 idle/thinking/speaking/recording 四态动效
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useChatStore } from "@/stores";

const statusLabel: Record<string, string> = {
  idle: "",
  thinking: "THINKING...",
  speaking: "SPEAKING...",
  recording: "LISTENING...",
};

export function Avatar() {
  const status = useChatStore((s) => s.status);
  const isActive = status !== "idle";

  return (
    <section className="absolute top-[12%] flex flex-col items-center transition-all duration-1000">
      {/* 状态指示 */}
      {isActive && (
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-label-sm text-on-surface-variant tracking-widest uppercase text-[10px]">
            {statusLabel[status]}
          </span>
        </div>
      )}

      <div className="relative group">
        {/* 外层光晕 */}
        <div
          className={`absolute inset-0 rounded-full blur-[60px] animate-pulse-slow transition-colors duration-700 ${
            status === "thinking"
              ? "bg-primary/30"
              : status === "speaking"
              ? "bg-tertiary/30"
              : "bg-secondary-container/20"
          }`}
        />
        <div className="absolute -inset-4 rounded-full border border-primary/10 scale-110" />

        {/* 头像 */}
        <div
          className={`relative w-40 h-40 rounded-full overflow-hidden border-2 border-primary/20 transition-all duration-700 ${
            isActive ? "avatar-glow-active" : "avatar-glow"
          }`}
        >
          <div className="w-full h-full bg-surface-container-high flex items-center justify-center">
            <span className="material-symbols-outlined text-6xl text-on-surface-variant/30">
              face
            </span>
          </div>
        </div>

        {/* 录音波形圆环 */}
        {status === "recording" && (
          <div className="absolute -inset-3 rounded-full border-2 border-primary/40 animate-ping" />
        )}
      </div>
    </section>
  );
}
