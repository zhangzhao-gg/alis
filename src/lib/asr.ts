/**
 * [INPUT]: 依赖 @tauri-apps/api/core 的 invoke；依赖 @tauri-apps/api/event 的 listen
 * [OUTPUT]: 对外提供火山/阿里云 ASR 实时流会话函数、转写事件监听、VAD 判停事件监听
 * [POS]: lib 层的 ASR 接入，按 provider 路由到不同 Tauri 后端命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface StartAsrStreamOptions {
  apiKey: string;
}

interface StartAliAsrStreamOptions {
  workspaceId: string;
  apiKey: string;
}

interface AsrAudioOptions {
  sessionId: string;
  audio: Uint8Array;
}

interface AsrTranscriptEvent {
  sessionId: string;
  text: string;
}

type AsrTranscriptHandler = (payload: AsrTranscriptEvent) => void;

// ----------------------------------------------------------------
//  火山引擎
// ----------------------------------------------------------------

export async function startAsrStream({ apiKey }: StartAsrStreamOptions) {
  return invoke<string>("asr_start_stream", { request: { apiKey } });
}

export async function pushAsrAudio({ sessionId, audio }: AsrAudioOptions) {
  return invoke<void>("asr_push_audio", {
    request: { sessionId, audioBase64: bytesToBase64(audio) },
  });
}

export async function finishAsrStream({ sessionId, audio }: AsrAudioOptions) {
  return invoke<string>("asr_finish_stream", {
    request: { sessionId, audioBase64: bytesToBase64(audio) },
  });
}

// ----------------------------------------------------------------
//  阿里云
// ----------------------------------------------------------------

export async function startAliAsrStream({ workspaceId, apiKey }: StartAliAsrStreamOptions) {
  return invoke<string>("asr_ali_start_stream", {
    request: { workspaceId, apiKey },
  });
}

export async function pushAliAsrAudio({ sessionId, audio }: AsrAudioOptions) {
  return invoke<void>("asr_ali_push_audio", {
    request: { sessionId, audioBase64: bytesToBase64(audio) },
  });
}

export async function finishAliAsrStream({ sessionId, audio }: AsrAudioOptions) {
  return invoke<void>("asr_ali_finish_stream", {
    request: { sessionId, audioBase64: bytesToBase64(audio) },
  });
}

// ----------------------------------------------------------------
//  事件监听（两个 provider 共用同一套事件 channel）
// ----------------------------------------------------------------

export function listenAsrTranscript(handler: AsrTranscriptHandler) {
  return listen<AsrTranscriptEvent>("asr://transcript", (event) => {
    handler(event.payload);
  });
}

export function listenAsrVadEnd(handler: AsrTranscriptHandler) {
  return listen<AsrTranscriptEvent>("asr://vad-end", (event) => {
    handler(event.payload);
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
