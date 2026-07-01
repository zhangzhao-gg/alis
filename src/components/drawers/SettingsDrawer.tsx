/**
 * [INPUT]: 依赖 stores/index 的 useSettingsStore、useChatStore、useMemoryStore；依赖 lib/db
 * [OUTPUT]: 对外提供 SettingsDrawer 组件
 * [POS]: drawers/ 之设置抽屉，管理 API Key、模型、语音、ASR 服务商
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState } from "react";
import { useSettingsStore, useChatStore, useMemoryStore, type Settings } from "@/stores";
import { clearMessages, clearMemories, saveSettings } from "@/lib/db";

const MODELS = [
  { value: "deepseek-chat", label: "DeepSeek Chat" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
];

type PendingClear = "messages" | "memories" | null;

const CLEAR_COPY = {
  messages: {
    title: "清空聊天记录",
    body: "主页对话流和 Notebook 里的聊天上下文都会被清空，并从 SQLite 删除。",
    error: "聊天记录已从当前界面清空，但数据库删除失败。请查看控制台。",
  },
  memories: {
    title: "清空长期记忆",
    body: "长期记忆会被清空，并从 SQLite 删除。聊天记录不会被删除。",
    error: "长期记忆已从当前界面清空，但数据库删除失败。请查看控制台。",
  },
};

export function SettingsDrawer() {
  const [draft, setDraft] = useState<Settings>(() => {
    const { apiKey, model, voiceEnabled, ttsApiKey, ttsResourceId, ttsSpeaker, ttsWorkingResourceId, ttsWorkingSpeaker, debugOverlay, asrProvider, asrAliWorkspaceId, asrAliApiKey } = useSettingsStore.getState();
    return { apiKey, model, voiceEnabled, ttsApiKey, ttsResourceId, ttsSpeaker, ttsWorkingResourceId, ttsWorkingSpeaker, debugOverlay, asrProvider, asrAliWorkspaceId, asrAliApiKey };
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pendingClear, setPendingClear] = useState<PendingClear>(null);
  const [clearState, setClearState] = useState<"idle" | "clearing" | "error">("idle");
  const [clearError, setClearError] = useState("");
  const clearChat = useChatStore((s) => s.clearMessages);
  const setFragments = useMemoryStore((s) => s.setFragments);

  const updateDraft = (patch: Partial<Settings>) => {
    setSaveState("idle");
    setDraft((s) => ({ ...s, ...patch }));
  };

  const persist = async (next: Settings) => {
    setSaveState("saving");
    try {
      await saveSettings(next);
      useSettingsStore.getState().update(next);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const handleSave = () => persist(draft);

  const toggleTtsReply = async () => {
    const next = { ...draft, voiceEnabled: !draft.voiceEnabled };
    setDraft(next);
    await persist(next);
  };

  const toggleDebugOverlay = async () => {
    const next = { ...draft, debugOverlay: !draft.debugOverlay };
    setDraft(next);
    await persist(next);
  };

  const requestClear = (type: Exclude<PendingClear, null>) => {
    setClearState("idle");
    setClearError("");
    setPendingClear(type);
  };

  const confirmClear = async () => {
    if (!pendingClear) return;

    setClearState("clearing");
    const copy = CLEAR_COPY[pendingClear];

    try {
      if (pendingClear === "messages") {
        clearChat();
        await clearMessages();
      } else {
        setFragments([]);
        await clearMemories();
      }

      setPendingClear(null);
      setClearState("idle");
    } catch (err) {
      console.error(`Clear ${pendingClear} failed:`, err);
      setClearState("error");
      setClearError(copy.error);
    }
  };

  const clearDialog = pendingClear ? CLEAR_COPY[pendingClear] : null;

  return (
    <div className="relative flex flex-col h-full overflow-y-auto">
      <div className="px-8 pt-7 pb-4">
        <h2 className="serif-journal text-3xl text-tertiary italic tracking-tight flex items-center gap-3 mb-2">
          <span className="material-symbols-outlined text-tertiary/40">settings</span>
          Settings
        </h2>
        <p className="text-label-sm text-outline italic">Configure connections.</p>
      </div>

      <div className="flex-1 px-8 space-y-4 pb-8">
        {/* API Key */}
        <Field label="API Key">
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => updateDraft({ apiKey: e.target.value })}
            placeholder="sk-..."
            className="input-line"
          />
        </Field>

        {/* 模型选择 */}
        <Field label="Model">
          <select
            value={draft.model}
            onChange={(e) => updateDraft({ model: e.target.value })}
            className="input-line"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value} className="bg-surface-container">
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        {/* TTS 开关 */}
        <Field label="TTS Reply">
          <div className="flex h-9 items-center gap-3">
            <button
              onClick={toggleTtsReply}
              className={`relative h-5 w-10 rounded-full transition-colors ${
                draft.voiceEnabled ? "bg-primary" : "bg-outline-variant"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-on-primary transition-transform ${
                  draft.voiceEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-label-sm text-outline">
              {draft.voiceEnabled ? "ON" : "OFF"}
            </span>
          </div>
        </Field>

        {/* Debug 日志窗口开关 */}
        <Field label="Debug Overlay">
          <div className="flex h-9 items-center gap-3">
            <button
              onClick={toggleDebugOverlay}
              className={`relative h-5 w-10 rounded-full transition-colors ${
                draft.debugOverlay ? "bg-primary" : "bg-outline-variant"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-on-primary transition-transform ${
                  draft.debugOverlay ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-label-sm text-outline">
              {draft.debugOverlay ? "ON" : "OFF"}
            </span>
          </div>
        </Field>

        <Field label="Volcengine API Key">
          <input
            type="password"
            value={draft.ttsApiKey}
            onChange={(e) => updateDraft({ ttsApiKey: e.target.value })}
            placeholder="火山 API Key，TTS/ASR 共用"
            className="input-line"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="TTS Resource ID">
            <input
              type="text"
              value={draft.ttsResourceId}
              onChange={(e) => updateDraft({ ttsResourceId: e.target.value })}
              placeholder="seed-icl-2.0"
              className="input-line"
            />
          </Field>

          <Field label="TTS Speaker">
            <input
              type="text"
              value={draft.ttsSpeaker}
              onChange={(e) => updateDraft({ ttsSpeaker: e.target.value })}
              className="input-line"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Working Resource ID">
            <input
              type="text"
              value={draft.ttsWorkingResourceId}
              onChange={(e) => updateDraft({ ttsWorkingResourceId: e.target.value })}
              placeholder="seed-icl-2.0"
              className="input-line"
            />
          </Field>

          <Field label="Working Speaker">
            <input
              type="text"
              value={draft.ttsWorkingSpeaker}
              onChange={(e) => updateDraft({ ttsWorkingSpeaker: e.target.value })}
              placeholder="上班状态音色（留空则用默认）"
              className="input-line"
            />
          </Field>
        </div>

        {/* ASR 服务商 */}
        <div className="pt-2 border-t border-outline-variant/10">
          <p className="text-label-md text-on-surface-variant uppercase tracking-widest text-[10px] mb-3">ASR Provider</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {(["volcengine", "aliyun"] as const).map((p) => (
              <button
                key={p}
                onClick={() => updateDraft({ asrProvider: p })}
                className={`py-2 text-label-md uppercase tracking-[0.12em] border transition-colors ${
                  draft.asrProvider === p
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-outline-variant/20 text-on-surface-variant hover:border-outline-variant/50"
                }`}
              >
                {p === "volcengine" ? "火山引擎" : "阿里云"}
              </button>
            ))}
          </div>

          {draft.asrProvider === "volcengine" && (
            <p className="text-label-sm text-outline/60 italic">
              使用上方火山 API Key，无需额外配置。
            </p>
          )}

          {draft.asrProvider === "aliyun" && (
            <div className="space-y-3">
              <Field label="API Host">
                <input
                  type="text"
                  value={draft.asrAliWorkspaceId}
                  onChange={(e) => updateDraft({ asrAliWorkspaceId: e.target.value })}
                  placeholder="llm-xxx.cn-beijing.maas.aliyuncs.com"
                  className="input-line"
                />
              </Field>
              <Field label="API Key">
                <input
                  type="password"
                  value={draft.asrAliApiKey}
                  onChange={(e) => updateDraft({ asrAliApiKey: e.target.value })}
                  placeholder="sk-..."
                  className="input-line"
                />
              </Field>
            </div>
          )}
        </div>

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saveState === "saving"}
            className="w-full bg-primary/90 hover:bg-primary text-on-primary transition-all py-2.5 text-label-md uppercase tracking-[0.15em] active:scale-[0.98] disabled:opacity-50"
          >
            {saveState === "saving" ? "保存中..." : saveState === "saved" ? "已保存" : "保存设置"}
          </button>
          {saveState === "error" && (
            <p className="mt-2 text-label-sm text-error/80">保存失败，请稍后重试。</p>
          )}
        </div>

        {/* 危险操作 */}
        <div className="pt-4 space-y-3 border-t border-outline-variant/10">
          <DangerButton onClick={() => requestClear("messages")}>清空聊天记录</DangerButton>
          <DangerButton onClick={() => requestClear("memories")}>清空长期记忆</DangerButton>
        </div>
      </div>

      {clearDialog && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/55 backdrop-blur-md px-10">
          <div className="w-full border border-error/25 bg-surface-container-low shadow-[0_24px_80px_rgba(0,0,0,0.55)] p-6">
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center border border-error/30 text-error/80">
                <span className="material-symbols-outlined text-xl">warning</span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-title-md text-on-surface tracking-wide">
                  {clearDialog.title}
                </h3>
                <p className="mt-3 text-body-sm leading-relaxed text-on-surface-variant">
                  {clearDialog.body}
                </p>
                {clearError && (
                  <p className="mt-3 text-label-sm text-error/80">{clearError}</p>
                )}
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setPendingClear(null);
                  setClearState("idle");
                  setClearError("");
                }}
                disabled={clearState === "clearing"}
                className="border border-outline-variant/20 py-3 text-label-md uppercase tracking-[0.15em] text-on-surface-variant transition-colors hover:border-outline-variant/50 hover:text-on-surface disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={() => void confirmClear()}
                disabled={clearState === "clearing"}
                className="border border-error/40 bg-error/10 py-3 text-label-md uppercase tracking-[0.15em] text-error transition-colors hover:bg-error/15 disabled:opacity-40"
              >
                {clearState === "clearing" ? "清空中..." : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-label-md text-on-surface-variant uppercase tracking-widest text-[10px]">
        {label}
      </label>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

function DangerButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full border border-error/20 text-error/60 hover:border-error/50 hover:text-error transition-all py-2.5 text-label-md uppercase tracking-[0.15em] active:scale-[0.98]"
    >
      {children}
    </button>
  );
}
