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
  let stage: "prepare" | "playing" | "done" = "prepare";

  const promise = new Promise<void>((resolve) => {
    (async () => {
      debugLog("[TTS] invoke tts_prepare", { chars: text.length, resourceId, speaker });

      // 1. 合成 + 解码 + 填充 ring buffer（不出声）
      await invoke("tts_prepare", {
        request: { apiKey, resourceId, speaker, text },
      }).catch((err) => {
        debugError("[TTS] tts_prepare error", err instanceof Error ? err.message : String(err));
      });

      if (cancelled) {
        debugLog("[TTS] cancelled before playback");
        resolve();
        return;
      }

      // 2. ring buffer 已就绪 → 通知前端开始打字机（此时声音尚未出）
      onStart?.();

      // 3. 设置 _playing=true 立即出声，阻塞到播放完成
      stage = "playing";
      await invoke("tts_start").catch((err) => {
        debugError("[TTS] tts_start error", err instanceof Error ? err.message : String(err));
      });

      stage = "done";
      debugLog("[TTS] playback finished");
      resolve();
    })();
  });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    debugLog("[TTS] cancel requested", { stage });
    invoke("tts_stop").catch(() => {});
  };

  return { promise, cancel };
}

export function cancelTts() {
  return invoke("tts_stop").catch(() => {});
}
