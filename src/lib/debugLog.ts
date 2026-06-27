import { create } from "zustand";

export type DebugLevel = "info" | "warn" | "error";

export interface DebugEntry {
  id: string;
  time: string;
  level: DebugLevel;
  message: string;
}

interface DebugState {
  entries: DebugEntry[];
  push: (level: DebugLevel, message: string, data?: unknown) => void;
  clear: () => void;
}

const MAX_ENTRIES = 80;

export const useDebugLogStore = create<DebugState>((set) => ({
  entries: [],
  push: (level, message, data) =>
    set((state) => ({
      entries: [
        ...state.entries,
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString("en", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          level,
          message: data === undefined ? message : `${message} ${formatData(data)}`,
        },
      ].slice(-MAX_ENTRIES),
    })),
  clear: () => set({ entries: [] }),
}));

export function debugLog(message: string, data?: unknown) {
  console.log(message, data ?? "");
  useDebugLogStore.getState().push("info", message, data);
}

export function debugWarn(message: string, data?: unknown) {
  console.warn(message, data ?? "");
  useDebugLogStore.getState().push("warn", message, data);
}

export function debugError(message: string, data?: unknown) {
  console.error(message, data ?? "");
  useDebugLogStore.getState().push("error", message, data);
}

function formatData(data: unknown) {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
