/**
 * [INPUT]: 依赖 persona.ts 的 CharacterStatus，依赖 stores/index 的 useSettingsStore
 * [OUTPUT]: 对外提供 getVoiceConfig，按角色状态返回 TTS 音色配置
 * [POS]: lib 层音色路由，从 settings store 读取对应状态的音色参数
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { CharacterStatus } from "@/lib/persona";
import { useSettingsStore } from "@/stores";

export interface VoiceConfig {
  resourceId: string;
  speaker: string;
}

export function getVoiceConfig(status: CharacterStatus): VoiceConfig {
  const { ttsResourceId, ttsSpeaker, ttsWorkingResourceId, ttsWorkingSpeaker } =
    useSettingsStore.getState();

  if (status === "working") {
    return {
      resourceId: ttsWorkingResourceId || ttsResourceId,
      speaker: ttsWorkingSpeaker || ttsSpeaker,
    };
  }

  // smoking & resting 共用田山音色
  return { resourceId: ttsResourceId, speaker: ttsSpeaker };
}
