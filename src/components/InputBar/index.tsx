/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、useSettingsStore、useMemoryStore；依赖 lib/ai、lib/asr、lib/tts、lib/recorder
 * [OUTPUT]: 对外提供 InputBar 组件
 * [POS]: 底部输入区，处理文字发送和流式 AI 回复
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore, useMemoryStore, useSettingsStore, useUIStore } from "@/stores";
import { streamChat } from "@/lib/ai";
import { saveMessage } from "@/lib/db";
import { tickAndDistill } from "@/lib/memory";
import { playTts } from "@/lib/tts";
import { TAVERN_SYSTEM_PROMPT, buildTayamaContextPrompt } from "@/lib/persona";
import { getDisplayText, getSpokenText } from "@/lib/messageText";
import {
  finishAsrStream,
  listenAsrTranscript,
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

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listenAsrTranscript(({ sessionId, text }) => {
      if (disposed || sessionId !== asrSessionRef.current) return;
      setText(text);
      setAsrHint("Listening...");
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((err) => {
        console.error("ASR listener error:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
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
    await playTts({
      apiKey: ttsApiKey,
      resourceId: ttsResourceId,
      speaker: ttsSpeaker,
      text: reply,
      onStart: onPlaybackStart,
    });
    setAsrHint("");
  }, [setStatus]);

  const sendContent = useCallback(async (rawContent: string, source: InputSource = "text") => {
    const content = rawContent.trim();
    const currentStatus = useChatStore.getState().status;
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

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content) return;

    setText("");
    await sendContent(content, "text");
  }, [text, sendContent]);

  const startRecording = useCallback(async () => {
    if (!settings.ttsApiKey) {
      setAsrHint("Missing Volcengine API key");
      return;
    }

    try {
      setAsrHint("Connecting...");
      const sessionId = await startAsrStream({
        apiKey: settings.ttsApiKey,
      });
      asrSessionRef.current = sessionId;

      setAsrHint("Listening...");
      const recorder = new RealtimePcmRecorder();
      audioPushRef.current = Promise.resolve();
      await recorder.start((chunk) => {
        const activeSessionId = asrSessionRef.current;
        if (!activeSessionId || chunk.byteLength === 0) return;

        audioPushRef.current = audioPushRef.current
          .then(() =>
            pushAsrAudio({
              sessionId: activeSessionId,
              audio: chunk,
            })
          )
          .catch((err) => {
            console.error("ASR push error:", err);
            setAsrHint(errorMessage(err, "ASR push failed"));
          });
      });
      recorderRef.current = recorder;
      setStatus("recording");
    } catch (err) {
      console.error("ASR start error:", err);
      setAsrHint(errorMessage(err, "ASR start failed"));
      setStatus("idle");
    }
  }, [settings.ttsApiKey, setStatus]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    const sessionId = asrSessionRef.current;
    recorderRef.current = null;
    asrSessionRef.current = null;

    try {
      const finalChunk = await recorder.stop();
      await audioPushRef.current;
      if (!sessionId) throw new Error("ASR session missing");

      setAsrHint("Transcribing...");
      const content = (await finishAsrStream({
        sessionId,
        audio: finalChunk,
      })).trim();

      if (!content) {
        setAsrHint("No speech detected");
        return;
      }

      setText("");
      setStatus("idle");
      await sendContent(content, "voice");
    } catch (err) {
      console.error("ASR error:", err);
      setAsrHint(errorMessage(err, "ASR failed"));
    } finally {
      setStatus("idle");
    }
  }, [sendContent, setStatus]);

  const toggleRecording = useCallback(() => {
    if (recorderRef.current) {
      void stopRecording();
      return;
    }
    void startRecording();
  }, [startRecording, stopRecording]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const status = useChatStore((s) => s.status);
  const isDisabled = status === "thinking" || status === "speaking";
  const isRecording = status === "recording";

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
