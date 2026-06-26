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
    _db = await Database.load("sqlite:alis.db");
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
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
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
    "INSERT OR REPLACE INTO memories (id, content, created_at) VALUES (?, ?, ?)",
    [fragment.id, fragment.content, fragment.createdAt]
  );
}

export async function getMemories(): Promise<MemoryFragment[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string; content: string; created_at: number }[]>(
    "SELECT id, content, created_at FROM memories ORDER BY created_at DESC"
  );
  return rows.map((r) => ({ id: r.id, content: r.content, createdAt: r.created_at }));
}

export async function clearMessages() {
  const db = await getDb();
  await db.execute("DELETE FROM messages");
}

export async function clearMemories() {
  const db = await getDb();
  await db.execute("DELETE FROM memories");
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
