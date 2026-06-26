/**
 * [INPUT]: 依赖 stores/index 的 useSettingsStore、useChatStore、useMemoryStore；依赖 lib/db
 * [OUTPUT]: 对外提供 SettingsDrawer 组件
 * [POS]: drawers/ 之设置抽屉，管理 API Key、模型、语音、人格
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useSettingsStore, useChatStore, useMemoryStore } from "@/stores";
import { clearMessages, clearMemories } from "@/lib/db";

const MODELS = [
  { value: "deepseek-chat", label: "DeepSeek Chat" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
];

export function SettingsDrawer() {
  const settings = useSettingsStore();
  const clearChat = useChatStore((s) => s.clearMessages);
  const setFragments = useMemoryStore((s) => s.setFragments);

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
            value={settings.apiKey}
            onChange={(e) => settings.update({ apiKey: e.target.value })}
            placeholder="sk-..."
            className="input-line"
          />
        </Field>

        {/* 模型选择 */}
        <Field label="Model">
          <select
            value={settings.model}
            onChange={(e) => settings.update({ model: e.target.value })}
            className="input-line bg-transparent"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value} className="bg-surface-container">
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        {/* 语音开关 */}
        <Field label="Voice Reply">
          <button
            onClick={() => settings.update({ voiceEnabled: !settings.voiceEnabled })}
            className={`w-10 h-5 rounded-full transition-colors relative ${
              settings.voiceEnabled ? "bg-primary" : "bg-outline-variant"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-on-primary transition-transform ${
                settings.voiceEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-label-sm text-outline ml-3">
            {settings.voiceEnabled ? "ON" : "OFF — TTS 接入后生效"}
          </span>
        </Field>

        {/* 人格设定 */}
        <Field label="Alice's Persona">
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => settings.update({ systemPrompt: e.target.value })}
            rows={5}
            className="w-full bg-transparent border border-outline-variant/20 focus:border-primary/40 rounded p-3 text-body-md text-on-surface-variant focus:outline-none transition-colors resize-none"
          />
        </Field>

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
