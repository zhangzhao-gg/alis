/**
 * [INPUT]: 依赖 stores/index 的 useChatStore、useSettingsStore、useMemoryStore；依赖 lib/ai、lib/asr、lib/tts、lib/recorder
 * [OUTPUT]: 对外提供 InputBar 组件
 * [POS]: 底部输入区，处理文字发送、流式 AI 回复、持续语音模式（麦克风常开 + VAD 判停 + TTS 打断）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore, useMemoryStore, useSettingsStore, useUIStore } from "@/stores";
import { completeChat } from "@/lib/ai";
import { getContextWindowSize, getCoreRecentMemory, saveMessage } from "@/lib/db";
import { tickAndDistill } from "@/lib/memory";
import { playTts, type TtsHandle } from "@/lib/tts";
import { TAVERN_SYSTEM_PROMPT, buildTayamaContextPrompt, getCharacterStatus } from "@/lib/persona";
import { getVoiceConfig } from "@/lib/characterVoice";
import { tickAffinity } from "@/lib/affinity";
import { getDisplayText, getSpokenText, getEmotion, splitDisplaySentences } from "@/lib/messageText";
import { cleanModelReply } from "@/lib/replyPostprocess";
import { debugError, debugLog } from "@/lib/debugLog";
import {
  finishAsrStream,
  finishAliAsrStream,
  listenAsrTranscript,
  listenAsrVadEnd,
  pushAsrAudio,
  pushAliAsrAudio,
  startAsrStream,
  startAliAsrStream,
} from "@/lib/asr";
import { RealtimePcmRecorder } from "@/lib/recorder";

type InputSource = "text" | "voice";
type VoicePhase = "idle" | "connecting" | "connected";

const MIN_VOICE_USER_TEXT_MS = 1500;
const VOICE_REPLY_LINE_INTERVAL_MS = 900;
const MAX_AI_FORMAT_ATTEMPTS = 3;
const STRICT_JSON_RETRY_PROMPT = [
  "上一轮输出格式不合格。请重新回答同一个用户问题。",
  "只能输出一个合法 JSON 对象，不能输出数组、纯文本、Markdown 或动作描写外壳。",
  "格式必须严格为：{\"ja\":\"完整自然日文\",\"zh\":\"对应中文译文\",\"emotion\":\"表情名称\"}",
  "ja、zh、emotion 三个字段必须存在且不能为空。字段内双引号必须转义为 \\\"。",
].join("\n");

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
  const voiceUserHoldUntilRef = useRef(0);

  // ASR transcript 仅用于更新 hint
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listenAsrTranscript(({ sessionId }) => {
      if (disposed || sessionId !== asrSessionRef.current) return;
      debugLog("[ASR] transcript received", {
        sessionId,
        status: useChatStore.getState().status,
      });
      // barge-in：ASR 一识别到用户开口就立即掐断 TTS，不等整句说完
      if (useChatStore.getState().status === "speaking") {
        const handle = ttsHandleRef.current;
        if (handle) {
          debugLog("[VOICE] barge-in on transcript: stopping TTS immediately");
          handle.cancel();
          ttsHandleRef.current = null;
        }
      }
      setAsrHint("Listening...");
    })
      .then((cleanup) => {
        if (disposed) { cleanup(); return; }
        unlisten = cleanup;
      })
      .catch((err) => console.error("ASR listener error:", err));

    return () => { disposed = true; unlisten?.(); };
  }, []);

  // 启动一个新 ASR session
  const rotateAsrSession = useCallback(async (apiKey: string) => {
    const { asrProvider, asrAliWorkspaceId, asrAliApiKey } = useSettingsStore.getState();
    debugLog("[ASR] rotate session start", { provider: asrProvider });
    const sessionId = asrProvider === "aliyun"
      ? await startAliAsrStream({ workspaceId: asrAliWorkspaceId, apiKey: asrAliApiKey })
      : await startAsrStream({ apiKey });
    asrSessionRef.current = sessionId;
    audioPushRef.current = Promise.resolve();
    debugLog("[ASR] rotate session ready", { provider: asrProvider, sessionId });
    return sessionId;
  }, []);

  const startVoiceCapture = useCallback(async (apiKey: string) => {
    if (recorderRef.current) return;

    debugLog("[ASR] capture starting");
    const recorder = new RealtimePcmRecorder();
    recorderRef.current = recorder;

    await recorder.start((chunk) => {
      const sid = asrSessionRef.current;
      if (!sid || chunk.byteLength === 0) return;
      const { asrProvider } = useSettingsStore.getState();
      const pushFn = asrProvider === "aliyun" ? pushAliAsrAudio : pushAsrAudio;
      audioPushRef.current = audioPushRef.current
        .then(() => pushFn({ sessionId: sid, audio: chunk }))
        .catch((err) => {
          debugError("[ASR] push error", errorMessage(err, "ASR push failed"));
        });
    });

    await rotateAsrSession(apiKey);
    debugLog("[ASR] capture started");
  }, [rotateAsrSession]);

  const speakReply = useCallback(async (reply: string, onPlaybackStart?: () => void, force = false) => {
    const { voiceEnabled, ttsApiKey } = useSettingsStore.getState();
    const voiceConfig = getVoiceConfig(getCharacterStatus());
    const { resourceId: ttsResourceId, speaker: ttsSpeaker } = voiceConfig;
    const spokenText = reply.trim();
    if (!spokenText) {
      debugLog("[TTS] skipped: empty spoken text");
      return;
    }
    if (!voiceEnabled && !force) {
      debugLog("[TTS] skipped: voice reply disabled");
      return;
    }
    if (!ttsApiKey || !ttsResourceId) {
      setAsrHint(!ttsApiKey ? "Missing Volcengine API key" : "Missing TTS resource ID");
      debugLog("[TTS] skipped: missing config", { hasApiKey: !!ttsApiKey, hasResourceId: !!ttsResourceId });
      return;
    }
    setStatus("speaking");
    setAsrHint("Speaking...");

    debugLog("[TTS] request playback", {
      chars: spokenText.length,
      resourceId: ttsResourceId,
      speaker: ttsSpeaker,
      forcedByVoiceMode: force,
    });
    const handle = playTts({
      apiKey: ttsApiKey,
      resourceId: ttsResourceId,
      speaker: ttsSpeaker,
      text: spokenText,
      onStart: onPlaybackStart,
      mode: force ? "duplex" : "normal",
    });
    ttsHandleRef.current = handle;
    try {
      await handle.promise;
      debugLog("[TTS] playback finished");
    } finally {
      ttsHandleRef.current = null;
      setAsrHint("");
    }
  }, [setStatus]);

  // sendContent 存 ref 供 status effect 调用，避免闭包失效
  const sendContentRef = useRef<(rawContent: string, source?: InputSource) => Promise<void>>(async () => {});

  const sendContent = useCallback(async (rawContent: string, source: InputSource = "text") => {
    const content = rawContent.trim();
    const currentStatus = useChatStore.getState().status;
    const isVoiceRecording = source === "voice" && currentStatus === "recording";
    const isVoiceThinking = source === "voice" && currentStatus === "thinking";
    const isVoiceSpeaking = source === "voice" && currentStatus === "speaking";
    debugLog("[VOICE] sendContent requested", {
      source,
      currentStatus,
      chars: content.length,
      preview: content.slice(0, 80),
    });

    // 语音模式下 AI 还在思考时直接丢弃，避免连续短句误触发排队后被发送
    if (isVoiceThinking) {
      debugLog("[VOICE] sendContent skipped: already thinking", { chars: content.length });
      return;
    }

    // TTS 播放中收到 ASR 结果 —— barge-in：打断 TTS，处理用户输入
    if (isVoiceSpeaking) {
      if (!content) return;
      debugLog("[VOICE] barge-in: interrupting TTS", content);
      const handle = ttsHandleRef.current;
      if (handle) {
        handle.cancel();
        ttsHandleRef.current = null;
      }
      // 落到下方正常处理 content
    }

    if (!content) {
      debugLog("[VOICE] sendContent skipped: empty content", { source });
      return;
    }
    if (!settings.apiKey) {
      debugLog("[VOICE] sendContent skipped: missing chat API key", { source });
      return;
    }
    if (currentStatus !== "idle" && !isVoiceRecording && !isVoiceSpeaking) {
      debugLog("[VOICE] sendContent skipped: blocked by status", { source, currentStatus });
      return;
    }

    setAsrHint("");

    const previousMessages = useChatStore.getState().messages;
    const userMsg = {
      id: crypto.randomUUID(),
      sender: "user" as const,
      text: content,
      timestamp: Date.now(),
    };
    const contextWindowSize = await getContextWindowSize();
    const history = [...previousMessages, userMsg].slice(-contextWindowSize);
    useChatStore.setState({ messages: [...previousMessages, userMsg] });
    await saveMessage(userMsg);
    if (source === "voice") {
      voiceUserHoldUntilRef.current = Date.now() + MIN_VOICE_USER_TEXT_MS;
    }

    setStatus("thinking");
    debugLog("[AI] request start", {
      source,
      historyMessages: history.length,
      userChars: content.length,
      model: settings.model,
    });

    const aliceId = crypto.randomUUID();
    const aliceTs = Date.now();
    const memories = useMemoryStore.getState().fragments;
    const coreRecentMemory = await getCoreRecentMemory();

    useChatStore.setState((s) => ({
      messages: [
        ...s.messages,
        { id: aliceId, sender: "alice", text: "", timestamp: aliceTs },
      ],
    }));

    const systemPrompts = [
      TAVERN_SYSTEM_PROMPT,
      buildTayamaContextPrompt(memories, coreRecentMemory),
    ];

    const requestReply = async (prompts: string[], attempt: "primary" | "retry") => {
      debugLog("[AI] request attempt start", { source, attempt });
      const reply = await completeChat({
        messages: history,
        apiKey: settings.apiKey,
        model: settings.model,
        systemPrompts: prompts,
      });
      debugLog("[AI] response received", { source, attempt, chars: reply.length });
      return reply;
    };

    try {
      const rawReply = await requestValidReply(systemPrompts);
      await handleModelReply(rawReply);
    } catch (err) {
      setStatus(voiceModeRef.current ? "recording" : "idle");
      debugError("[AI] error", errorMessage(err, "AI request failed"));
      useChatStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === aliceId ? { ...m, text: "..." } : m
        ),
      }));
    }

    async function requestValidReply(prompts: string[]) {
      let lastReply = "";

      for (let attemptIndex = 1; attemptIndex <= MAX_AI_FORMAT_ATTEMPTS; attemptIndex += 1) {
        const attempt = attemptIndex === 1 ? "primary" : "retry";
        const retryPrompt = attemptIndex === 1 ? [] : [STRICT_JSON_RETRY_PROMPT];
        const rawReply = await requestReply([...prompts, ...retryPrompt], attempt);
        lastReply = rawReply;

        if (isStrictReplyJson(rawReply)) return rawReply;

        debugError("[AI] invalid response protocol", {
          source,
          attempt: attemptIndex,
          maxAttempts: MAX_AI_FORMAT_ATTEMPTS,
          rawPreview: rawReply.slice(0, 220),
          rawChars: rawReply.length,
        });
      }

      throw new Error(`AI response protocol invalid after ${MAX_AI_FORMAT_ATTEMPTS} attempts: ${JSON.stringify(lastReply)}`);
    }

    async function handleModelReply(rawReply: string) {
        const cleanedReply = cleanModelReply(rawReply);
        debugLog("[AI] raw response", JSON.stringify(rawReply));
        debugLog("[AI] cleaned response", JSON.stringify(cleanedReply));
        if (!cleanedReply.trim()) {
          debugError("[AI] empty response after stream done", {
            source,
            rawChars: rawReply.length,
            rawPreview: rawReply.slice(0, 200),
            rawCharCodes: [...rawReply.slice(0, 80)].map((char) => char.charCodeAt(0)),
            model: settings.model,
          });
        }
        debugLog("[AI] response done", {
          source,
          rawChars: rawReply.length,
          cleanedChars: cleanedReply.length,
          spokenChars: getSpokenText(cleanedReply).length,
        });
        const finalMsg = {
          id: aliceId,
          sender: "alice" as const,
          text: cleanedReply,
          timestamp: aliceTs,
        };
        await saveMessage(finalMsg);
        const completedMessages = useChatStore
          .getState()
          .messages
          .map((m) => (m.id === aliceId ? finalMsg : m));

        // 解析表情并更新
        const emotion = getEmotion(cleanedReply);
        if (emotion) useUIStore.getState().setEmotion(emotion);

        // 计数并按需触发记忆蒸馏（fire-and-forget，不阻塞回复流）
        const { apiKey, model } = useSettingsStore.getState();
        void tickAndDistill(completedMessages, apiKey, model);
        void tickAffinity();

        if (source === "voice") {
          debugLog("[VOICE] holding user transcript before reply", {
            untilMs: Math.max(0, voiceUserHoldUntilRef.current - Date.now()),
          });
          await waitUntil(voiceUserHoldUntilRef.current);
        }

        try {
          debugLog("[TTS] speakReply start", { source });
          await speakReply(
            getSpokenText(cleanedReply),
            () => revealReplyText(aliceId, cleanedReply, source === "voice" ? "lineFade" : "typewriter"),
            source === "voice"
          );
          debugLog("[TTS] speakReply resolved", { source });
        } catch (err) {
          debugError("[TTS] error", errorMessage(err, "TTS failed"));
          setAsrHint(errorMessage(err, "TTS failed"));
        }
        // TTS 未开启或失败时 onStart 不会触发，确保文字最终显示
        if (!useChatStore.getState().messages.find((m) => m.id === aliceId)?.text) {
          await revealReplyText(aliceId, cleanedReply, source === "voice" ? "lineFade" : "typewriter");
        }
        setStatus(voiceModeRef.current ? "recording" : "idle");
        debugLog("[VOICE] turn complete", {
          source,
          nextStatus: voiceModeRef.current ? "recording" : "idle",
        });
    }
  }, [settings.apiKey, settings.model, settings.ttsApiKey, settings.ttsResourceId, settings.voiceEnabled, setStatus, speakReply]);

  // 保持 ref 同步，让 status effect 能调到最新版本
  sendContentRef.current = sendContent;

  const send = useCallback(async () => {
    const content = text.trim();
    if (!content) return;
    setText("");
    await sendContent(content, "text");
  }, [text, sendContent]);

  const startVoiceMode = useCallback(async (): Promise<boolean> => {
    const { asrProvider, ttsApiKey, asrAliWorkspaceId, asrAliApiKey } = useSettingsStore.getState();
    if (asrProvider === "volcengine" && !ttsApiKey) {
      setAsrHint("Missing Volcengine API key");
      return false;
    }
    if (asrProvider === "aliyun" && (!asrAliWorkspaceId || !asrAliApiKey)) {
      setAsrHint("Missing Aliyun Workspace ID or API key");
      return false;
    }
    try {
      setAsrHint("Connecting...");
      voiceModeRef.current = true;
      await startVoiceCapture(ttsApiKey);
      setStatus("recording");
      setAsrHint("Listening...");
      return true;
    } catch (err) {
      console.error("ASR start error:", err);
      debugError("[ASR] start error", errorMessage(err, "ASR start failed"));
      setAsrHint(errorMessage(err, "ASR start failed"));
      voiceModeRef.current = false;
      recorderRef.current = null;
      setStatus("idle");
      return false;
    }
  }, [setStatus, startVoiceCapture]);

  const stopVoiceMode = useCallback(async () => {
    voiceModeRef.current = false;
    ttsHandleRef.current?.cancel();

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
        const { asrProvider } = useSettingsStore.getState();
        const finishFn = asrProvider === "aliyun" ? finishAliAsrStream : finishAsrStream;
        await finishFn({ sessionId, audio: tail }).catch(() => {});
      } catch (err) {
        console.error("ASR stop error:", err);
        debugError("[ASR] stop error", errorMessage(err, "ASR stop failed"));
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
      debugLog("[ASR] vad-end received", {
        sessionId,
        chars: vadText.trim().length,
        text: vadText.trim().slice(0, 120),
        status: useChatStore.getState().status,
      });

      // TTS 播放中不拦截 VAD —— 让 sendContent 的 barge-in 分支处理打断
      const { asrProvider, ttsApiKey, asrAliWorkspaceId, asrAliApiKey } = useSettingsStore.getState();
      const apiKey = ttsApiKey;
      if (asrProvider === "volcengine" && !apiKey) return;
      if (asrProvider === "aliyun" && (!asrAliWorkspaceId || !asrAliApiKey)) return;

      const oldSessionId = sessionId;
      const pendingAudioPush = audioPushRef.current;
      // 抢救尾音后立即建新 session，旧 session 后台关闭
      const tail = recorderRef.current.flushPending();
      asrSessionRef.current = null;
      debugLog("[ASR] rotate after vad-end", {
        oldSessionId,
        tailBytes: tail.byteLength,
        provider: asrProvider,
      });

      rotateAsrSession(apiKey)
        .then(async () => {
          await pendingAudioPush.catch(() => {});
          const finishFn = asrProvider === "aliyun" ? finishAliAsrStream : finishAsrStream;
          await finishFn({ sessionId: oldSessionId, audio: tail }).catch(() => {});
          debugLog("[ASR] previous session finished", { oldSessionId });
        })
        .catch((err) => {
          console.error("ASR rotate error:", err);
          debugError("[ASR] rotate after vad-end failed", errorMessage(err, "ASR rotate failed"));
        });

      const content = vadText.trim();
      if (content) {
        debugLog("[VAD] sending", content);
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

  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");

  const startVoiceModeWithState = useCallback(async () => {
    setVoicePhase("connecting");
    useUIStore.getState().setVoiceCallActive(true);
    const started = await startVoiceMode();
    if (!started) {
      setVoicePhase("idle");
      useUIStore.getState().setVoiceCallActive(false);
      return;
    }
    setVoicePhase("connected");
  }, [startVoiceMode]);

  const stopVoiceModeWithState = useCallback(async () => {
    setVoicePhase("idle");
    useUIStore.getState().setVoiceCallActive(false);
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
  const isVoiceUiActive = voicePhase !== "idle";

  return (
    <section className="fixed bottom-0 left-16 right-0 pb-14 flex justify-center px-6 z-30">
      {isVoiceUiActive ? (
        <button
          onClick={toggleRecording}
          disabled={voicePhase === "connecting"}
          className="relative flex h-16 w-16 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary shadow-[0_0_45px_rgba(216,191,214,0.22)] transition-all duration-500 hover:bg-primary/25 active:scale-95 disabled:cursor-default"
          aria-label="End voice call"
        >
          {voicePhase === "connecting" ? (
            <>
              <span className="absolute -inset-2 rounded-full border border-primary/25 animate-ping" />
              <span className="absolute inset-0 rounded-full border border-primary/20 animate-ping [animation-delay:180ms]" />
            </>
          ) : (
            <span className="absolute inset-0 rounded-full border border-primary/25 animate-pulse" />
          )}
          <span className="material-symbols-outlined relative text-3xl">
            {voicePhase === "connecting" ? "call" : "call_end"}
          </span>
        </button>
      ) : (
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
            placeholder={isDisabled ? "..." : "Tell me something..."}
            className="w-full bg-transparent border-b border-outline-variant/30 py-4 pl-4 pr-24 text-body-lg text-on-surface focus:outline-none focus:border-primary transition-colors placeholder:text-outline-variant/50 placeholder:italic disabled:opacity-40"
          />

          <button
            onClick={toggleRecording}
            disabled={isDisabled}
            className="absolute right-10 bottom-4 text-on-surface-variant hover:text-primary transition-colors active:scale-95 disabled:opacity-30"
            aria-label="Start voice call"
          >
            <span className="material-symbols-outlined">call</span>
          </button>

          <button
            onClick={send}
            disabled={isDisabled || !text.trim()}
            className="absolute right-0 bottom-4 text-on-surface-variant hover:text-primary transition-colors active:scale-95 disabled:opacity-30"
            aria-label="Send message"
          >
            <span className="material-symbols-outlined">north_east</span>
          </button>

          <div className="absolute bottom-0 left-0 h-[1px] bg-primary w-0 group-focus-within:w-full transition-all duration-700" />
        </div>
      )}
    </section>
  );
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : String(err || fallback);
}

function isStrictReplyJson(rawText: string) {
  const text = rawText.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return false;

  try {
    const parsed = JSON.parse(text) as {
      ja?: unknown;
      zh?: unknown;
      emotion?: unknown;
    };
    return (
      typeof parsed.ja === "string" &&
      parsed.ja.trim().length > 0 &&
      typeof parsed.zh === "string" &&
      parsed.zh.trim().length > 0 &&
      typeof parsed.emotion === "string" &&
      VALID_REPLY_EMOTIONS.has(parsed.emotion)
    );
  } catch {
    return false;
  }
}

const VALID_REPLY_EMOTIONS = new Set([
  "平静", "微笑", "开心笑", "大笑", "害羞", "害羞笑", "得意", "思考", "疑惑",
  "惊讶", "震惊", "郁闷", "不爽", "生气", "大哭", "睡觉",
]);

function setAliceMessageText(id: string, text: string) {
  useChatStore.setState((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, text } : m)),
  }));
}

async function revealReplyText(id: string, rawText: string, mode: "typewriter" | "lineFade") {
  if (mode === "lineFade") {
    await revealVoiceReplyLines(id, rawText);
    return;
  }

  const language = useUIStore.getState().displayLanguage;
  const displayText = getDisplayText(rawText, language);
  const tempo = createTypingTempo();

  await revealPlainText(id, displayText || rawText, tempo);
  setAliceMessageText(id, rawText);
}

async function revealVoiceReplyLines(id: string, rawText: string) {
  const language = useUIStore.getState().displayLanguage;
  const displayText = getDisplayText(rawText, language);
  const lines = splitDisplaySentences(displayText || rawText).filter((line) => line.trim());

  if (!lines.length) {
    setAliceMessageText(id, rawText);
    return;
  }

  let visibleText = "";
  for (const line of lines) {
    visibleText = visibleText ? `${visibleText}\n${line}` : line;
    setAliceMessageText(id, visibleText);
    await wait(VOICE_REPLY_LINE_INTERVAL_MS);
  }
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

function waitUntil(timestamp: number) {
  return wait(Math.max(0, timestamp - Date.now()));
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
