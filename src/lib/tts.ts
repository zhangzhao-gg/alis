/**
 * [INPUT]: 依赖 @tauri-apps/api/core 的 invoke
 * [OUTPUT]: 对外提供 playTts（返回 promise + cancel）
 * [POS]: lib 层 TTS 接入，普通回复由前端 Audio 播放，语音对话由 VoiceProcessingIO 全双工播放
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
  mode?: "normal" | "duplex";
}

export interface TtsHandle {
  promise: Promise<void>;
  cancel: () => void;
}

function base64ToBlob(base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

export function playTts({ apiKey, resourceId, speaker, text, onStart, mode = "normal" }: PlayTtsOptions): TtsHandle {
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let stage: "synthesize" | "prepare" | "playing" | "done" = mode === "normal" ? "synthesize" : "prepare";
  let finishNormalPlayback: (() => void) | null = null;

  const cleanupNormalAudio = () => {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const promise = new Promise<void>((resolve) => {
    (async () => {
      if (mode === "normal") {
        debugLog("[TTS] invoke tts_synthesize", { chars: text.length, resourceId, speaker });

        const audioBase64 = await invoke<string>("tts_synthesize", {
          request: { apiKey, resourceId, speaker, text },
        }).catch((err) => {
          debugError("[TTS] tts_synthesize error", err instanceof Error ? err.message : String(err));
          return "";
        });

        if (cancelled || !audioBase64) {
          debugLog("[TTS] normal playback skipped", { cancelled, hasAudio: !!audioBase64 });
          resolve();
          return;
        }

        objectUrl = URL.createObjectURL(base64ToBlob(audioBase64, "audio/mpeg"));
        audio = new Audio(objectUrl);
        stage = "playing";
        onStart?.();

        await new Promise<void>((finish) => {
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            finishNormalPlayback = null;
            cleanupNormalAudio();
            finish();
          };
          finishNormalPlayback = done;
          audio!.onended = done;
          audio!.onerror = () => {
            debugError("[TTS] normal audio playback error", "HTMLAudioElement failed");
            done();
          };
          audio!.play().catch((err) => {
            debugError("[TTS] normal audio play error", err instanceof Error ? err.message : String(err));
            done();
          });
        });

        stage = "done";
        debugLog("[TTS] normal playback finished");
        resolve();
        return;
      }

      debugLog("[TTS] invoke tts_prepare", { chars: text.length, resourceId, speaker });

      const prepared = await invoke("tts_prepare", {
        request: { apiKey, resourceId, speaker, text },
      }).catch((err) => {
        debugError("[TTS] tts_prepare error", err instanceof Error ? err.message : String(err));
        return false;
      });

      if (cancelled || prepared === false) {
        debugLog("[TTS] duplex playback skipped", { cancelled, prepared: prepared !== false });
        resolve();
        return;
      }

      onStart?.();

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
    debugLog("[TTS] cancel requested", { mode, stage });
    if (mode === "normal") {
      const finish = finishNormalPlayback;
      if (finish) {
        finish();
      } else {
        cleanupNormalAudio();
      }
      return;
    }
    invoke("tts_stop").catch(() => {});
  };

  return { promise, cancel };
}

export function cancelTts() {
  return invoke("tts_stop").catch(() => {});
}
