/**
 * [INPUT]: 依赖 stores/index 的 Message、MemoryFragment、MemoryType；依赖 lib/db 的计数器和记忆读写
 * [OUTPUT]: 对外提供 tickAndDistill — 每 80 条消息触发一次记忆蒸馏
 * [POS]: lib 层记忆生成器，被 InputBar onDone 回调驱动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Message, MemoryFragment, MemoryType } from "@/stores";
import { getMessageCounter, setMessageCounter, saveMemory, clearMemories } from "@/lib/db";
import { useMemoryStore } from "@/stores";

const DISTILL_THRESHOLD = 80;
const CONTEXT_WINDOW = 80;
const MAX_RETRIES = 3;

// --------------------------------------------------------
// 蒸馏 prompt：输出完整精炼后的记忆列表，全量替换旧记忆
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

  return `你是田山的记忆系统。请结合已有记忆和最近对话，输出一份完整、精炼的最新记忆列表。

已有记忆：
${memoryText}

最近对话：
${historyText}

输出规则：
1. 输出的是完整记忆列表，会直接替换旧记忆，不是增量
2. 将已有记忆与新信息合并：重复的合并为一条，过时的删除，新的加入
3. 每条记忆的 type 只能是以下四种之一：
   - trait：用户的性格、习惯、偏好
   - event：发生过的事、提到的经历
   - feeling：情绪倾向、反复出现的情绪模式
   - bond：两人之间的共同记忆、inside joke
4. 宁精勿滥，不值得长期记住的信息直接丢弃
5. 直接输出 JSON 数组，不要有其他文字

示例输出：
[{"type":"trait","content":"喜欢深夜聊天，习惯用反问句"},{"type":"event","content":"提到最近换了新工作，压力很大"}]`;
}

// --------------------------------------------------------
// 单次蒸馏调用，返回解析好的记忆列表，失败返回 null
// --------------------------------------------------------
async function distillOnce(
  recentMessages: Message[],
  existingFragments: MemoryFragment[],
  apiKey: string,
  model: string
): Promise<MemoryFragment[] | null> {
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

    if (!res.ok) return null;
    const json = await res.json();
    raw = json.choices?.[0]?.message?.content ?? "";
  } catch {
    return null;
  }

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const items: { type: string; content: string }[] = JSON.parse(match[0]);
    if (!Array.isArray(items) || !items.length) return null;

    const validTypes = new Set<MemoryType>(["trait", "event", "feeling", "bond", "general"]);
    const refined: MemoryFragment[] = items
      .filter((item) => item.content?.trim())
      .map((item) => ({
        id: crypto.randomUUID(),
        type: validTypes.has(item.type as MemoryType) ? (item.type as MemoryType) : "general",
        content: item.content.trim(),
        createdAt: Date.now(),
      }));

    return refined.length ? refined : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------
// 主函数：计数 +1，满阈值则蒸馏（最多重试 3 次）
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

  await setMessageCounter(0);

  const recentMessages = allMessages.slice(-CONTEXT_WINDOW);
  const existingFragments = useMemoryStore.getState().fragments;

  let refined: MemoryFragment[] | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    refined = await distillOnce(recentMessages, existingFragments, apiKey, model);
    if (refined) break;
  }

  // 三次全部失败则保留旧记忆，不替换
  if (!refined) return;

  await clearMemories();
  for (const f of refined) {
    await saveMemory(f);
  }
  useMemoryStore.getState().setFragments(refined);
}
