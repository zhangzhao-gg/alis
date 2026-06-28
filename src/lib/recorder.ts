/**
 * [INPUT]: 依赖 @tauri-apps/api/core 的 invoke
 * [OUTPUT]: 对外提供 RealtimePcmRecorder，从主进程 VoiceProcessingIO AudioUnit 拉取 16kHz mono PCM 分片
 * [POS]: lib 层录音封装，调用主进程原生 VoiceProcessingIO AudioUnit（与 TTS 播放共用同一引擎，实现全双工）
 *        不再使用 getUserMedia，避免 WKWebView 和主进程的音频会话冲突
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { invoke } from "@tauri-apps/api/core";

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_MS = 200;
const SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE * CHUNK_MS / 1000; // 3200 samples = 6400 bytes
const POLL_INTERVAL_MS = 100; // 每 100ms 轮询一次，累积到 200ms 发送

type AudioChunkHandler = (chunk: Uint8Array) => void;

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class RealtimePcmRecorder {
  private onChunk: AudioChunkHandler | null = null;
  private pendingBytes: number[] = [];
  private pollTimer: number | null = null;
  private started = false;

  async start(onChunk: AudioChunkHandler) {
    if (this.started) return;
    this.onChunk = onChunk;
    this.pendingBytes = [];

    // 启动主进程录音（init + start engine + installTap）
    await invoke("audio_start_capture");

    this.started = true;

    // 定时轮询主进程 PCM
    this.pollTimer = window.setInterval(() => this.pollPcm(), POLL_INTERVAL_MS);
  }

  private async pollPcm() {
    if (!this.started) return;

    try {
      const base64 = await invoke<string>("audio_poll_pcm");
      if (!base64) return;

      const bytes = decodeBase64ToBytes(base64);
      if (bytes.length === 0) return;

      // 累积到 pendingBytes
      for (let i = 0; i < bytes.length; i += 1) {
        this.pendingBytes.push(bytes[i]);
      }

      // 每 6400 字节（200ms）发一个 chunk
      while (this.pendingBytes.length >= SAMPLES_PER_CHUNK * 2) {
        const chunkBytes = this.pendingBytes.splice(0, SAMPLES_PER_CHUNK * 2);
        this.onChunk?.(new Uint8Array(chunkBytes));
      }
    } catch (err) {
      console.error("[RECORDER] poll_pcm error", err);
    }
  }

  // 取出当前待发样本并清空，但不停麦克风 —— 用于 VAD session 轮换时抢救尾音
  flushPending(): Uint8Array {
    const chunk = new Uint8Array(this.pendingBytes);
    this.pendingBytes = [];
    return chunk;
  }

  async stop(): Promise<Uint8Array> {
    if (!this.started) {
      return new Uint8Array();
    }

    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // 拉一次最后的 PCM
    try {
      const base64 = await invoke<string>("audio_poll_pcm");
      if (base64) {
        const bytes = decodeBase64ToBytes(base64);
        for (let i = 0; i < bytes.length; i += 1) {
          this.pendingBytes.push(bytes[i]);
        }
      }
    } catch {
      // 忽略
    }

    // 停止主进程录音（只清空 capture callback，不关引擎，TTS 可能还要用）
    try {
      await invoke("audio_stop_capture");
    } catch {
      // 忽略
    }

    const finalChunk = new Uint8Array(this.pendingBytes);
    this.pendingBytes = [];
    this.started = false;
    this.onChunk = null;

    return finalChunk;
  }
}
