/**
 * [INPUT]: 依赖所有组件；依赖 lib/db 的 getMessages、getMemories；依赖 stores
 * [OUTPUT]: 对外提供 App 根组件
 * [POS]: 应用入口，组装布局，启动时加载持久化数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useEffect } from "react";
import { SideNav } from "@/components/SideNav";
import { Avatar } from "@/components/Avatar";
import { LyricStream } from "@/components/LyricStream";
import { InputBar } from "@/components/InputBar";
import { DrawerPanel } from "@/components/drawers/DrawerPanel";
import { useChatStore, useMemoryStore } from "@/stores";
import { getMessages, getMemories } from "@/lib/db";

export default function App() {
  const setFragments = useMemoryStore((s) => s.setFragments);

  // 启动时从 SQLite 恢复数据
  useEffect(() => {
    getMessages()
      .then((msgs) => useChatStore.setState({ messages: msgs }))
      .catch(() => {}); // Tauri 环境外（纯浏览器预览）静默失败

    getMemories()
      .then(setFragments)
      .catch(() => {});
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
        <div className="absolute bottom-32 left-16 right-0 flex justify-center">
          <LyricStream />
        </div>
      </main>

      {/* 底部输入区 */}
      <InputBar />

      {/* 页脚 */}
      <footer className="fixed bottom-0 right-0 px-16 py-2 pointer-events-none z-50">
        <div className="flex gap-6 opacity-30 hover:opacity-70 transition-opacity pointer-events-auto">
          <span className="text-label-sm text-outline">© Alice AI. A quiet space.</span>
        </div>
      </footer>
    </div>
  );
}

function TopBar() {
  const status = useChatStore((s) => s.status);

  return (
    <header className="fixed top-0 left-16 right-0 z-40 flex justify-between items-center px-16 py-3 backdrop-blur-md bg-background/20">
      <div className="flex items-center gap-2 h-6">
        {status !== "idle" && (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-label-sm text-on-surface-variant tracking-widest uppercase text-[10px]">
              {status === "thinking" ? "Thinking..." : status === "speaking" ? "Speaking..." : "Listening..."}
            </span>
          </>
        )}
      </div>
      <div className="text-label-sm text-outline uppercase tracking-[0.2em]">
        {new Date().toLocaleString("en", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
      </div>
    </header>
  );
}
