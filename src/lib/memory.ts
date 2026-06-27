/**
 * [INPUT]: 依赖 stores/index 的 Message、MemoryFragment、MemoryType；依赖 lib/db 的计数器和记忆读写
 * [OUTPUT]: 对外提供 tickAndDistill — 每 80 条消息触发一次记忆蒸馏
 * [POS]: lib 层记忆生成器，被 InputBar onDone 回调驱动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Message, MemoryFragment, MemoryType } from "@/stores";
import { getMessageCounter, setMessageCounter, saveMemory } from "@/lib/db";
import { useMemoryStore } from "@/stores";

const DISTILL_THRESHOLD = 80;
const CONTEXT_WINDOW = 80;
const MAX_FRAGMENTS = 20;

// --------------------------------------------------------
// 蒸馏 prompt：要求模型输出结构化 JSON
// --------------------------------------------------------
function buildDistillPrompt(
  recentMessages: Message[],
  existingMemories: MemoryFragment[]
): string {
  const historyText = recentMessages
    .map((m) => `${m.sender === "user" ? "用户" : "田山"}: ${m.text}`)
    .join("\n");

  const memoryText = existingMemories.length
    ? existingMemories.map((m) => `[${m.type}] ${m.content}`).join("\n")
    : "暂无";

  return `你是田山的记忆系统。根据以下对话，提炼出值得长期记住的信息。

已有记忆：
${memoryText}

最近对话：
${historyText}

请输出 JSON 数组，每条记忆包含 type 和 content。
type 只能是以下四种之一：
- trait：用户的性格、习惯、偏好
- event：发生过的事、提到的经历
- feeling：情绪倾向、反复出现的情绪模式
- bond：两人之间的共同记忆、inside joke

规则：
1. 只提炼真正值得长期记住的信息，宁少勿多，最多 5 条
2. 与已有记忆重复的不要输出
3. 直接输出 JSON，不要有其他文字

示例输出：
[{"type":"trait","content":"喜欢深夜聊天，习惯用反问句"},{"type":"event","content":"提到最近换了新工作，压力很大"}]`;
}

// --------------------------------------------------------
// 主函数：计数 +1，满阈值则蒸馏
// --------------------------------------------------------
export async function tickAndDistill(
  allMessages: Message[],
  apiKey: string,
  model: string
): Promise<void> {
  const counter = await getMessageCounter();
  const next = counter + 1;

  if (next < DISTILL_THRESHOLD) {
    await setMessageCounter(next);
    return;
  }

  // 归零，开始蒸馏
  await setMessageCounter(0);

  const recentMessages = allMessages.slice(-CONTEXT_WINDOW);
  const existingFragments = useMemoryStore.getState().fragments;

  let raw = "";
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "user", content: buildDistillPrompt(recentMessages, existingFragments) },
        ],
      }),
    });

    if (!res.ok) return;
    const json = await res.json();
    raw = json.choices?.[0]?.message?.content ?? "";
  } catch {
    return;
  }

  // 解析 JSON
  let items: { type: string; content: string }[] = [];
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) items = JSON.parse(match[0]);
  } catch {
    return;
  }

  const validTypes = new Set<MemoryType>(["trait", "event", "feeling", "bond", "general"]);

  const newFragments: MemoryFragment[] = items
    .filter((item) => item.content?.trim())
    .map((item) => ({
      id: crypto.randomUUID(),
      type: validTypes.has(item.type as MemoryType) ? (item.type as MemoryType) : "general",
      content: item.content.trim(),
      createdAt: Date.now(),
    }));

  if (!newFragments.length) return;

  // 写入 store 和 DB，超过 MAX_FRAGMENTS 淘汰最旧的
  const all = [...existingFragments, ...newFragments];
  const trimmed = all.slice(-MAX_FRAGMENTS);

  useMemoryStore.getState().setFragments(trimmed);
  for (const f of newFragments) {
    await saveMemory(f);
  }
}
