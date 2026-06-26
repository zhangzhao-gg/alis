/**
 * [INPUT]: 依赖 stores/index 的 useMemoryStore
 * [OUTPUT]: 对外提供 MemoryDrawer 组件
 * [POS]: drawers/ 之记忆碎片抽屉，展示和管理长期记忆
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useMemoryStore } from "@/stores";

export function MemoryDrawer() {
  const { fragments, removeFragment } = useMemoryStore();

  return (
    <div className="flex flex-col h-full">
      <div className="p-10 pb-4">
        <h2 className="text-headline-lg text-on-surface tracking-tight mb-2">Memory</h2>
        <p className="text-label-sm text-outline italic">
          Shifting thoughts and quiet fragments.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto notebook-mask px-10">
        {fragments.length === 0 ? (
          <p className="text-body-md text-on-surface-variant/40 italic mt-8 text-center">
            Nothing remembered yet.
          </p>
        ) : (
          <div className="space-y-6 pb-20">
            {fragments.map((f) => (
              <div
                key={f.id}
                className="group grid grid-cols-[80px_1fr] gap-6 border-b border-outline-variant/10 pb-6"
              >
                <span className="text-label-sm text-outline/50 pt-1 text-right">
                  {new Date(f.createdAt).toLocaleDateString("zh", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <div className="relative">
                  <p className="text-body-md text-on-surface-variant leading-relaxed">
                    {f.content}
                  </p>
                  <button
                    onClick={() => removeFragment(f.id)}
                    className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-outline hover:text-error"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-10 border-t border-outline-variant/5">
        <button className="w-full bg-tertiary/5 border border-tertiary/20 hover:bg-tertiary/10 transition-all py-4 flex items-center justify-center gap-3 text-tertiary text-label-md uppercase tracking-[0.2em] group active:scale-[0.98]">
          <span className="material-symbols-outlined text-sm group-hover:rotate-180 transition-transform duration-700">
            download
          </span>
          Export Fragments
        </button>
      </div>
    </div>
  );
}
