/**
 * [INPUT]: 依赖 @tauri-apps/api/core 的 invoke
 * [OUTPUT]: 对外提供 playTts（返回 promise + cancel）
 * [POS]: lib 层 TTS 接入，Rust 合成 MP3 后用 VoiceProcessingIO AudioUnit 播放
 *        VoiceProcessingIO AudioUnit 在 Tauri 主进程运行，隐式走通话通道，与录音协同全双工
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
  let cancelled = false;

  const promise = new Promise<void>((resolve) => {
    (async () => {
      debugLog("[TTS] invoke tts_play", { chars: text.length, resourceId, speaker });

      onStart?.();

      await invoke("tts_play", {
        request: { apiKey, resourceId, speaker, text },
      }).catch((err) => {
        debugError("[TTS] tts_play error", err instanceof Error ? err.message : String(err));
      });

      if (cancelled) {
        debugLog("[TTS] cancelled");
        resolve();
        return;
      }

      debugLog("[TTS] playback finished");
      resolve();
    })();
  });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    debugLog("[TTS] cancel requested");
    invoke("tts_stop").catch(() => {});
  };

  return { promise, cancel };
}

export function cancelTts() {
  return invoke("tts_stop").catch(() => {});
}
