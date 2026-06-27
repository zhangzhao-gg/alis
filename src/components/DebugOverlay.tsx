import { useEffect, useRef, useState } from "react";
import { useDebugLogStore } from "@/lib/debugLog";

export function DebugOverlay() {
  const [expanded, setExpanded] = useState(true);
  const entries = useDebugLogStore((s) => s.entries);
  const clear = useDebugLogStore((s) => s.clear);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, expanded]);

  return (
    <aside className="fixed bottom-3 left-20 z-[80] w-[min(680px,calc(100vw-7rem))] border border-outline-variant/25 bg-surface-container-high/95 shadow-[0_16px_60px_rgba(0,0,0,0.45)] backdrop-blur-md">
      <div className="flex h-8 items-center justify-between border-b border-outline-variant/15 px-3">
        <button
          onClick={() => setExpanded((value) => !value)}
          className="text-[10px] uppercase tracking-[0.16em] text-on-surface-variant hover:text-on-surface"
        >
          Debug {entries.length}
        </button>
        <button
          onClick={clear}
          className="text-[10px] uppercase tracking-[0.16em] text-outline hover:text-on-surface"
        >
          Clear
        </button>
      </div>

      {expanded && (
        <div className="max-h-44 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5">
          {entries.length === 0 ? (
            <p className="text-outline">No logs yet.</p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className={
                  entry.level === "error"
                    ? "text-error/90"
                    : entry.level === "warn"
                    ? "text-tertiary"
                    : "text-on-surface-variant"
                }
              >
                <span className="mr-2 text-outline">{entry.time}</span>
                {entry.message}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </aside>
  );
}
