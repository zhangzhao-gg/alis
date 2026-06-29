/**
 * [INPUT]: 依赖 stores/index 的 Message 类型
 * [OUTPUT]: 对外提供 streamChat 函数
 * [POS]: lib 层的 AI 接入，封装 DeepSeek Responses API streaming
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Message } from "@/stores";

interface StreamChatOptions {
  messages: Message[];
  apiKey: string;
  model: string;
  systemPrompts: string[];
  onChunk: (chunk: string) => void;
  onDone: () => void | Promise<void>;
  onError: (err: Error) => void;
}

export async function streamChat({
  messages,
  apiKey,
  model,
  systemPrompts,
  onChunk,
  onDone,
  onError,
}: StreamChatOptions) {
  const payload = {
    model,
    stream: true,
    response_format: { type: "json_object" },
    messages: [
      ...systemPrompts
        .map((content) => content.trim())
        .filter(Boolean)
        .map((content) => ({ role: "system", content })),
      ...messages.map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.text,
      })),
    ],
  };

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
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

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          await onDone();
          return;
        }
        try {
          const json = JSON.parse(data);
          const chunk = json.choices?.[0]?.delta?.content;
          if (chunk) onChunk(chunk);
        } catch {
          // 忽略非 JSON 行
        }
      }
    }

    await onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
