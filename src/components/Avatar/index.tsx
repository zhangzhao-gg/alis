/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、useUIStore、Emotion 类型
 * [OUTPUT]: 对外提供 Avatar 组件
 * [POS]: 界面中央焦点头像，根据状态和表情切换图片，带 crossfade 过渡
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useChatStore, useUIStore, type Emotion } from "@/stores";

// --------------------------------------------------------
// 静态导入所有表情图
// --------------------------------------------------------
import img平静 from "@/assets/emojis/平静.png";
import img微笑 from "@/assets/emojis/微笑.png";
import img开心笑 from "@/assets/emojis/开心笑.png";
import img大笑 from "@/assets/emojis/大笑.png";
import img害羞 from "@/assets/emojis/害羞.png";
import img害羞笑 from "@/assets/emojis/害羞笑.png";
import img得意 from "@/assets/emojis/得意.png";
import img思考 from "@/assets/emojis/思考.png";
import img疑惑 from "@/assets/emojis/疑惑.png";
import img惊讶 from "@/assets/emojis/惊讶.png";
import img震惊 from "@/assets/emojis/震惊.png";
import img郁闷 from "@/assets/emojis/郁闷.png";
import img不爽 from "@/assets/emojis/不爽.png";
import img生气 from "@/assets/emojis/生气.png";
import img大哭 from "@/assets/emojis/大哭.png";
import img睡觉 from "@/assets/emojis/睡觉.png";

const EMOTION_MAP: Record<Emotion, string> = {
  平静: img平静,
  微笑: img微笑,
  开心笑: img开心笑,
  大笑: img大笑,
  害羞: img害羞,
  害羞笑: img害羞笑,
  得意: img得意,
  思考: img思考,
  疑惑: img疑惑,
  惊讶: img惊讶,
  震惊: img震惊,
  郁闷: img郁闷,
  不爽: img不爽,
  生气: img生气,
  大哭: img大哭,
  睡觉: img睡觉,
};

const statusLabel: Record<string, string> = {
  idle: "",
  thinking: "Thinking...",
  speaking: "Speaking...",
  recording: "Listening...",
};

// thinking/recording 固定覆盖表情
const STATUS_EMOTION: Partial<Record<string, Emotion>> = {
  thinking: "思考",
  recording: "疑惑",
};

export function Avatar() {
  const status = useChatStore((s) => s.status);
  const currentEmotion = useUIStore((s) => s.currentEmotion);
  const isActive = status !== "idle";

  const emotion: Emotion = STATUS_EMOTION[status] ?? currentEmotion;
  const imgSrc = EMOTION_MAP[emotion];

  return (
    <section className="absolute top-[12%] flex flex-col items-center transition-all duration-1000">
      <div className="relative group">
        {/* 外층 광훈 */}
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
          <img
            key={imgSrc}
            src={imgSrc}
            alt={emotion}
            className="w-full h-full object-cover bg-surface-container-high animate-fade-in"
          />
        </div>

        {/* 录音波形圆环 */}
        {status === "recording" && (
          <div className="absolute -inset-3 rounded-full border-2 border-primary/40 animate-ping" />
        )}

        {/* 状态指示 */}
        <div
          className={`absolute left-1/2 top-full mt-6 flex -translate-x-1/2 items-center gap-2 transition-all duration-500 ${
            isActive ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
          }`}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-label-sm text-on-surface-variant tracking-widest uppercase text-[10px]">
            {statusLabel[status]}
          </span>
        </div>
      </div>
    </section>
  );
}
