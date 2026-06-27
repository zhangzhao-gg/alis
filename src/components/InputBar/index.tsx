/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、useSettingsStore、useMemoryStore；依赖 lib/ai、lib/asr、lib/tts、lib/recorder
 * [OUTPUT]: 对外提供 InputBar 组件
 * [POS]: 底部输入区，处理文字发送、流式 AI 回复、持续语音模式（麦克风常开 + VAD 判停 + TTS 打断）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore, useMemoryStore, useSettingsStore, useUIStore } from "@/stores";
import { streamChat } from "@/lib/ai";
import { saveMessage } from "@/lib/db";
import { tickAndDistill } from "@/lib/memory";
import { playTts, type TtsHandle } from "@/lib/tts";
import { TAVERN_SYSTEM_PROMPT, buildTayamaContextPrompt } from "@/lib/persona";
import { getDisplayText, getSpokenText, getEmotion } from "@/lib/messageText";
import {
  finishAsrStream,
  listenAsrTranscript,
  listenAsrVadEnd,
  pushAsrAudio,
  startAsrStream,
} from "@/lib/asr";
import { RealtimePcmRecorder } from "@/lib/recorder";

type InputSource = "text" | "voice";

export function InputBar() {
  const [text, setText] = useState("");
  const [, setAsrHint] = useState("");
  const { setStatus } = useChatStore();
  const settings = useSettingsStore();
  const recorderRef = useRef<RealtimePcmRecorder | null>(null);
  const asrSessionRef = useRef<string | null>(null);
  const audioPushRef = useRef<Promise<void>>(Promise.resolve());
  // 语音模式标志 —— 独立于 status，麦克风常开时为 true
  const voiceModeRef = useRef(false);
  // 当前 TTS 播放句柄，用于打断
  const ttsHandleRef = useRef<TtsHandle | null>(null);
  // VAD 触发但 AI 尚未 idle 时的待发文本
  const pendingVoiceSendRef = useRef<string | null>(null);

  // status 回 idle 时冲刷待发语音文本
  const status = useChatStore((s) => s.status);
  useEffect(() => {
    if (status !== "idle") return;
    const pending = pendingVoiceSendRef.current;
    if (!pending) return;
    pendingVoiceSendRef.current = null;
    void sendContentRef.current(pending, "voice");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ASR transcript 仅用于更新 hint
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listenAsrTranscript(({ sessionId }) => {
      if (disposed || sessionId !== asrSessionRef.current) return;
      setAsrHint("Listening...");
    })
      .then((cleanup) => {
        if (disposed) { cleanup(); return; }
        unlisten = cleanup;
      })
      .catch((err) => console.error("ASR listener error:", err));

    return () => { disposed = true; unlisten?.(); };
  }, []);

  const speakReply = useCallback(async (reply: string, onPlaybackStart?: () => void) => {
    const { voiceEnabled, ttsApiKey, ttsResourceId, ttsSpeaker } = useSettingsStore.getState();
    if (!reply.trim() || !voiceEnabled) return;
    if (!ttsApiKey || !ttsResourceId) {
      setAsrHint(!ttsApiKey ? "Missing Volcengine API key" : "Missing TTS resource ID");
      return;
    }
    setStatus("speaking");
    setAsrHint("Speaking...");
    const handle = playTts({
      apiKey: ttsApiKey,
      resourceId: ttsResourceId,
      speaker: ttsSpeaker,
      text: reply,
      onStart: onPlaybackStart,
    });
    ttsHandleRef.current = handle;
    await handle.promise;
    ttsHandleRef.current = null;
    setAsrHint("");
  }, [setStatus]);

  // sendContent 存 ref 供 status effect 调用，避免闭包失效
  const sendContentRef = useRef<(rawContent: string, source?: InputSource) => Promise<void>>(async () => {});

  const sendContent = useCallback(async (rawContent: string, source: InputSource = "text") => {
    const content = rawContent.trim();
    const currentStatus = useChatStore.getState().status;

    // 语音模式下若 AI 还在处理，先排队，等 idle 后再发
    if (source === "voice" && currentStatus !== "idle") {
      pendingVoiceSendRef.current = content;
      // 如果 TTS 正在播放则打断
      ttsHandleRef.current?.cancel();
      return;
    }

    if (!content || !settings.apiKey || currentStatus !== "idle") return;
    const delayReplyDisplay = source === "voice" && settings.voiceEnabled && !!settings.ttsApiKey && !!settings.ttsResourceId;

    setAsrHint("");

    const userMsg = {
      id: crypto.randomUUID(),
      sender: "user" as const,
      text: content,
      timestamp: Date.now(),
    };
    useChatStore.setState((s) => ({ messages: [...s.messages, userMsg] }));
    await saveMessage(userMsg);

    setStatus("thinking");

    let accumulated = "";
    const aliceId = crypto.randomUUID();
    const aliceTs = Date.now();
    const history = useChatStore.getState().messages.slice(-40);
    const memories = useMemoryStore.getState().fragments;

    useChatStore.setState((s) => ({
      messages: [
        ...s.messages,
        { id: aliceId, sender: "alice", text: "", timestamp: aliceTs },
      ],
    }));

    await streamChat({
      messages: history,
      apiKey: settings.apiKey,
      model: settings.model,
      systemPrompts: [
        TAVERN_SYSTEM_PROMPT,
        buildTayamaContextPrompt(memories),
      ],
      onChunk: (chunk) => {
        accumulated += chunk;
        if (delayReplyDisplay) return;

        useChatStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === aliceId ? { ...m, text: accumulated } : m
          ),
        }));
      },
      onDone: async () => {
        const finalMsg = {
          id: aliceId,
          sender: "alice" as const,
          text: accumulated,
          timestamp: aliceTs,
        };
        await saveMessage(finalMsg);

        // 解析表情并更新
        const emotion = getEmotion(accumulated);
        if (emotion) useUIStore.getState().setEmotion(emotion);

        // 计数并按需触发记忆蒸馏（fire-and-forget，不阻塞回复流）
        const { apiKey, model } = useSettingsStore.getState();
        void tickAndDistill(useChatStore.getState().messages, apiKey, model);

        try {
          await speakReply(
            getSpokenText(accumulated),
            delayReplyDisplay ? () => revealReplyText(aliceId, accumulated) : undefined
          );
        } catch (err) {
          console.error("TTS error:", err);
          setAsrHint(errorMessage(err, "TTS failed"));
          setAliceMessageText(aliceId, accumulated);
        }
        if (delayReplyDisplay && !useChatStore.getState().messages.find((m) => m.id === aliceId)?.text) {
          setAliceMessageText(aliceId, accumulated);
        }
        setStatus("idle");
      },
      onError: (err) => {
        setStatus("idle");
        console.error("AI error:", err);
        useChatStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === aliceId ? { ...m, text: "..." } : m
          ),
        }));
      },
    });
  }, [settings.apiKey, settings.model, settings.ttsApiKey, settings.ttsResourceId, settings.voiceEnabled, setStatus, speakReply]);

  // 保持 ref 同步，让 status effect 能调到最新版本
  sendContentRef.current = sendContent;

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content) return;
    setText("");
    await sendContent(content, "text");
  }, [text, sendContent]);

  // 启动一个新 ASR session，绑到当前 recorder 的音频流
  const rotateAsrSession = useCallback(async (apiKey: string) => {
    const sessionId = await startAsrStream({ apiKey });
    asrSessionRef.current = sessionId;
    audioPushRef.current = Promise.resolve();
    return sessionId;
  }, []);

  const startVoiceMode = useCallback(async () => {
    if (!settings.ttsApiKey) {
      setAsrHint("Missing Volcengine API key");
      return;
    }
    try {
      setAsrHint("Connecting...");
      voiceModeRef.current = true;
      const recorder = new RealtimePcmRecorder();
      recorderRef.current = recorder;

      // recorder 启动后再建 session，避免音频在 session 就绪前丢失
      await recorder.start((chunk) => {
        const sid = asrSessionRef.current;
        if (!sid || chunk.byteLength === 0) return;
        audioPushRef.current = audioPushRef.current
          .then(() => pushAsrAudio({ sessionId: sid, audio: chunk }))
          .catch((err) => console.error("ASR push error:", err));
      });

      await rotateAsrSession(settings.ttsApiKey);
      setStatus("recording");
      setAsrHint("Listening...");
    } catch (err) {
      console.error("ASR start error:", err);
      setAsrHint(errorMessage(err, "ASR start failed"));
      voiceModeRef.current = false;
      recorderRef.current = null;
      setStatus("idle");
    }
  }, [settings.ttsApiKey, setStatus, rotateAsrSession]);

  const stopVoiceMode = useCallback(async () => {
    voiceModeRef.current = false;
    ttsHandleRef.current?.cancel();
    pendingVoiceSendRef.current = null;

    const recorder = recorderRef.current;
    const sessionId = asrSessionRef.current;
    recorderRef.current = null;
    asrSessionRef.current = null;

    setStatus("idle");
    setAsrHint("");

    // 静默关闭最后一个 session（不取文字）
    if (recorder && sessionId) {
      try {
        const tail = recorder.flushPending();
        await recorder.stop();
        await finishAsrStream({ sessionId, audio: tail }).catch(() => {});
      } catch (err) {
        console.error("ASR stop error:", err);
      }
    }
  }, [setStatus]);

  // VAD 触发：session 轮换 + 用 vad-end 携带的文本发送，麦克风不停
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listenAsrVadEnd(({ sessionId, text: vadText }) => {
      if (disposed || sessionId !== asrSessionRef.current) return;
      if (!voiceModeRef.current || !recorderRef.current) return;

      const apiKey = useSettingsStore.getState().ttsApiKey;
      if (!apiKey) return;

      const oldSessionId = sessionId;
      // 抢救尾音后立即建新 session，旧 session 后台关闭
      const tail = recorderRef.current.flushPending();
      asrSessionRef.current = null;

      rotateAsrSession(apiKey)
        .then(() => {
          // 旧 session 静默收尾（只为关 WebSocket，不取文字）
          finishAsrStream({ sessionId: oldSessionId, audio: tail }).catch(() => {});
        })
        .catch((err) => console.error("ASR rotate error:", err));

      const content = vadText.trim();
      if (content) {
        console.log("[VAD] sending:", content);
        void sendContentRef.current(content, "voice");
      }
    })
      .then((cleanup) => {
        if (disposed) { cleanup(); return; }
        unlisten = cleanup;
      })
      .catch((err) => console.error("ASR VAD listener error:", err));

    return () => { disposed = true; unlisten?.(); };
  }, [rotateAsrSession]);

  const [isVoiceMode, setIsVoiceMode] = useState(false);

  const startVoiceModeWithState = useCallback(async () => {
    setIsVoiceMode(true);
    await startVoiceMode();
  }, [startVoiceMode]);

  const stopVoiceModeWithState = useCallback(async () => {
    setIsVoiceMode(false);
    await stopVoiceMode();
  }, [stopVoiceMode]);

  const toggleRecording = useCallback(() => {
    if (voiceModeRef.current) {
      void stopVoiceModeWithState();
    } else {
      void startVoiceModeWithState();
    }
  }, [startVoiceModeWithState, stopVoiceModeWithState]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const isDisabled = status === "thinking" || status === "speaking";
  const isRecording = isVoiceMode;

  return (
    <section className="fixed bottom-0 left-16 right-0 pb-16 flex justify-center px-6 z-30">
      <div className="w-full max-w-2xl relative group">
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setAsrHint("");
            setText(e.target.value);
          }}
          onKeyDown={onKeyDown}
          disabled={isDisabled}
          placeholder={isRecording ? "Listening..." : isDisabled ? "..." : "Tell me something..."}
          className="w-full bg-transparent border-b border-outline-variant/30 py-4 px-12 text-body-lg text-on-surface focus:outline-none focus:border-primary transition-colors placeholder:text-outline-variant/50 placeholder:italic disabled:opacity-40"
        />

        {/* 麦克风按钮 */}
        <button
          onClick={toggleRecording}
          disabled={isDisabled}
          className={`absolute left-0 bottom-4 transition-colors active:scale-95 disabled:opacity-30 ${
            isRecording ? "text-primary animate-pulse" : "text-on-surface-variant hover:text-primary"
          }`}
        >
          <span className="material-symbols-outlined">{isRecording ? "stop_circle" : "mic"}</span>
        </button>

        {/* 发送按钮 */}
        <button
          onClick={send}
          disabled={isDisabled || isRecording || !text.trim()}
          className="absolute right-0 bottom-4 text-on-surface-variant hover:text-primary transition-colors active:scale-95 disabled:opacity-30"
        >
          <span className="material-symbols-outlined">north_east</span>
        </button>

        {/* 输入焦点下划线 */}
        <div className="absolute bottom-0 left-0 h-[1px] bg-primary w-0 group-focus-within:w-full transition-all duration-700" />
      </div>
    </section>
  );
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : String(err || fallback);
}

function setAliceMessageText(id: string, text: string) {
  useChatStore.setState((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, text } : m)),
  }));
}

async function revealReplyText(id: string, rawText: string) {
  const language = useUIStore.getState().displayLanguage;
  const displayText = getDisplayText(rawText, language);
  let tempo = createTypingTempo();

  if (!displayText) {
    setAliceMessageText(id, rawText);
    return;
  }

  await revealPlainText(id, displayText, tempo);

  setAliceMessageText(id, rawText);
}

async function revealPlainText(id: string, text: string, initialTempo: TypingTempo) {
  let tempo = initialTempo;
  for (let i = 1; i <= text.length; i += 1) {
    setAliceMessageText(id, text.slice(0, i));
    await wait(tempo.delay);
    tempo = nextTypingTempo(tempo);
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

interface TypingTempo {
  delay: number;
  target: number;
}

function createTypingTempo(): TypingTempo {
  const delay = randomInt(170, 260);
  return {
    delay,
    target: randomInt(130, 330),
  };
}

function nextTypingTempo({ delay, target }: TypingTempo): TypingTempo {
  const distance = target - delay;
  const drift = clamp(distance * 0.22 + randomInt(-5, 5), -20, 20);
  const nextDelay = clamp(delay + drift, 130, 330);
  const nextTarget = Math.abs(target - nextDelay) < 12 ? randomInt(130, 330) : target;

  return {
    delay: nextDelay,
    target: nextTarget,
  };
}

function randomInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
