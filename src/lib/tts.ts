/**
 * [INPUT]: 依赖 @tauri-apps/api/core 的 invoke
 * [OUTPUT]: 对外提供 playTts 函数
 * [POS]: lib 层的火山 TTS 接入，通过 Tauri 后端请求音频并在前端播放
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { invoke } from "@tauri-apps/api/core";

interface PlayTtsOptions {
  apiKey: string;
  resourceId: string;
  speaker: string;
  text: string;
}

export async function playTts({ apiKey, resourceId, speaker, text }: PlayTtsOptions) {
  const audioBase64 = await invoke<string>("synthesize_tts", {
    request: { apiKey, resourceId, speaker, text },
  });
  const bytes = Uint8Array.from(atob(audioBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  const audio = new Audio(url);

  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error(audio.error?.message || "Audio playback failed"));
      audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
