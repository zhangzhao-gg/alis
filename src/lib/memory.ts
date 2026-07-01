/**
 * [INPUT]: 依赖 stores/index 的 Message、MemoryFragment、MemoryType；依赖 lib/db 的计数器和记忆读写
 * [OUTPUT]: 对外提供 tickAndDistill — 每 100 条新消息触发一次记忆蒸馏，并维护动态上下文窗口
 * [POS]: lib 层记忆生成器，被 InputBar onDone 回调驱动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Message, MemoryFragment, MemoryType } from "@/stores";
import {
  clearMemories,
  getContextWindowSize,
  getCoreRecentMemory,
  getMessageCounter,
  saveMemory,
  setContextWindowSize,
  setCoreRecentMemory,
  setMessageCounter,
} from "@/lib/db";
import { useMemoryStore } from "@/stores";

const DISTILL_THRESHOLD = 100;
const DISTILL_CONTEXT_WINDOW = 100;
const CONTEXT_WINDOW_BASE = 10;
const MAX_RETRIES = 3;

interface DistillResult {
  coreRecentMemory: string;
  fragments: MemoryFragment[];
}

// --------------------------------------------------------
// 蒸馏 prompt：输出完整精炼后的记忆列表，全量替换旧记忆
// --------------------------------------------------------
function buildDistillPrompt(
  recentMessages: Message[],
  existingMemories: MemoryFragment[],
  existingCoreRecentMemory: string
): string {
  const historyText = recentMessages
    .map((m) => `<time>${formatMessageTime(m.timestamp)}</time> ${m.sender === "user" ? "用户" : "田山"}: ${m.text}`)
    .join("\n");

  const memoryText = existingMemories.length
    ? existingMemories.map((m) => `[${m.type}] ${m.content}`).join("\n")
    : "暂无";

  return `你是田山的记忆系统。请结合已有记忆、已有核心最近记忆和最近对话，输出一份完整、精炼的最新记忆状态。

已有记忆：
${memoryText}

已有核心最近记忆：
${existingCoreRecentMemory || "暂无"}

最近对话：
${historyText}

输出规则：
1. 直接输出一个 JSON 对象，不要有其他文字
2. core_recent_memory 是对最近 100 条对话的核心摘要，用来在后续只携带少量原文时保留近期上下文
3. memories 是完整结构化记忆列表，会直接替换旧记忆，不是增量
4. 将已有记忆与新信息合并：重复的合并为一条，过时的删除，新的加入
5. memories 每条记忆的 type 只能是以下四种之一：
   - trait：用户的性格、习惯、偏好
   - event：发生过的事、提到的经历
   - feeling：情绪倾向、反复出现的情绪模式
   - bond：两人之间的共同记忆、inside joke
6. 宁精勿滥，不值得长期记住的信息直接丢弃

示例输出：
{"core_recent_memory":"最近用户连续聊到新工作压力，以及想在深夜找一个不用解释太多的聊天空间。田山用后门晚风和烟圈的意象安抚过他。","memories":[{"type":"trait","content":"喜欢深夜聊天，习惯用反问句"},{"type":"event","content":"提到最近换了新工作，压力很大"}]}`;
}

// --------------------------------------------------------
// 单次蒸馏调用，返回解析好的记忆列表，失败返回 null
// --------------------------------------------------------
async function distillOnce(
  recentMessages: Message[],
  existingFragments: MemoryFragment[],
  existingCoreRecentMemory: string,
  apiKey: string,
  model: string
): Promise<DistillResult | null> {
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
          { role: "user", content: buildDistillPrompt(recentMessages, existingFragments, existingCoreRecentMemory) },
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
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as {
      core_recent_memory?: string;
      memories?: { type: string; content: string }[];
    };
    const items = parsed.memories;
    if (!Array.isArray(items) || !items.length) return null;

    const validTypes = new Set<MemoryType>(["trait", "event", "feeling", "bond", "general"]);
    const fragments: MemoryFragment[] = items
      .filter((item) => item.content?.trim())
      .map((item) => ({
        id: crypto.randomUUID(),
        type: validTypes.has(item.type as MemoryType) ? (item.type as MemoryType) : "general",
        content: item.content.trim(),
        createdAt: Date.now(),
      }));

    return fragments.length
      ? {
          coreRecentMemory: parsed.core_recent_memory?.trim() ?? "",
          fragments,
        }
      : null;
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
  const next = counter + 2;

  if (next < DISTILL_THRESHOLD) {
    await setMessageCounter(next);
    await incrementContextWindowSize();
    return;
  }

  const recentMessages = allMessages.slice(-DISTILL_CONTEXT_WINDOW);
  const existingFragments = useMemoryStore.getState().fragments;
  const existingCoreRecentMemory = await getCoreRecentMemory();

  let refined: DistillResult | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    refined = await distillOnce(recentMessages, existingFragments, existingCoreRecentMemory, apiKey, model);
    if (refined) break;
  }

  // 三次全部失败则保留旧记忆，不替换
  if (!refined) {
    await setMessageCounter(next);
    await incrementContextWindowSize();
    return;
  }

  await setMessageCounter(0);
  await clearMemories();
  await setCoreRecentMemory(refined.coreRecentMemory);
  for (const f of refined.fragments) {
    await saveMemory(f);
  }
  await setContextWindowSize(CONTEXT_WINDOW_BASE);
  useMemoryStore.getState().setFragments(refined.fragments);
}

async function incrementContextWindowSize() {
  const current = await getContextWindowSize();
  await setContextWindowSize(current + 1);
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
