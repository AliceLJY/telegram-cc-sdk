# telegram-ai-bridge

Telegram → AI bridge with tri-backend support: Claude Code (Agent SDK) + Codex SDK + Gemini (Code Assist API).

> Telegram 三后端 AI 桥 — Claude Agent SDK + Codex SDK + Gemini Code Assist API，统一适配器，一键切换，终端互通。

Switch between backends from Telegram with `/backend claude|codex|gemini`. Claude and Codex support terminal resume — chat in Telegram, continue in your terminal.

## Features

- **Tri-backend** — Claude Code (Agent SDK) + Codex SDK + Gemini (Code Assist API), switchable per chat
- **Unified adapter interface** — consistent streaming events across backends
- **SQLite sessions** — survive bridge restarts, tracks backend per session (bun:sqlite, WAL mode)
- **Real-time progress** — see which tools the AI is using as it works
- **Terminal interop** — `claude --resume <id>` / `codex --resume <id>` works with bridge sessions
- **Verbose levels** — `/verbose 0|1|2` for progress detail control
- **Session resume** — `/sessions` to list and restore previous conversations (labeled by backend)
- **Group context** — shared message context in Telegram groups
- **Quick replies** — inline buttons for yes/no questions
- **File handling** — photos, documents, voice messages

> 三后端、统一适配器、SQLite 持久化、实时进度、终端互通（核心）、verbose 三级、群聊上下文。

## Architecture

```
                          ┌─ adapters/claude.js ──→ Agent SDK ──→ Claude Code
Phone (Telegram) ──→ bridge.js ──┼─ adapters/codex.js ───→ Codex SDK ──→ Codex CLI
                          └─ adapters/gemini.js ──→ Code Assist API ──→ Gemini (chat only)
                               ↕
                         SQLite (sessions.db)
                         backend per session
```

```
/backend claude  →  🟣 Agent SDK direct  → Claude Code (full tool use)
/backend codex   →  🟢 Codex SDK direct  → Codex CLI (sandbox execution)
/backend gemini  →  🔵 Code Assist API   → Gemini (chat only, no file access)
```

> Terminal resume: TG conversations are real SDK sessions. `claude --resume <id>` or `codex --resume <threadId>` picks up exactly where Telegram left off.

### Gemini Limitations

The Gemini backend uses **Google Code Assist API** (`cloudcode-pa.googleapis.com`), NOT the Gemini CLI SDK. This means:

- **Chat only** — cannot read/write local files, cannot execute commands
- **No terminal resume** — sessions are in-memory, not persisted to Gemini CLI
- **Requires Google Cloud / Gemini Pro subscription** and OAuth credentials

If you need Gemini with **full CLI capabilities** (file access, command execution, tool use), use **[telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)** instead — it routes through task-api to Gemini CLI.

> Gemini 后端走的是 Code Assist API（纯聊天接口），不能操作本地文件。如果需要 Gemini 完整 CLI 能力，请用 [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)（通过 task-api 调用 Gemini CLI）。

## Prerequisites

- [Bun](https://bun.sh) runtime (bun:sqlite used for session persistence)
- Claude Code CLI installed (`claude` command available)
- Codex CLI installed (`codex` command available) — optional, only needed for Codex backend
- Telegram Bot token (from [@BotFather](https://t.me/BotFather))

## Setup

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install

cp .env.example .env
# Edit .env with your bot token and config
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather |
| `OWNER_TELEGRAM_ID` | Yes | — | Your Telegram user ID (owner only) |
| `HTTPS_PROXY` | No | — | Proxy for Telegram API (for blocked regions) |
| `DEFAULT_BACKEND` | No | `claude` | Default backend: `claude`, `codex`, or `gemini` |
| `CC_MODEL` | No | `claude-sonnet-4-6` | Claude model to use |
| `CC_CWD` | No | `$HOME` | Working directory for both backends |
| `CODEX_MODEL` | No | *(codex default)* | Codex model override |
| `DEFAULT_VERBOSE_LEVEL` | No | `1` | Default progress verbosity (0/1/2) |
| `ENABLE_GROUP_SHARED_CONTEXT` | No | `true` | Enable group chat shared context |
| `SESSION_TIMEOUT_MS` | No | `900000` | Session timeout in ms (default 15 min) |
| `CC_PERMISSION_MODE` | No | `default` | Claude permission mode: `default` or `bypassPermissions` |
| `GEMINI_OAUTH_CLIENT_ID` | No | — | Gemini OAuth client ID (for Gemini backend) |
| `GEMINI_OAUTH_CLIENT_SECRET` | No | — | Gemini OAuth client secret (for Gemini backend) |
| `GEMINI_MODEL` | No | `gemini-2.5-pro` | Gemini model to use |

## Usage

```bash
bun bridge.js
```

### Docker

```bash
docker build -t telegram-ai-bridge .
docker run -d --name tg-ai-bridge \
  --env-file .env \
  -v ~/.claude:/root/.claude \
  -v ~/.codex:/root/.codex \
  -v ~/.gemini:/root/.gemini \
  telegram-ai-bridge
```

> Mount the credential directories for each backend you use. Only Claude needs `~/.claude`, only Gemini needs `~/.gemini`, etc.

### macOS LaunchAgent (recommended)

For auto-start on login with crash recovery, create `~/Library/LaunchAgents/com.telegram-ai-bridge.plist`:

> macOS 推荐 LaunchAgent 守护进程，开机自启 + 崩溃重启。

```xml
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.telegram-ai-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/bun</string>
        <string>/path/to/telegram-ai-bridge/bridge.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/telegram-ai-bridge</string>
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
| `/backend claude\|codex\|gemini` | Switch backend for current chat |
| `/new` | Reset session, start fresh |
| `/sessions` | List recent sessions (labeled by backend), tap to restore |
| `/status` | Show current backend, model, cwd, session |
| `/verbose 0\|1\|2` | Set progress verbosity level |

### Terminal Resume

The core feature: chat in Telegram, continue in your terminal.

```bash
# After chatting via Telegram with Claude backend:
claude --resume <session-id>

# After chatting via Telegram with Codex backend:
codex --resume <thread-id>
```

Session IDs are shown in `/status` and `/sessions`. Both SDKs store sessions locally (`~/.claude/` and `~/.codex/sessions/`), so terminal resume is seamless.

### Sending Files

| Type | Support | Handling |
|------|---------|----------|
| Photos | ✅ | AI reads images (multimodal) |
| PDF / text / code | ✅ | AI reads file content |
| Voice | ✅ | AI processes audio |
| Video | ❌ | Send screenshot instead |

### Inline Keyboard Buttons

**Session picker** — `/sessions` shows backend-labeled buttons:

```
┌──────────────────────────────────────┐
│ 🟣 03-03 14:07  Fix the auth bug     │
├──────────────────────────────────────┤
│ 🟢 03-03 10:15  Optimize build       │
├──────────────────────────────────────┤
│ 🆕 New session                        │
└──────────────────────────────────────┘
```

**Smart quick replies** — yes/no buttons appear automatically for both backends.

## Adapter Interface

Each backend implements the same interface:

```javascript
// adapters/interface.js
{
  name: "claude" | "codex" | "gemini",
  label: "CC" | "Codex" | "Gemini",
  icon: "🟣" | "🟢" | "🔵",

  async *streamQuery(prompt, sessionId, abortSignal) {
    yield { type: "session_init", sessionId }
    yield { type: "progress", toolName, detail }
    yield { type: "text", text }
    yield { type: "result", success, text, cost?, duration? }
  },

  statusInfo() { return { model, cwd, mode } }
}
```

Adding a new backend = writing one adapter file. The bridge doesn't need to change.

## Ecosystem

Part of a personal AI infrastructure. Each project handles one layer.

> 个人 AI 基础设施的一部分。每个项目负责一层。

| Project | Layer | What it does |
|---------|-------|-------------|
| **[telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge)** | Frontend | *This project.* Telegram → CC / Codex / Gemini via SDK (Gemini chat-only) |
| **[telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)** | Frontend | Telegram → CC / Codex / Gemini via task-api (all backends get full CLI) |
| **[openclaw-worker](https://github.com/AliceLJY/openclaw-worker)** | Backend | Task queue + CC/Codex/Gemini Worker |
| **[openclaw-content-alchemy](https://github.com/AliceLJY/openclaw-content-alchemy)** | Skill | Bot-native content pipeline (OpenClaw plugin) |
| **[openclaw-cli-pipeline](https://github.com/AliceLJY/openclaw-cli-pipeline)** | CLI | Multi-turn CC orchestration CLI |
| **[openclaw-cli-bridge](https://github.com/AliceLJY/openclaw-cli-bridge)** | Frontend | Discord → CC/Codex/Gemini via OpenClaw Bot plugin |
| **[content-alchemy](https://github.com/AliceLJY/content-alchemy)** | Skill | 5-stage content pipeline: Research → Writing |
| **[content-publisher](https://github.com/AliceLJY/content-publisher)** | Skill | Image → Layout → WeChat Publishing |
| **[digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill)** | Skill | 6-stage digital clone from corpus data |
| **[local-memory](https://github.com/AliceLJY/local-memory)** | Utility | Local AI conversation search (LanceDB + Jina) |
| **[cc-shell](https://github.com/AliceLJY/cc-shell)** | UI | Lightweight Claude Code chat UI |

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
