import { create } from "zustand";

// ============================================================
//  类型定义
// ============================================================

export type Sender = "user" | "alice";
export type DrawerType = "memory" | "notebook" | "settings" | null;
export type AliceStatus = "idle" | "thinking" | "speaking" | "recording";
export type DisplayLanguage = "zh" | "ja";

export interface Message {
  id: string;
  sender: Sender;
  text: string;
  timestamp: number;
}

export type MemoryType = "trait" | "event" | "feeling" | "bond" | "general";
export type Emotion = "平静" | "微笑" | "开心笑" | "大笑" | "害羞" | "害羞笑" | "得意" | "思考" | "疑惑" | "惊讶" | "震惊" | "郁闷" | "不爽" | "生气" | "大哭" | "睡觉";

export interface MemoryFragment {
  id: string;
  type: MemoryType;
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
  displayLanguage: DisplayLanguage;
  currentEmotion: Emotion;
  setDrawer: (d: DrawerType) => void;
  toggleDrawer: (d: Exclude<DrawerType, null>) => void;
  setDisplayLanguage: (language: DisplayLanguage) => void;
  setEmotion: (emotion: Emotion) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeDrawer: null,
  displayLanguage: "zh",
  currentEmotion: "平静",
  setDrawer: (activeDrawer) => set({ activeDrawer }),
  toggleDrawer: (d) =>
    set({ activeDrawer: get().activeDrawer === d ? null : d }),
  setDisplayLanguage: (displayLanguage) => set({ displayLanguage }),
  setEmotion: (currentEmotion) => set({ currentEmotion }),
}));

// ============================================================
//  Memory Store
// ============================================================

interface MemoryState {
  fragments: MemoryFragment[];
  affinity: number;
  setFragments: (f: MemoryFragment[]) => void;
  setAffinity: (n: number) => void;
  addFragment: (content: string, type?: MemoryType) => void;
  removeFragment: (id: string) => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  fragments: [],
  affinity: 30,
  setFragments: (fragments) => set({ fragments }),
  setAffinity: (affinity) => set({ affinity }),
  addFragment: (content, type = "general") =>
    set((state) => ({
      fragments: [
        ...state.fragments,
        { id: crypto.randomUUID(), type, content, createdAt: Date.now() },
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
  ttsWorkingResourceId: string;
  ttsWorkingSpeaker: string;
  debugOverlay: boolean;
  personaMode: "auto" | "yamada" | "tayama";
  asrProvider: "volcengine" | "aliyun";
  asrAliWorkspaceId: string;
  asrAliApiKey: string;
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

const DEFAULT_TTS_RESOURCE_ID = "seed-icl-2.0";
const LEGACY_TTS_RESOURCE_ID = "seed-tts-2.0";

function normalizeTtsResourceId(resourceId: string | undefined, fallback: string) {
  if (resourceId === undefined) return fallback;
  if (!resourceId || resourceId === LEGACY_TTS_RESOURCE_ID) return DEFAULT_TTS_RESOURCE_ID;
  return resourceId;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: "",
  model: "deepseek-chat",
  voiceEnabled: false,
  ttsApiKey: "",
  ttsResourceId: DEFAULT_TTS_RESOURCE_ID,
  ttsSpeaker: "zh_female_vv_uranus_bigtts",
  ttsWorkingResourceId: DEFAULT_TTS_RESOURCE_ID,
  ttsWorkingSpeaker: "",
  debugOverlay: false,
  personaMode: "auto",
  asrProvider: "volcengine",
  asrAliWorkspaceId: "",
  asrAliApiKey: "",
  update: (patch) =>
    set((state) => ({
      ...state,
      apiKey: patch.apiKey ?? state.apiKey,
      model: patch.model ?? state.model,
      voiceEnabled: patch.voiceEnabled ?? state.voiceEnabled,
      ttsApiKey: patch.ttsApiKey ?? state.ttsApiKey,
      ttsResourceId: normalizeTtsResourceId(patch.ttsResourceId, state.ttsResourceId),
      ttsSpeaker: patch.ttsSpeaker ?? state.ttsSpeaker,
      ttsWorkingResourceId: normalizeTtsResourceId(patch.ttsWorkingResourceId, state.ttsWorkingResourceId),
      ttsWorkingSpeaker: patch.ttsWorkingSpeaker ?? state.ttsWorkingSpeaker,
      debugOverlay: patch.debugOverlay ?? state.debugOverlay,
      personaMode: patch.personaMode ?? state.personaMode,
      asrProvider: patch.asrProvider ?? state.asrProvider,
      asrAliWorkspaceId: patch.asrAliWorkspaceId ?? state.asrAliWorkspaceId,
      asrAliApiKey: patch.asrAliApiKey ?? state.asrAliApiKey,
    })),
}));
