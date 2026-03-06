# telegram-ai-bridge

Three independent Telegram bots for three AI backends: Claude Code (Agent SDK), Codex (SDK), and Gemini (Code Assist API). Same codebase, separate instances, zero interference.

> 三个独立 Telegram Bot，三个 AI 后端 — Claude Agent SDK / Codex SDK / Gemini Code Assist API。同一套代码，各自运行，互不干扰。

Each bot runs its own `bridge.js` process with a dedicated `.env` file, bot token, and SQLite database. One crashes, the others keep working.

## Recommended Setup

Use this bridge as the primary path for **Claude Code** and **Codex**.
For **Gemini**, the recommended production setup is **[telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)**, because Gemini's Code Assist API here is chat-only and does not expose full CLI capabilities.

> 推荐用法：**Claude Code / Codex** 优先用本仓库；**Gemini** 优先用 [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)，因为这里的 Gemini 只是 Code Assist 对话接口，不是完整 CLI。

## Architecture

```
Telegram Bot 1 (.env)        → bridge.js → Claude adapter  → Agent SDK    → Claude Code
Telegram Bot 2 (.env.codex)  → bridge.js → Codex adapter   → Codex SDK    → Codex CLI
Telegram Bot 3 (.env.gemini) → bridge.js → Gemini adapter  → Code Assist  → Gemini
                                   ↕
                              SQLite (per-instance DB)
```

Each instance is a separate process managed by its own macOS LaunchAgent:

| Instance | LaunchAgent | Env File | Sessions DB |
|----------|-------------|----------|-------------|
| Claude | `com.telegram-ai-bridge` | `.env` | `sessions.db` |
| Codex | `com.telegram-ai-bridge-codex` | `.env.codex` | `sessions-codex.db` |
| Gemini | `com.telegram-gemini-bridge` | `.env.gemini` | `sessions-gemini.db` |

## Features

- **Three independent bots** — each backend has its own Telegram bot, no switching needed
- **Unified adapter interface** — same `bridge.js`, different config, consistent behavior
- **SQLite sessions** — survive restarts, per-instance isolation (bun:sqlite, WAL mode)
- **Terminal resume** — `claude --resume <id>` / `codex resume <id>` picks up where Telegram left off
- **Real-time progress** — see which tools the AI is using as it works
- **Verbose levels** — `/verbose 0|1|2` for progress detail control
- **Session management** — `/sessions` to list, `/resume <id>` to bind an existing conversation
- **Session metadata** — `/sessions` and `/status` show project/cwd and source hints when available
- **Project-first session list** — `/sessions` keeps current session first and prioritizes sessions from the current project
- **Group context** — shared message context in Telegram groups
- **Quick replies** — inline buttons for yes/no questions
- **File handling** — photos, documents, voice messages

> 三独立 bot、统一适配器、SQLite 隔离、终端互通（核心）、verbose 三级、群聊上下文。

### Gemini Limitations

The Gemini backend uses **Google Code Assist API** (`cloudcode-pa.googleapis.com`), NOT the Gemini CLI SDK:

- **Chat only** — cannot read/write local files, cannot execute commands
- **No terminal resume** — sessions are API-based, not persisted to Gemini CLI

If you need Gemini with **full CLI capabilities** (file access, command execution, tool use), use **[telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)** instead — it routes through task-api to Gemini CLI.

> Gemini 后端走的是 Code Assist API（纯聊天），不能操作本地文件。需要 Gemini 完整 CLI 能力请用 [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)。

## Prerequisites

- [Bun](https://bun.sh) runtime (bun:sqlite used for session persistence)
- Claude Code CLI installed (`claude` command available)
- Codex CLI installed (`codex` command available) — only needed for Codex instance
- One Telegram bot token per backend (from [@BotFather](https://t.me/BotFather))

## Setup

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
```

### Configure each instance

Create one `.env` file per backend. Each needs its **own bot token**:

```bash
cp .env.example .env          # Claude instance
cp .env.example .env.codex    # Codex instance
cp .env.example .env.gemini   # Gemini instance
```

**Claude** (`.env`):
```env
TELEGRAM_BOT_TOKEN=<claude-bot-token>
OWNER_TELEGRAM_ID=<your-id>
DEFAULT_BACKEND=claude
CC_MODEL=claude-sonnet-4-6
CC_CWD=/Users/you
CC_PERMISSION_MODE=default
```

**Codex** (`.env.codex`):
```env
TELEGRAM_BOT_TOKEN=<codex-bot-token>
OWNER_TELEGRAM_ID=<your-id>
DEFAULT_BACKEND=codex
CODEX_MODEL=
CC_CWD=/Users/you
SESSIONS_DB=sessions-codex.db
```

**Gemini** (`.env.gemini`):
```env
TELEGRAM_BOT_TOKEN=<gemini-bot-token>
OWNER_TELEGRAM_ID=<your-id>
DEFAULT_BACKEND=gemini
GEMINI_MODEL=gemini-2.5-pro
CC_CWD=/Users/you
SESSIONS_DB=sessions-gemini.db
GEMINI_OAUTH_CLIENT_ID=<your-client-id>
GEMINI_OAUTH_CLIENT_SECRET=<your-client-secret>
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from BotFather (unique per instance) |
| `OWNER_TELEGRAM_ID` | Yes | — | Your Telegram user ID (owner only) |
| `HTTPS_PROXY` | No | — | Proxy for Telegram API (for blocked regions) |
| `DEFAULT_BACKEND` | No | `claude` | Which backend this instance uses: `claude`, `codex`, or `gemini` |
| `SESSIONS_DB` | No | `sessions.db` | SQLite DB filename (use different names per instance) |
| `CC_MODEL` | No | `claude-sonnet-4-6` | Claude model to use |
| `CC_CWD` | No | `$HOME` | Working directory for backends |
| `CODEX_MODEL` | No | *(codex default)* | Codex model override |
| `CC_PERMISSION_MODE` | No | `default` | Claude permission mode: `default` or `bypassPermissions` |
| `DEFAULT_VERBOSE_LEVEL` | No | `1` | Default progress verbosity (0/1/2) |
| `ENABLE_GROUP_SHARED_CONTEXT` | No | `true` | Enable group chat shared context |
| `SESSION_TIMEOUT_MS` | No | `900000` | Session timeout in ms (default 15 min) |
| `GEMINI_OAUTH_CLIENT_ID` | No | — | Gemini OAuth client ID |
| `GEMINI_OAUTH_CLIENT_SECRET` | No | — | Gemini OAuth client secret |
| `GEMINI_MODEL` | No | `gemini-2.5-pro` | Gemini model to use |

## Running

### Direct

```bash
# Claude instance (reads .env by default)
bun bridge.js

# Codex instance
./start-codex.sh    # sources .env.codex, then runs bridge.js

# Gemini instance
./start-gemini.sh   # sources .env.gemini, then runs bridge.js
```

### macOS LaunchAgent (recommended)

Each instance gets its own LaunchAgent for auto-start + crash recovery:

> macOS 推荐 LaunchAgent 守护，开机自启 + 崩溃重启。每个实例一个 plist。

**Claude** — `~/Library/LaunchAgents/com.telegram-ai-bridge.plist`:
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

**Codex** — `~/Library/LaunchAgents/com.telegram-ai-bridge-codex.plist`:
```xml
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.telegram-ai-bridge-codex</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/start-codex.sh</string>
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

Same pattern for Gemini with `start-gemini.sh`.

### Docker

```bash
docker build -t telegram-ai-bridge .
docker run -d --name tg-claude \
  --env-file .env \
  -v ~/.claude:/root/.claude \
  telegram-ai-bridge
```

> Mount the credential directory for the specific backend. Claude needs `~/.claude`, Codex needs `~/.codex`, Gemini needs `~/.gemini`.

## Commands

Available in each bot's chat:

| Command | Description |
|---------|-------------|
| `/new` | Reset session, start fresh |
| `/sessions` | List recent sessions, tap to restore |
| `/resume <session-id>` | Manually bind Telegram to an existing Claude/Codex session |
| `/status` | Show current backend, model, cwd, session |
| `/verbose 0\|1\|2` | Set progress verbosity level |

## Terminal Resume

The core feature: chat in Telegram, continue in your terminal.

```bash
# After chatting with Claude bot:
claude --resume <session-id>

# After chatting with Codex bot:
codex resume <thread-id>
```

Session IDs are shown in `/status` and `/sessions`. If you started the session in terminal first, bind Telegram manually with `/resume <session-id>`. Both SDKs store sessions locally (`~/.claude/` and `~/.codex/sessions/`), so terminal/TG handoff is explicit and predictable.

For Codex sessions, the bridge also surfaces lightweight source hints from local session metadata:

- `CLI` — started from the interactive Codex CLI
- `SDK` — started through the SDK bridge path
- `Exec` — persisted by Codex exec-style runs where CLI provenance is not explicit

> 核心能力：Telegram 聊到一半，终端 `--resume` 接着干。

## Sending Files

| Type | Support | Handling |
|------|---------|----------|
| Photos | Yes | AI reads images (multimodal) |
| PDF / text / code | Yes | AI reads file content |
| Voice | Yes | AI processes audio |
| Video | No | Send screenshot instead |

## Adapter Interface

Each backend implements the same interface — adding a new backend means writing one adapter file:

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
| **[telegram-ai-bridge](https://github.com/AliceLJY/telegram-ai-bridge)** | Frontend | *This project.* 3 Telegram bots for CC / Codex / Gemini via SDK |
| **[telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)** | Frontend | Telegram → CC / Codex / Gemini via task-api (all backends get full CLI) |
| **[openclaw-worker](https://github.com/AliceLJY/openclaw-worker)** | Backend | Task queue + CC/Codex/Gemini Worker |
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

## AI Contributors

- **Claude Code** — architecture iteration, bridge logic, adapter integration
- **Codex** — session resume improvements, metadata parsing, UX polish for Telegram handoff

> AI 协作贡献：Claude Code 参与架构与适配器迭代，Codex 参与会话接续、元数据解析与 TG 接力体验优化。

## License

[MIT](LICENSE)
