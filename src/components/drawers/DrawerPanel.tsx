/**
 * [INPUT]: 依赖 stores/index 的 useUIStore；依赖三个 drawer 组件
 * [OUTPUT]: 对外提供 DrawerPanel 组件
 * [POS]: 抽屉容器，统一控制滑入/滑出动效
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useUIStore } from "@/stores";
import { MemoryDrawer } from "./MemoryDrawer";
import { NotebookDrawer } from "./NotebookDrawer";
import { SettingsDrawer } from "./SettingsDrawer";

const drawerMap = {
  memory: MemoryDrawer,
  notebook: NotebookDrawer,
  settings: SettingsDrawer,
};

export function DrawerPanel() {
  const activeDrawer = useUIStore((s) => s.activeDrawer);
  const isOpen = activeDrawer !== null;

  const Content = activeDrawer ? drawerMap[activeDrawer] : null;

  return (
    <div
      className={`fixed top-0 bottom-0 left-16 w-[520px] bg-surface-container-low border-r border-outline-variant/10 z-40 backdrop-blur-3xl transition-transform duration-500 ease-in-out shadow-[40px_0_100px_rgba(0,0,0,0.6)] ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {Content && <Content />}
    </div>
  );
}
