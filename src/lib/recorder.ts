/**
 * [INPUT]: 依赖浏览器 MediaDevices 与 Web Audio API
 * [OUTPUT]: 对外提供 RealtimePcmRecorder，录制 16kHz mono PCM 分片
 * [POS]: lib 层的本地麦克风实时录音封装，供 ASR 流式上传使用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_MS = 200;
const SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE * CHUNK_MS / 1000;

type AudioChunkHandler = (chunk: Uint8Array) => void;

export class RealtimePcmRecorder {
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private pendingSamples: number[] = [];
  private onChunk: AudioChunkHandler | null = null;

  async start(onChunk: AudioChunkHandler) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("麦克风不可用：请检查系统隐私设置中的麦克风权限");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.pendingSamples = [];
    this.onChunk = onChunk;

    this.processor.onaudioprocess = (event) => {
      if (!this.audioContext || !this.onChunk) return;

      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsample(input, this.audioContext.sampleRate, TARGET_SAMPLE_RATE);
      for (const sample of downsampled) {
        this.pendingSamples.push(sample);
      }
      this.flushFullChunks();
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  async stop(): Promise<Uint8Array> {
    if (!this.audioContext) {
      throw new Error("Recorder is not running");
    }

    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.audioContext.close();

    const finalChunk = encodePcm(this.pendingSamples);
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.pendingSamples = [];
    this.onChunk = null;

    return finalChunk;
  }

  private flushFullChunks() {
    while (this.pendingSamples.length >= SAMPLES_PER_CHUNK) {
      const samples = this.pendingSamples.splice(0, SAMPLES_PER_CHUNK);
      this.onChunk?.(encodePcm(samples));
    }
  }
}

function downsample(samples: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return samples;

  const ratio = sourceRate / targetRate;
  const length = Math.floor(samples.length / ratio);
  const result = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let j = start; j < end && j < samples.length; j += 1) {
      sum += samples[j];
      count += 1;
    }

    result[i] = count > 0 ? sum / count : 0;
  }

  return result;
}

function encodePcm(samples: ArrayLike<number>) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}
