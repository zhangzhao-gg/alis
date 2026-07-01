/**
 * [INPUT]: 依赖 @tauri-apps/plugin-sql 的 Database
 * [OUTPUT]: 对外提供 db 单例、initDb、消息/记忆/设置的 SQLite 读写函数
 * [POS]: lib 层的数据持久化，封装 SQLite 操作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import Database from "@tauri-apps/plugin-sql";
import type { Message, MemoryFragment, Settings } from "@/stores";

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:yamada.db");
    await initDb(_db);
  }
  return _db;
}

async function initDb(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  // 兼容旧库：补加 type 列（已存在时静默忽略）
  await db.execute(`ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'general'`).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

export async function saveMessage(msg: Message) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO messages (id, sender, text, timestamp) VALUES (?, ?, ?, ?)",
    [msg.id, msg.sender, msg.text, msg.timestamp]
  );
}

export async function getMessages(): Promise<Message[]> {
  const db = await getDb();
  return db.select<Message[]>(
    "SELECT id, sender, text, timestamp FROM messages ORDER BY timestamp ASC"
  );
}

export async function saveMemory(fragment: MemoryFragment) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO memories (id, type, content, created_at) VALUES (?, ?, ?, ?)",
    [fragment.id, fragment.type, fragment.content, fragment.createdAt]
  );
}

export async function getMemories(): Promise<MemoryFragment[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; type: string; content: string; created_at: number }[]>(
    "SELECT id, type, content, created_at FROM memories ORDER BY created_at DESC"
  );
  return rows.map((r) => ({ id: r.id, type: r.type as MemoryFragment["type"], content: r.content, createdAt: r.created_at }));
}

export async function getMessageCounter(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    ["message_counter"]
  );
  return rows[0] ? parseInt(rows[0].value, 10) : 0;
}

export async function setMessageCounter(count: number) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["message_counter", String(count)]
  );
}

export async function getContextWindowSize(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    ["context_window_size"]
  );
  const value = rows[0] ? parseInt(rows[0].value, 10) : 10;
  return Number.isFinite(value) && value > 0 ? value : 10;
}

export async function setContextWindowSize(size: number) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["context_window_size", String(Math.max(10, Math.floor(size)))]
  );
}

export async function getCoreRecentMemory(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    ["core_recent_memory"]
  );
  return rows[0]?.value ?? "";
}

export async function setCoreRecentMemory(content: string) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["core_recent_memory", content]
  );
}

export async function getAffinity(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    ["affinity"]
  );
  return rows[0] ? parseInt(rows[0].value, 10) : 30;
}

export async function setAffinity(value: number) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["affinity", String(value)]
  );
}

export async function getAffinityCounter(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    ["affinity_counter"]
  );
  return rows[0] ? parseInt(rows[0].value, 10) : 0;
}

export async function setAffinityCounter(count: number) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["affinity_counter", String(count)]
  );
}

export async function clearMessages() {
  const db = await getDb();
  await db.execute("DELETE FROM messages");
  await db.execute("DELETE FROM settings WHERE key IN ('message_counter', 'context_window_size')");
}

export async function clearMemories() {
  const db = await getDb();
  await db.execute("DELETE FROM memories");
  await db.execute("DELETE FROM settings WHERE key = ?", ["core_recent_memory"]);
}

export async function saveSettings(settings: Settings) {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["app", JSON.stringify(settings)]
  );
}

export async function getSettings(): Promise<Partial<Settings> | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    ["app"]
  );

  if (!rows[0]) return null;
  return JSON.parse(rows[0].value) as Partial<Settings>;
}
