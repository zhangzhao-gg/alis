/**
 * [INPUT]: 依赖 persona.ts 的 CharacterStatus
 * [OUTPUT]: 对外提供 getVoiceConfig，按角色状态返回 TTS 音色配置
 * [POS]: lib 层音色路由，状态→音色的映射表，在此文件填写各状态音色参数
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { CharacterStatus } from "@/lib/persona";

export interface VoiceConfig {
  resourceId: string;
  speaker: string;
}

// ============================================================
//  各状态音色配置 —— 在此填写
// ============================================================

const VOICE_BY_STATUS: Record<CharacterStatus, VoiceConfig> = {
  // 白天上班：山田营业音色
  working: {
    resourceId: "seed-icl-2.0",
    speaker: "TODO: 填写上班状态 speaker",
  },

  // 夜晚后门：田山本我音色（默认音色，与 Settings 里保持一致）
  smoking: {
    resourceId: "seed-icl-2.0",
    speaker: "TODO: 填写后门状态 speaker",
  },

  // 深夜归家：休息状态音色
  resting: {
    resourceId: "seed-icl-2.0",
    speaker: "TODO: 填写休息状态 speaker",
  },
};

// ============================================================

export function getVoiceConfig(status: CharacterStatus): VoiceConfig {
  return VOICE_BY_STATUS[status];
}
