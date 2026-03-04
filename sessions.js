// SQLite 会话持久化（bun:sqlite，零外部依赖）
// 支持多后端：backend 字段区分 claude / codex
import { Database } from "bun:sqlite";
import { join, isAbsolute } from "path";

const DB_PATH = process.env.SESSIONS_DB
  ? (isAbsolute(process.env.SESSIONS_DB) ? process.env.SESSIONS_DB : join(import.meta.dir, process.env.SESSIONS_DB))
  : join(import.meta.dir, "sessions.db");
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 小时不活跃自动过期

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    chat_id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL,
    display_name TEXT DEFAULT '',
    backend TEXT DEFAULT 'claude'
  )
`);

// 迁移：旧表没有 backend 列时自动加
try {
  db.exec("ALTER TABLE sessions ADD COLUMN backend TEXT DEFAULT 'claude'");
} catch {
  // 列已存在，忽略
}

// 会话历史表（保留所有历史会话，不被 /new 或 upsert 覆盖）
db.exec(`
  CREATE TABLE IF NOT EXISTS session_history (
    session_id TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL,
    display_name TEXT DEFAULT '',
    backend TEXT DEFAULT 'claude'
  )
`);

// 后端偏好表（每个 chat 独立选后端）
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_backend (
    chat_id INTEGER PRIMARY KEY,
    backend TEXT NOT NULL DEFAULT 'claude'
  )
`);

// Prepared statements — sessions
const stmtGet = db.prepare("SELECT session_id, last_active, backend FROM sessions WHERE chat_id = ?");
const stmtUpsert = db.prepare(`
  INSERT INTO sessions (chat_id, session_id, created_at, last_active, display_name, backend)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET
    session_id = excluded.session_id,
    last_active = excluded.last_active,
    display_name = excluded.display_name,
    backend = excluded.backend
`);
const stmtDelete = db.prepare("DELETE FROM sessions WHERE chat_id = ?");
const stmtRecent = db.prepare(`
  SELECT chat_id, session_id, created_at, last_active, display_name, backend FROM (
    SELECT chat_id, session_id, created_at, last_active, display_name, backend FROM sessions
    UNION ALL
    SELECT chat_id, session_id, created_at, last_active, display_name, backend FROM session_history
  ) ORDER BY last_active DESC LIMIT ?
`);
const stmtCleanup = db.prepare("DELETE FROM sessions WHERE last_active < ?");
const stmtCleanupHistory = db.prepare("DELETE FROM session_history WHERE last_active < ?");
const stmtTouch = db.prepare("UPDATE sessions SET last_active = ? WHERE chat_id = ?");

// History statements
const stmtArchive = db.prepare(`
  INSERT OR REPLACE INTO session_history (session_id, chat_id, created_at, last_active, display_name, backend)
  SELECT session_id, chat_id, created_at, last_active, display_name, backend FROM sessions WHERE chat_id = ?
`);
const stmtGetHistory = db.prepare(
  "SELECT session_id, chat_id, created_at, last_active, display_name, backend FROM session_history WHERE session_id = ?"
);
const stmtDeleteFromHistory = db.prepare("DELETE FROM session_history WHERE session_id = ?");

// Prepared statements — chat_backend
const stmtGetBackendPref = db.prepare("SELECT backend FROM chat_backend WHERE chat_id = ?");
const stmtSetBackendPref = db.prepare(`
  INSERT INTO chat_backend (chat_id, backend) VALUES (?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET backend = excluded.backend
`);

// 模型偏好表（每个 chat 独立选模型，跨重启持久化）
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_model (
    chat_id INTEGER PRIMARY KEY,
    model TEXT NOT NULL
  )
`);
const stmtGetModelPref = db.prepare("SELECT model FROM chat_model WHERE chat_id = ?");
const stmtSetModelPref = db.prepare(`
  INSERT INTO chat_model (chat_id, model) VALUES (?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET model = excluded.model
`);
const stmtDeleteModelPref = db.prepare("DELETE FROM chat_model WHERE chat_id = ?");

export function getSession(chatId) {
  const row = stmtGet.get(chatId);
  if (!row) return null;
  if (Date.now() - row.last_active > SESSION_TIMEOUT) {
    stmtDelete.run(chatId);
    return null;
  }
  // Touch last_active
  stmtTouch.run(Date.now(), chatId);
  return { session_id: row.session_id, backend: row.backend || "claude" };
}

export function setSession(chatId, sessionId, displayName = "", backend = "claude") {
  // 归档旧会话（如果有）
  stmtArchive.run(chatId);
  // 从历史中移除（避免恢复后重复出现）
  stmtDeleteFromHistory.run(sessionId);
  const now = Date.now();
  stmtUpsert.run(chatId, sessionId, now, now, displayName, backend);
}

export function deleteSession(chatId) {
  // 归档到历史再删除
  stmtArchive.run(chatId);
  stmtDelete.run(chatId);
}

export function getHistorySession(sessionId) {
  return stmtGetHistory.get(sessionId) || null;
}

export function recentSessions(limit = 8) {
  return stmtRecent.all(limit);
}

export function cleanupExpired() {
  const cutoff = Date.now() - SESSION_TIMEOUT;
  const result = stmtCleanup.run(cutoff);
  // 历史表保留更久（7 天）
  const historyCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  stmtCleanupHistory.run(historyCutoff);
  return result.changes;
}

export function getChatBackend(chatId) {
  const row = stmtGetBackendPref.get(chatId);
  return row?.backend || null;
}

export function setChatBackend(chatId, backend) {
  stmtSetBackendPref.run(chatId, backend);
}

export function getChatModel(chatId) {
  const row = stmtGetModelPref.get(chatId);
  return row?.model || null;
}

export function setChatModel(chatId, model) {
  stmtSetModelPref.run(chatId, model);
}

export function deleteChatModel(chatId) {
  stmtDeleteModelPref.run(chatId);
}

// 每 30 分钟自动清理过期会话
setInterval(cleanupExpired, 30 * 60 * 1000);
