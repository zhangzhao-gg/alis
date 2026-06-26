/**
 * [INPUT]: 依赖 stores/index 的 useSettingsStore、useChatStore、useMemoryStore；依赖 lib/db
 * [OUTPUT]: 对外提供 SettingsDrawer 组件
 * [POS]: drawers/ 之设置抽屉，管理 API Key、模型、语音、人格
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState } from "react";
import { useSettingsStore, useChatStore, useMemoryStore, type Settings } from "@/stores";
import { clearMessages, clearMemories, saveSettings } from "@/lib/db";

const MODELS = [
  { value: "deepseek-chat", label: "DeepSeek Chat" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
];

export function SettingsDrawer() {
  const [draft, setDraft] = useState<Settings>(() => {
    const { apiKey, model, voiceEnabled, ttsApiKey, ttsResourceId, ttsSpeaker, systemPrompt } = useSettingsStore.getState();
    return { apiKey, model, voiceEnabled, ttsApiKey, ttsResourceId, ttsSpeaker, systemPrompt };
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
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

  const handleClearMessages = async () => {
    if (!confirm("清空全部聊天记录？")) return;
    await clearMessages();
    clearChat();
  };

  const handleClearMemories = async () => {
    if (!confirm("清空全部记忆？")) return;
    await clearMemories();
    setFragments([]);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-10 pb-6">
        <h2 className="text-headline-lg text-on-surface tracking-tight mb-1">Settings</h2>
        <p className="text-label-sm text-outline italic">Configure Alice's mind.</p>
      </div>

      <div className="flex-1 px-10 space-y-10 pb-20">
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
            className="input-line bg-transparent"
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
          <button
            onClick={toggleTtsReply}
            className={`w-10 h-5 rounded-full transition-colors relative ${
              draft.voiceEnabled ? "bg-primary" : "bg-outline-variant"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-on-primary transition-transform ${
                draft.voiceEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-label-sm text-outline ml-3">
            {draft.voiceEnabled ? "ON" : "OFF"}
          </span>
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

        <Field label="TTS Resource ID">
          <input
            type="text"
            value={draft.ttsResourceId}
            onChange={(e) => updateDraft({ ttsResourceId: e.target.value })}
            placeholder="seed-tts-2.0"
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

        {/* 人格设定 */}
        <Field label="Alice's Persona">
          <textarea
            value={draft.systemPrompt}
            onChange={(e) => updateDraft({ systemPrompt: e.target.value })}
            rows={5}
            className="w-full bg-transparent border border-outline-variant/20 focus:border-primary/40 rounded p-3 text-body-md text-on-surface-variant focus:outline-none transition-colors resize-none"
          />
        </Field>

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saveState === "saving"}
            className="w-full bg-primary/90 hover:bg-primary text-on-primary transition-all py-3 text-label-md uppercase tracking-[0.15em] active:scale-[0.98] disabled:opacity-50"
          >
            {saveState === "saving" ? "保存中..." : saveState === "saved" ? "已保存" : "保存设置"}
          </button>
          {saveState === "error" && (
            <p className="mt-2 text-label-sm text-error/80">保存失败，请稍后重试。</p>
          )}
        </div>

        {/* 危险操作 */}
        <div className="pt-4 space-y-4 border-t border-outline-variant/10">
          <DangerButton onClick={handleClearMessages}>清空聊天记录</DangerButton>
          <DangerButton onClick={handleClearMemories}>清空记忆</DangerButton>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-label-md text-on-surface-variant uppercase tracking-widest text-[11px]">
        {label}
      </label>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function DangerButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full border border-error/20 text-error/60 hover:border-error/50 hover:text-error transition-all py-3 text-label-md uppercase tracking-[0.15em] active:scale-[0.98]"
    >
      {children}
    </button>
  );
}
