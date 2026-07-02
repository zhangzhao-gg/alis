/**
 * [INPUT]: 依赖所有组件；依赖 lib/db 的 getMessages、getMemories、getSettings、clearMessages；依赖 stores
 * [OUTPUT]: 对外提供 App 根组件
 * [POS]: 应用入口，组装布局，启动时加载持久化数据，并定时压缩空闲对话
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect, useRef } from "react";
import { SideNav } from "@/components/SideNav";
import { Avatar } from "@/components/Avatar";
import { LyricStream } from "@/components/LyricStream";
import { InputBar } from "@/components/InputBar";
import { DebugOverlay } from "@/components/DebugOverlay";
import { DrawerPanel } from "@/components/drawers/DrawerPanel";
import { useChatStore, useMemoryStore, useSettingsStore, useUIStore, type DisplayLanguage } from "@/stores";
import { clearMessages, getMessages, getMemories, getSettings, getAffinity } from "@/lib/db";
import { getCharacterStatus, STATUS_LABEL } from "@/lib/persona";
import { forceDistillMessages } from "@/lib/memory";

const IDLE_COMPACT_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_COMPACT_AFTER_MS = 30 * 60 * 1000;

export default function App() {
  const setFragments = useMemoryStore((s) => s.setFragments);
  const debugOverlay = useSettingsStore((s) => s.debugOverlay);
  const idleCompactRunningRef = useRef(false);

  // 启动时从 SQLite 恢复数据
  useEffect(() => {
    getMessages()
      .then((msgs) => useChatStore.setState({ messages: msgs }))
      .catch(() => {}); // Tauri 环境外（纯浏览器预览）静默失败

    getMemories()
      .then(setFragments)
      .catch(() => {});

    getAffinity()
      .then((n) => useMemoryStore.getState().setAffinity(n))
      .catch(() => {});

    getSettings()
      .then((settings) => {
        if (settings) useSettingsStore.getState().update(settings);
      })
      .catch(() => {});
  }, []);

  // 应用保持打开时，超过 30 分钟无交流才压缩并清空主页对话。
  useEffect(() => {
    const checkIdleAndCompact = async () => {
      if (idleCompactRunningRef.current) return;

      const { messages, status, clearMessages: clearChat } = useChatStore.getState();
      if (!messages.length || status !== "idle") return;

      const lastMessage = messages[messages.length - 1];
      if (Date.now() - lastMessage.timestamp < IDLE_COMPACT_AFTER_MS) return;

      const { apiKey, model } = useSettingsStore.getState();
      if (!apiKey) return;

      idleCompactRunningRef.current = true;
      try {
        const compacted = await forceDistillMessages(messages, apiKey, model);
        if (!compacted) return;

        clearChat();
        await clearMessages();
      } finally {
        idleCompactRunningRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void checkIdleAndCompact();
    }, IDLE_COMPACT_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {/* 左侧书签导航 */}
      <SideNav />

      {/* 抽屉面板 */}
      <DrawerPanel />

      {/* 主画布 */}
      <main className="relative z-10 flex flex-col items-center justify-center h-full w-full pl-16">
        {/* 顶部状态栏 */}
        <TopBar />

        {/* 头像 */}
        <Avatar />

        {/* 歌词流对话区 */}
        <div className="absolute top-[42%] bottom-32 left-16 right-0 flex justify-center">
          <LyricStream />
        </div>
      </main>

      {/* 底部输入区 */}
      <InputBar />
      {debugOverlay && <DebugOverlay />}

      {/* 页脚 */}
      <footer className="fixed bottom-0 right-0 px-16 py-2 pointer-events-none z-50">
        <div className="flex gap-6 opacity-30 hover:opacity-70 transition-opacity pointer-events-auto">
          <span className="text-label-sm text-outline">© Yamada. A quiet space.</span>
        </div>
      </footer>
    </div>
  );
}

function TopBar() {
  const status = useChatStore((s) => s.status);
  const personaMode = useSettingsStore((s) => s.personaMode);
  const displayLanguage = useUIStore((s) => s.displayLanguage);
  const setDisplayLanguage = useUIStore((s) => s.setDisplayLanguage);

  const characterStatus = STATUS_LABEL[getCharacterStatus(personaMode)];

  return (
    <header className="fixed top-0 left-16 right-0 z-40 flex justify-between items-center px-16 py-3 backdrop-blur-md bg-background/20">
      <div className="flex items-center gap-2 h-6">
        {status !== "idle" ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-label-sm text-on-surface-variant tracking-widest uppercase text-[10px]">
              {status === "thinking" ? "Thinking..." : status === "speaking" ? "Speaking..." : "Listening..."}
            </span>
          </>
        ) : (
          <span className="text-label-sm text-on-surface-variant tracking-widest text-[10px]">
            {characterStatus}
          </span>
        )}
      </div>
      <div className="flex items-center gap-5">
        <div className="flex border border-outline-variant/20">
          {[
            ["zh", "中文"],
            ["ja", "日本語"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setDisplayLanguage(value as DisplayLanguage)}
              className={`px-3 py-1 text-[10px] uppercase tracking-[0.16em] transition-colors ${
                displayLanguage === value
                  ? "bg-primary/85 text-on-primary"
                  : "text-outline hover:text-on-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-label-sm text-outline uppercase tracking-[0.2em]">
          {new Date().toLocaleString("en", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </header>
  );
}
