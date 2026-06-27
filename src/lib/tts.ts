/**
 * [INPUT]: 依赖 @tauri-apps/api/core 的 invoke
 * [OUTPUT]: 对外提供 playTts 函数，返回 { promise, cancel }
 * [POS]: lib 层的火山 TTS 接入，通过 Tauri 后端请求音频并在前端播放
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { invoke } from "@tauri-apps/api/core";
import { debugError, debugLog } from "@/lib/debugLog";

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
    debugLog("[TTS] synthesize request", { chars: text.length, resourceId, speaker });
    const audioBase64 = await invoke<string>("synthesize_tts", {
      request: { apiKey, resourceId, speaker, text },
    });

    // 被 cancel 可能发生在 invoke 期间
    if (cancelled) {
      debugLog("[TTS] cancelled before audio playback");
      return;
    }

    const bytes = Uint8Array.from(atob(audioBase64), (char) => char.charCodeAt(0));
    debugLog("[TTS] synthesized audio", { bytes: bytes.byteLength, header: byteHeader(bytes) });
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;

    try {
      await new Promise<void>((resolve, reject) => {
        resolvePlay = resolve;
        audio!.onloadedmetadata = () => {
          debugLog("[TTS] audio metadata", {
            duration: Number.isFinite(audio!.duration) ? audio!.duration : null,
            readyState: audio!.readyState,
            volume: audio!.volume,
            muted: audio!.muted,
          });
        };
        audio!.onplaying = () => debugLog("[TTS] audio playing event", { currentTime: audio!.currentTime });
        audio!.onpause = () => debugLog("[TTS] audio pause event", { currentTime: audio!.currentTime });
        audio!.onended = () => {
          debugLog("[TTS] audio ended event", { currentTime: audio!.currentTime });
          resolve();
        };
        audio!.onerror = () => {
          const error = new Error(audio!.error?.message || `Audio playback failed: code=${audio!.error?.code ?? "unknown"}`);
          debugError("[TTS] audio error event", error.message);
          reject(error);
        };
        audio!
          .play()
          .then(() => {
            debugLog("[TTS] audio play started", {
              paused: audio!.paused,
              readyState: audio!.readyState,
              volume: audio!.volume,
              muted: audio!.muted,
            });
            onStart?.();
          })
          .catch((err) => {
            debugError("[TTS] audio play rejected", err instanceof Error ? err.message : String(err));
            reject(err);
          });
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  })();

  const cancel = () => {
    cancelled = true;
    debugLog("[TTS] cancel requested");
    if (audio) {
      audio.pause();
      audio.src = "";
      resolvePlay?.();
    }
  };

  return { promise, cancel };
}

function byteHeader(bytes: Uint8Array) {
  return Array.from(bytes.slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}
