/**
 * [INPUT]: 依赖 stores/index 的 Message 类型，依赖 lib/aiModels 的模型路由
 * [OUTPUT]: 对外提供 completeChat、completePrompt 函数
 * [POS]: lib 层的 AI 接入，封装 OpenAI-compatible Chat Completions，并给上下文消息注入时间标签
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Message } from "@/stores";
import { debugLog } from "@/lib/debugLog";
import { resolveAIModel } from "@/lib/aiModels";

type ChatRole = "system" | "user" | "assistant";

interface ChatPayloadMessage {
  role: ChatRole;
  content: string;
}

interface CompleteChatOptions {
  messages: Message[];
  apiKey: string;
  model: string;
  systemPrompts: string[];
}

export async function completeChat({
  messages,
  apiKey,
  model,
  systemPrompts,
}: CompleteChatOptions): Promise<string> {
  return requestChatCompletion({
    apiKey,
    model,
    messages: [
      ...systemPrompts
        .map((content) => content.trim())
        .filter(Boolean)
        .map((content): ChatPayloadMessage => ({ role: "system", content })),
      ...messages.map((m) => ({
        role: m.sender === "user" ? "user" as const : "assistant" as const,
        content: withMessageTimeTag(m.timestamp, m.text),
      })),
    ],
    jsonMode: true,
  });
}

export async function completePrompt({
  apiKey,
  model,
  prompt,
}: {
  apiKey: string;
  model: string;
  prompt: string;
}) {
  return requestChatCompletion({
    apiKey,
    model,
    messages: [{ role: "user", content: prompt }],
    jsonMode: true,
  });
}

async function requestChatCompletion({
  apiKey,
  model,
  messages,
  jsonMode,
}: {
  apiKey: string;
  model: string;
  messages: ChatPayloadMessage[];
  jsonMode: boolean;
}): Promise<string> {
  const option = resolveAIModel(model);
  const payload = {
    model: option.apiModel,
    stream: false,
    temperature: 1,
    ...(jsonMode && option.jsonResponseFormat ? { response_format: { type: "json_object" } } : {}),
    messages,
  };

  const res = await fetch(`${option.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  debugLog("[AI] full response", { provider: option.provider, model: option.value, response: json });
  return json.choices?.[0]?.message?.content ?? "";
}

function withMessageTimeTag(timestamp: number, text: string) {
  return `<time>${formatMessageTime(timestamp)}</time>\n${text}`;
}

function formatMessageTime(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
