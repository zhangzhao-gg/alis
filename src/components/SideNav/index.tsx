/**
 * [INPUT]: 依赖 stores/index 的 useUIStore、useChatStore
 * [OUTPUT]: 对外提供 SideNav 组件
 * [POS]: 左侧书签式垂直导航，控制抽屉开关
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useUIStore } from "@/stores";
import type { DrawerType } from "@/stores";

const tabs: { id: Exclude<DrawerType, null>; icon: string; label: string }[] = [
  { id: "memory", icon: "history_edu", label: "Memory" },
  { id: "notebook", icon: "auto_stories", label: "Notebook" },
  { id: "settings", icon: "settings", label: "Settings" },
];

export function SideNav() {
  const { activeDrawer, toggleDrawer } = useUIStore();

  return (
    <nav className="fixed left-0 top-0 h-full w-16 z-[70] flex flex-col items-center py-16 bg-surface-container-low/20 backdrop-blur-xl border-r border-outline-variant/10">
      <div className="text-on-surface tracking-widest [writing-mode:vertical-lr] rotate-180 mb-12 text-sm font-medium">
        ALICE
      </div>

      <div className="flex flex-col space-y-12 items-center flex-1">
        {tabs.map((tab) => {
          const active = activeDrawer === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => toggleDrawer(tab.id)}
              className={`group flex flex-col items-center transition-all duration-300 ${
                active ? "text-tertiary" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined mb-2 text-2xl group-hover:scale-110 transition-transform">
                {tab.icon}
              </span>
              <span className="[writing-mode:vertical-lr] rotate-180 text-label-md text-[11px] uppercase tracking-widest">
                {tab.label}
              </span>
              {active && <div className="w-1 h-1 bg-tertiary rounded-full mt-2" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
