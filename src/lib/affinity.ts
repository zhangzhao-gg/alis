/**
 * [INPUT]: 依赖 lib/db 的 getAffinity/setAffinity/getAffinityCounter/setAffinityCounter
 * [OUTPUT]: 对外提供 tickAffinity，每 50 句对话好感度 +1
 * [POS]: lib 层好感度计数器，fire-and-forget，与 tickAndDistill 同级调用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { getAffinity, setAffinity, getAffinityCounter, setAffinityCounter } from "@/lib/db";
import { useMemoryStore } from "@/stores";

const AFFINITY_THRESHOLD = 50;
const AFFINITY_MAX = 100;

export async function tickAffinity() {
  const counter = await getAffinityCounter();
  const next = counter + 1;
  await setAffinityCounter(next);

  if (next % AFFINITY_THRESHOLD !== 0) return;

  const current = await getAffinity();
  if (current >= AFFINITY_MAX) return;

  const updated = Math.min(current + 1, AFFINITY_MAX);
  await setAffinity(updated);
  useMemoryStore.getState().setAffinity(updated);
}
