/**
 * [INPUT]: 依赖 @tauri-apps/api/core 的 invoke
 * [OUTPUT]: 对外提供 playTts 函数，返回 { promise, cancel }
 * [POS]: lib 层的火山 TTS 接入，通过 Tauri 后端请求音频并在前端播放
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { invoke } from "@tauri-apps/api/core";

interface PlayTtsOptions {
  apiKey: string;
  resourceId: string;
  speaker: string;
  text: string;
  onStart?: () => void;
}

export interface TtsHandle {
  promise: Promise<void>;
  cancel: () => void;
}

export function playTts({ apiKey, resourceId, speaker, text, onStart }: PlayTtsOptions): TtsHandle {
  let audio: HTMLAudioElement | null = null;
  let cancelled = false;
  let resolvePlay!: () => void;

  const promise = (async () => {
    const audioBase64 = await invoke<string>("synthesize_tts", {
      request: { apiKey, resourceId, speaker, text },
    });

    // 被 cancel 可能发生在 invoke 期间
    if (cancelled) return;

    const bytes = Uint8Array.from(atob(audioBase64), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    audio = new Audio(url);

    try {
      await new Promise<void>((resolve, reject) => {
        resolvePlay = resolve;
        audio!.onended = () => resolve();
        audio!.onerror = () => reject(new Error(audio!.error?.message || "Audio playback failed"));
        audio!
          .play()
          .then(() => onStart?.())
          .catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  })();

  const cancel = () => {
    cancelled = true;
    if (audio) {
      audio.pause();
      audio.src = "";
      resolvePlay?.();
    }
  };

  return { promise, cancel };
}
