# telegram-cc-sdk

> Telegram → Claude Code bridge via Agent SDK (direct connection, no task-api middleware)

> Telegram 直连 Claude Code 桥（Agent SDK 直连，无 task-api 中间层）

Replaces the task-api relay in [telegram-cc-bridge](https://github.com/AliceLJY/telegram-cc-bridge) with a direct Agent SDK connection for lower latency, real-time progress, and persistent sessions.

> 从 [telegram-cc-bridge](https://github.com/AliceLJY/telegram-cc-bridge) 拆分出来，用 Agent SDK 直连替代 task-api 中转层，延迟更低、实时进度、会话持久化。Codex/Gemini 桥留在原仓库。

## Features

> 功能特性

- **Agent SDK direct** — no task-api middleware, lower latency
- **SQLite sessions** — survive bridge restarts (bun:sqlite, WAL mode)
- **Real-time progress** — see which tools CC is using as it works
- **Verbose levels** — `/verbose 0|1|2` for progress detail control
- **Session resume** — `/sessions` to list and restore previous conversations
- **Terminal interop** — `claude --resume <id>` works with bridge sessions
- **Group context** — shared message context in Telegram groups
- **Quick replies** — inline buttons for yes/no questions
- **File handling** — photos, documents, voice messages

> Agent SDK 直连、SQLite 会话持久化、实时进度显示（工具图标）、进度详细度三级、会话列表恢复、终端互通、群聊上下文、快捷按钮、文件/图片/语音。

## Architecture

> 架构图

```
                     ┌─ telegram-cc-sdk (this repo)
Phone (Telegram) ────┤     Agent SDK → Claude Code (direct)
                     │     SQLite sessions (survive restarts)
                     │
                     └─ telegram-cc-bridge (Codex / Gemini)
                           task-api → Codex CLI / Gemini CLI
```

```
Telegram ←→ grammy Bot ←→ Agent SDK query() ←→ Claude Code
                              ↕
                        SQLite (sessions.db)
```

## Prerequisites

> 前置条件

- [Bun](https://bun.sh) runtime (bun:sqlite used for session persistence)
- Claude Code CLI installed (`claude` command available)
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))

> 需要 Bun 运行时（用 bun:sqlite 做会话持久化）、Claude Code CLI、Telegram Bot Token。

## Setup

> 安装配置

```bash
git clone https://github.com/AliceLJY/telegram-cc-sdk.git
cd telegram-cc-sdk
bun install  # or npm install

cp .env.example .env
# Edit .env with your tokens
# 编辑 .env 填入你的 Bot Token 和配置
```

### Environment Variables

> 环境变量

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `OWNER_TELEGRAM_ID` | Yes | — | Your Telegram user ID (owner only) |
| `HTTPS_PROXY` | No | — | Proxy for Telegram API (blocked regions) |
| `CC_MODEL` | No | `claude-sonnet-4-6` | Claude model to use |
| `CC_CWD` | No | `$HOME` | Working directory for CC |
| `DEFAULT_VERBOSE_LEVEL` | No | `1` | Default progress verbosity (0/1/2) |
| `ENABLE_GROUP_SHARED_CONTEXT` | No | `true` | Enable group chat context |
| `GROUP_CONTEXT_MAX_MESSAGES` | No | `30` | Max context messages in group |
| `GROUP_CONTEXT_MAX_TOKENS` | No | `3000` | Max context tokens in group |

> `TELEGRAM_BOT_TOKEN` 和 `OWNER_TELEGRAM_ID` 必填，其余可选。代理用于 Telegram API 被墙的地区。

## Usage

> 使用方式

```bash
bun bridge.js
```

### macOS LaunchAgent (recommended)

> macOS 推荐用 LaunchAgent 守护进程，开机自启 + 崩溃自动重启。

Create `~/Library/LaunchAgents/com.telegram-cc-sdk.plist`:

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

> 命令列表

| Command | Description |
|---------|-------------|
| `/new` | Reset session, start fresh / 重置会话 |
| `/sessions` | List recent sessions, tap to restore / 列出历史会话 |
| `/status` | Show SDK mode, model, cwd, session / 查看状态 |
| `/verbose 0\|1\|2` | Set progress verbosity / 设置进度详细度 |

### Sending Files

> 发送文件

| Type | Support | Description |
|------|---------|-------------|
| Photos | ✅ | CC reads images (multimodal) / 图片识别 |
| PDF / text / code | ✅ | CC reads file content / 文件处理 |
| Voice | ✅ | CC processes audio / 语音处理 |
| Video | ❌ | Send screenshot instead / 暂不支持 |

### Inline Keyboard Buttons

> 快捷按钮

**Session picker** — tap `/sessions`, get a list of buttons:

> `/sessions` 弹出按钮列表，点一下恢复会话。

```
┌─────────────────────────────────┐
│ 03-03 14:07  帮我看看这个报错...  │
├─────────────────────────────────┤
│ 03-03 10:15  写一篇关于AI的...    │
├─────────────────────────────────┤
│ 🆕 开新会话                      │
└─────────────────────────────────┘
```

**Smart quick replies** — when CC asks yes/no, buttons appear:

> CC 问「要吗？」「继续吗？」时自动弹按钮。

```
CC: 要把这段代码重构成两个函数吗？

        ┌──────┐  ┌──────┐
        │  要  │  │ 不要 │
        └──────┘  └──────┘
```

## Key Improvements over telegram-cc-bridge

> 相比旧版的改进

| Before (task-api) | After (Agent SDK) |
|---|---|
| Session in memory, lost on restart | SQLite persistence, survives restart |
| Static "CC 正在处理..." | Real-time tool progress with icons |
| task-api → Worker → CC (2 hops) | Agent SDK → CC (direct) |
| Long-polling for result | Streaming via async iterator |
| No concurrency control | Per-chat message queuing |

> 会话持久化（SQLite）、实时进度（工具图标）、直连（去掉 task-api 中间层）、流式返回、并发控制。

## Ecosystem

> 生态系统

| Project | Layer | What it does |
|---------|-------|-------------|
| **[telegram-cc-sdk](https://github.com/AliceLJY/telegram-cc-sdk)** | Frontend | *This project.* Telegram → CC via Agent SDK |
| **[telegram-cc-bridge](https://github.com/AliceLJY/telegram-cc-bridge)** | Frontend | Telegram → Codex/Gemini via task-api |
| **[openclaw-worker](https://github.com/AliceLJY/openclaw-worker)** | Backend | Task queue + CC/Codex/Gemini Worker |
| **[openclaw-cc-bridge](https://github.com/AliceLJY/openclaw-cc-bridge)** | Frontend | Discord → CC via OpenClaw Bot |
| **[content-alchemy](https://github.com/AliceLJY/content-alchemy)** | Skill | Research → Analysis → Writing pipeline |
| **[content-publisher](https://github.com/AliceLJY/content-publisher)** | Skill | Image → Layout → WeChat Publishing |

## Author

> 作者

**小试AI** — WeChat Public Account「我的AI小木屋」

Not a developer. Medical background, works in cultural administration, self-taught AI the hard way. Writes about AI hands-on experience, real-world pitfalls, and the human side of technology.

> 医学出身，文化口工作，AI 野路子。公众号记录 AI 实操、踩坑、人文思考。

<img src="./assets/wechat_qr.jpg" width="200" alt="WeChat QR Code">

## License

[MIT](LICENSE)
