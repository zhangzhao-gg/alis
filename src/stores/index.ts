import { create } from "zustand";

// ============================================================
//  类型定义
// ============================================================

export type Sender = "user" | "alice";
export type DrawerType = "memory" | "notebook" | "settings" | null;
export type AliceStatus = "idle" | "thinking" | "speaking" | "recording";

export interface Message {
  id: string;
  sender: Sender;
  text: string;
  timestamp: number;
}

export interface MemoryFragment {
  id: string;
  content: string;
  createdAt: number;
}

// ============================================================
//  Chat Store
// ============================================================

interface ChatState {
  messages: Message[];
  status: AliceStatus;
  addMessage: (msg: Omit<Message, "id" | "timestamp">) => void;
  setStatus: (s: AliceStatus) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  status: "idle",
  addMessage: (msg) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { ...msg, id: crypto.randomUUID(), timestamp: Date.now() },
      ],
    })),
  setStatus: (status) => set({ status }),
  clearMessages: () => set({ messages: [] }),
}));

// ============================================================
//  UI Store
// ============================================================

interface UIState {
  activeDrawer: DrawerType;
  setDrawer: (d: DrawerType) => void;
  toggleDrawer: (d: Exclude<DrawerType, null>) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeDrawer: null,
  setDrawer: (activeDrawer) => set({ activeDrawer }),
  toggleDrawer: (d) =>
    set({ activeDrawer: get().activeDrawer === d ? null : d }),
}));

// ============================================================
//  Memory Store
// ============================================================

interface MemoryState {
  fragments: MemoryFragment[];
  setFragments: (f: MemoryFragment[]) => void;
  addFragment: (content: string) => void;
  removeFragment: (id: string) => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  fragments: [],
  setFragments: (fragments) => set({ fragments }),
  addFragment: (content) =>
    set((state) => ({
      fragments: [
        ...state.fragments,
        { id: crypto.randomUUID(), content, createdAt: Date.now() },
      ],
    })),
  removeFragment: (id) =>
    set((state) => ({
      fragments: state.fragments.filter((f) => f.id !== id),
    })),
}));

// ============================================================
//  Settings Store
// ============================================================

export interface Settings {
  apiKey: string;
  model: string;
  voiceEnabled: boolean;
  ttsApiKey: string;
  ttsResourceId: string;
  ttsSpeaker: string;
  systemPrompt: string;
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: "",
  model: "deepseek-chat",
  voiceEnabled: false,
  ttsApiKey: "",
  ttsResourceId: "seed-tts-2.0",
  ttsSpeaker: "zh_female_vv_uranus_bigtts",
  systemPrompt:
    "你是阿丽丝，一个住在电脑里的虚拟朋友。外表阴郁高冷，内心温柔克制。回复简短自然，像深夜里陪人说话，不说教不卖萌，话不多但愿意听。",
  update: (patch) => set((state) => ({ ...state, ...patch })),
}));
