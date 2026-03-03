# telegram-cc-sdk

Telegram → Claude Code bridge via Agent SDK — direct connection, no task-api middleware.

> Telegram 直连 Claude Code 桥 — Agent SDK 直连，去掉 task-api 中间层，延迟更低、实时进度、会话持久化。

Replaces the task-api relay in [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge) with a direct [Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) connection. Codex and Gemini bridges remain in the original repo.

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

> 直连、持久化会话、实时进度（工具图标）、verbose 三级、会话恢复、终端互通、群聊上下文、快捷按钮、文件支持。

## Architecture

```
                     ┌─ telegram-cc-sdk (this repo)
Phone (Telegram) ────┤     Agent SDK → Claude Code (direct)
                     │     SQLite sessions (survive restarts)
                     │
                     └─ telegram-cli-bridge (Codex / Gemini)
                           task-api → Codex CLI / Gemini CLI
```

```
Telegram ←→ grammy Bot ←→ Agent SDK query() ←→ Claude Code
                              ↕
                        SQLite (sessions.db)
```

## Prerequisites

- [Bun](https://bun.sh) runtime (bun:sqlite used for session persistence)
- Claude Code CLI installed (`claude` command available)
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))

## Setup

```bash
git clone https://github.com/AliceLJY/telegram-cc-sdk.git
cd telegram-cc-sdk
bun install  # or npm install

cp .env.example .env
# Edit .env with your bot token and config
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `OWNER_TELEGRAM_ID` | Yes | — | Your Telegram user ID (owner only) |
| `HTTPS_PROXY` | No | — | Proxy for Telegram API (for blocked regions) |
| `CC_MODEL` | No | `claude-sonnet-4-6` | Claude model to use |
| `CC_CWD` | No | `$HOME` | Working directory for CC |
| `DEFAULT_VERBOSE_LEVEL` | No | `1` | Default progress verbosity (0/1/2) |
| `ENABLE_GROUP_SHARED_CONTEXT` | No | `true` | Enable group chat shared context |
| `GROUP_CONTEXT_MAX_MESSAGES` | No | `30` | Max context messages in group |
| `GROUP_CONTEXT_MAX_TOKENS` | No | `3000` | Max context token budget in group |

## Usage

```bash
bun bridge.js
```

### macOS LaunchAgent (recommended)

For auto-start on login with crash recovery, create `~/Library/LaunchAgents/com.telegram-cc-sdk.plist`:

> macOS 推荐 LaunchAgent 守护进程，开机自启 + 崩溃重启。

```xml
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.telegram-cc-sdk</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/bun</string>
        <string>/path/to/telegram-cc-sdk/bridge.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/telegram-cc-sdk</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

### Commands

| Command | Description |
|---------|-------------|
| `/new` | Reset session, start fresh |
| `/sessions` | List recent sessions, tap to restore |
| `/status` | Show SDK mode, model, cwd, current session |
| `/verbose 0\|1\|2` | Set progress verbosity level |

### Sending Files

Use the Telegram paperclip button to send files with an optional caption:

| Type | Support | Handling |
|------|---------|----------|
| Photos | ✅ | CC reads images (multimodal) |
| PDF / text / code | ✅ | CC reads file content |
| Voice | ✅ | CC processes audio |
| Video | ❌ | Send screenshot instead |

### Inline Keyboard Buttons

**Session picker** — tap `/sessions` to get a button list. Tap any session to restore it:

```
┌─────────────────────────────────┐
│ 03-03 14:07  Fix the auth bug    │
├─────────────────────────────────┤
│ 03-03 10:15  Write API docs      │
├─────────────────────────────────┤
│ 🆕 New session                   │
└─────────────────────────────────┘
```

**Smart quick replies** — when CC asks a yes/no question, buttons appear automatically:

```
CC: Should I refactor this into two functions?

        ┌──────┐  ┌──────┐
        │  Yes │  │  No  │
        └──────┘  └──────┘
```

Detected patterns: 要吗 / 好吗 / 是吗 / 对吗 / 可以吗 / 继续吗 / 确认吗 + numbered options (1. 2. 3.)

## Key Improvements over task-api Bridge

| Before (task-api) | After (Agent SDK) |
|---|---|
| Sessions in memory, lost on restart | SQLite persistence, survives restarts |
| Static "Processing..." message | Real-time tool progress with icons |
| Telegram → task-api → Worker → CC (2 hops) | Telegram → Agent SDK → CC (direct) |
| Long-polling for result | Streaming via async iterator |
| No concurrency control | Per-chat message queuing |

## Ecosystem

This bridge is part of a personal AI infrastructure. Each project handles one layer — from task execution to content publishing.

> 个人 AI 基础设施的一部分。每个项目负责一层，组合起来是完整的远程 AI 工作流。

| Project | Layer | What it does |
|---------|-------|-------------|
| **[telegram-cc-sdk](https://github.com/AliceLJY/telegram-cc-sdk)** | Frontend | *This project.* Telegram → CC via Agent SDK |
| **[telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)** | Frontend | Telegram → Codex / Gemini via task-api |
| **[openclaw-worker](https://github.com/AliceLJY/openclaw-worker)** | Backend | Task queue + CC/Codex/Gemini Worker |
| **[openclaw-cc-bridge](https://github.com/AliceLJY/openclaw-cc-bridge)** | Frontend | Discord → CC via OpenClaw Bot plugin |
| **[content-alchemy](https://github.com/AliceLJY/content-alchemy)** | Skill | 5-stage content pipeline: Research → Writing |
| **[content-publisher](https://github.com/AliceLJY/content-publisher)** | Skill | Image → Layout → WeChat Publishing |
| **[digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill)** | Skill | 6-stage digital clone from corpus data |

> All projects are MIT licensed and built by one person with zero programming background — proof that AI tools can genuinely empower non-developers.
>
> 所有项目 MIT 开源，一个零编程基础的人独立搭建。

## Author

**小试AI** — WeChat Public Account「我的AI小木屋」

Not a developer. Medical background, works in cultural administration, self-taught AI the hard way. Writes about AI hands-on experience, real-world pitfalls, and the human side of technology.

> 医学出身，文化口工作，AI 野路子。公众号记录 AI 实操、踩坑、人文思考。

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

## License

[MIT](LICENSE)
