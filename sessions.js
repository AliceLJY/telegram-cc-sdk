// SQLite 会话持久化（bun:sqlite，零外部依赖）
import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "sessions.db");
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 小时不活跃自动过期

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    chat_id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL,
    display_name TEXT DEFAULT ''
  )
`);

// Prepared statements
const stmtGet = db.prepare("SELECT session_id, last_active FROM sessions WHERE chat_id = ?");
const stmtUpsert = db.prepare(`
  INSERT INTO sessions (chat_id, session_id, created_at, last_active, display_name)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET
    session_id = excluded.session_id,
    last_active = excluded.last_active,
    display_name = excluded.display_name
`);
const stmtDelete = db.prepare("DELETE FROM sessions WHERE chat_id = ?");
const stmtRecent = db.prepare(
  "SELECT chat_id, session_id, created_at, last_active, display_name FROM sessions ORDER BY last_active DESC LIMIT ?"
);
const stmtCleanup = db.prepare("DELETE FROM sessions WHERE last_active < ?");
const stmtTouch = db.prepare("UPDATE sessions SET last_active = ? WHERE chat_id = ?");

export function getSession(chatId) {
  const row = stmtGet.get(chatId);
  if (!row) return null;
  if (Date.now() - row.last_active > SESSION_TIMEOUT) {
    stmtDelete.run(chatId);
    return null;
  }
  // Touch last_active
  stmtTouch.run(Date.now(), chatId);
  return row.session_id;
}

export function setSession(chatId, sessionId, displayName = "") {
  const now = Date.now();
  stmtUpsert.run(chatId, sessionId, now, now, displayName);
}

export function deleteSession(chatId) {
  stmtDelete.run(chatId);
}

export function recentSessions(limit = 8) {
  return stmtRecent.all(limit);
}

export function cleanupExpired() {
  const cutoff = Date.now() - SESSION_TIMEOUT;
  const result = stmtCleanup.run(cutoff);
  return result.changes;
}

// 每 30 分钟自动清理过期会话
setInterval(cleanupExpired, 30 * 60 * 1000);
