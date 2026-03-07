# telegram-ai-bridge

**English** | [简体中文](README_CN.md)

Three separate Telegram bots for three separate AI backends: Claude, Codex, and Gemini. The codebase is shared, but the backend capabilities are not equivalent.

## Tested Environment

- macOS
- Bun
- One Telegram bot token per backend
- Claude local login already available
- Codex local login already available
- Gemini OAuth creds already present under `~/.gemini/`
- Multi-instance LaunchAgent workflow tested on the author's own machine

## Compatibility Notes

- This project is tested in the author's own macOS multi-bot setup.
- The helper start scripts include the author's own absolute paths and must be adapted by other users.
- Backend capabilities differ by provider.
- Gemini in this repository is API chat mode, not full CLI mode.
- The bridge is owner-only by design and expects a valid `OWNER_TELEGRAM_ID`.

## Backend Differences

The three backends do not expose the same capability surface:

| Backend | Implementation in this repo | Session source | Local tool / file capability |
|---------|-----------------------------|----------------|------------------------------|
| Claude | Agent SDK via [`adapters/claude.js`](adapters/claude.js) | `~/.claude/projects/` | Yes, through the local Claude Code tool model |
| Codex | Codex SDK via [`adapters/codex.js`](adapters/codex.js) | `~/.codex/sessions/` | Yes, but `/sessions` only shows this chat's own resumable sessions by default |
| Gemini | Code Assist API via [`adapters/gemini.js`](adapters/gemini.js) | In-memory API session plus `~/.gemini/oauth_creds.json` auth | No equivalent local CLI file or command control in this repo |

Important consequence:

- Claude is the strongest local-tool backend here.
- Codex can resume local sessions and is close to terminal workflow parity.
- Gemini here is not Gemini CLI. It is Code Assist API chat mode, so local file and command capabilities are not equivalent.

If you want Gemini with fuller CLI-style behavior, use [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge).

## Local Assumptions

- `CC_CWD` defaults to `$HOME`
- Session discovery reads provider-specific local directories
- SQLite session DB is local and per instance
- `SESSIONS_DB` controls the local SQLite file path
- Claude session discovery reads `~/.claude/`
- Codex session discovery reads `~/.codex/`
- Gemini auth expects `~/.gemini/oauth_creds.json`
- Start scripts are machine-specific examples, not universal scripts

## Known Limits

- This project is designed around local credentials already being present on the machine.
- SQLite session state is local to each instance, not a shared remote session service.
- Backend behavior differs enough that a single “same bot, different model” mental model is misleading.
- Gemini here cannot be documented as a drop-in replacement for local CLI execution.
- The bundled `start-codex.sh` and `start-gemini.sh` scripts are machine-specific examples with hardcoded paths.

## Architecture

```text
Telegram Bot A (.env)        -> bridge.js -> Claude adapter -> Agent SDK
Telegram Bot B (.env.codex)  -> bridge.js -> Codex adapter  -> Codex SDK
Telegram Bot C (.env.gemini) -> bridge.js -> Gemini adapter -> Code Assist API
                                      |
                               SQLite (per-instance DB)
```

Each instance is a separate `bridge.js` process with:

- its own `.env` file
- its own Telegram bot token
- its own `SESSIONS_DB`
- its own local backend credentials

## Prerequisites

- Bun runtime
- One Telegram bot token per backend
- A valid `OWNER_TELEGRAM_ID`
- Claude Code local login for the Claude instance
- Codex local login for the Codex instance
- Gemini OAuth credentials for the Gemini instance

## Setup

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
```

Create one env file per backend:

```bash
cp .env.example .env
cp .env.example .env.codex
cp .env.example .env.gemini
```

Recommended variables:

```env
TELEGRAM_BOT_TOKEN=<bot-token>
OWNER_TELEGRAM_ID=<your-telegram-id>
DEFAULT_BACKEND=claude
CC_CWD=/Users/you
SESSIONS_DB=sessions.db
```

Backend-specific reality:

- Claude expects local Claude state under `~/.claude/`
- Codex expects local Codex state under `~/.codex/`
- Gemini expects `~/.gemini/oauth_creds.json` and the OAuth client variables used by `adapters/gemini.js`

## Running

### Direct

```bash
bun bridge.js
./start-codex.sh
./start-gemini.sh
```

### LaunchAgent workflow

The production-tested path on the author's machine is one macOS LaunchAgent per backend instance.

### Docker

If you run this in Docker, mount the provider-specific credential directories that your chosen backend actually needs.

## Commands

| Command | Description |
|---------|-------------|
| `/new` | Reset the current chat session |
| `/sessions` | List resumable sessions created by the current chat |
| `/sessions all` | Show current-chat sessions plus external local sessions as non-resumable references |
| `/resume <session-id>` | Rebind Telegram to an owned session from the current chat |
| `/status` | Show backend, model, cwd, and session |
| `/verbose 0\|1\|2` | Set progress verbosity |

## Session Storage

[`sessions.js`](sessions.js) stores chat binding state in SQLite using `bun:sqlite`.

- The DB filename comes from `SESSIONS_DB`
- Relative DB paths resolve inside this repository
- Each instance should use its own DB file
- Session persistence is local, not remote

## Machine-Specific Scripts

[`start-codex.sh`](start-codex.sh) and [`start-gemini.sh`](start-gemini.sh) contain the author's own absolute paths such as `/Users/anxianjingya/...` and a fixed Bun path. Treat them as personal examples, not portable startup scripts.

## Author

Built by **小试AI** ([@AliceLJY](https://github.com/AliceLJY)).

## License

MIT
