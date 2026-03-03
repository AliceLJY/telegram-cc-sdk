# telegram-cc-sdk

> Telegram → Claude Code bridge via Agent SDK (direct connection, no task-api middleware)

Replaces the task-api relay in [telegram-cc-bridge](https://github.com/AliceLJY/telegram-cc-bridge) with a direct Agent SDK connection for lower latency, real-time progress, and persistent sessions.

## Features

- **Agent SDK direct** — no task-api middleware, lower latency
- **SQLite sessions** — survive bridge restarts (bun:sqlite, WAL mode)
- **Real-time progress** — see which tools CC is using as it works
- **Verbose levels** — `/verbose 0|1|2` for progress detail control
- **Session resume** — `/sessions` to list and restore previous conversations
- **Terminal interop** — `claude --resume <id>` works with bridge sessions
- **Group context** — shared message context in Telegram groups
- **Quick replies** — inline buttons for yes/no questions
- **File handling** — photos, documents, voice messages

## Setup

```bash
cp .env.example .env
# Edit .env with your tokens
bun install  # or npm install
bun bridge.js
```

## Commands

| Command | Description |
|---------|-------------|
| `/new` | Reset session, start fresh |
| `/sessions` | List recent sessions, tap to restore |
| `/status` | Show SDK mode, model, cwd, session info |
| `/verbose 0\|1\|2` | Set progress verbosity |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `OWNER_TELEGRAM_ID` | Yes | — | Your Telegram user ID |
| `HTTPS_PROXY` | No | — | Proxy for Telegram API |
| `CC_MODEL` | No | `claude-sonnet-4-6` | Claude model to use |
| `CC_CWD` | No | `$HOME` | Working directory for CC |
| `DEFAULT_VERBOSE_LEVEL` | No | `1` | Default progress verbosity |

## Architecture

```
Telegram ←→ grammy Bot ←→ Agent SDK query() ←→ Claude Code
                              ↕
                        SQLite (sessions.db)
```
