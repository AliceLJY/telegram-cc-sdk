<div align="center">

# telegram-ai-bridge

**Heterogeneous AI agents talking to each other in a Telegram group — with real loop-suppression, not just "put two bots in a chat."**

*Claude Code, Codex, Agy, and Kimi as independent full-stack bots, coordinated over a Telegram-native envelope protocol (A2A-TG) with generation-counted loop guards. Always-on, self-hosted, owner-gated.*

Those four are the adapters bundled and tested here, not a closed provider list. Telegram routing, sessions, streaming, A2A-TG, and safety gates sit behind a small adapter boundary, so another agent with a callable CLI or SDK can be added without rebuilding the orchestration layer.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-5.1.1-green.svg)](https://github.com/AliceLJY/telegram-ai-bridge/releases)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)
[![A2A-TG spec](https://img.shields.io/badge/A2A--TG-v1-8a2be2)](docs/a2a-tg-v1.md)
[![GitHub stars](https://img.shields.io/github/stars/AliceLJY/telegram-ai-bridge)](https://github.com/AliceLJY/telegram-ai-bridge)

**English** | [简体中文](README_CN.md)

</div>

> **On the A2A name.** The [A2A protocol](https://a2a-protocol.org) was originally proposed by Google and is now a Linux Foundation project. This repository ships **A2A-TG** — an IM-scenario envelope inspired by A2A with generation-based loop suppression and chat-scoped idempotency. A2A-TG is **not** compatible with official A2A and is not affiliated with the official project. See the [A2A-TG v1 spec](docs/a2a-tg-v1.md).

> Remote Control = your phone *watches* the terminal.
> Channels = the terminal *receives* phone messages.
> **This project = heterogeneous agents collaborating in a group chat, and the chat IS the terminal.**

```
You:      @cc-alpha Analyze this API design
Alpha:    [deep analysis, writes to shared context]

You:      @cc-beta Write integration tests based on Alpha's analysis
Beta:     [reads Alpha's analysis from shared context, writes tests]

You:      @cc-gamma Review both — any gaps?
Gamma:    [reads everything, reviews]

You:      @cc-delta Ship it — commit and push
Delta:    [reads full context, commits]
```

**4 agents, 1 group, shared memory, zero noise.** The same workflow that takes 4 terminal windows on your desk — now fits in your pocket.

---

## Pick your path

Four different jobs this project does. Each entry point is independent — you do not need to read the whole README to use one mode.

| If you want to…                                                        | Start here                                         | Core tech                         |
|------------------------------------------------------------------------|----------------------------------------------------|-----------------------------------|
| **Control one Claude Code from your phone**                            | [Quick Start](#quick-start)                        | Single bot, Agent SDK             |
| **Run N parallel Claude sessions with shared memory (War Room)**       | [Parallel Sessions](#parallel-sessions--desktop-power-phone-form-factor) → [Multi-Instance Deployment](#multi-instance-deployment) | @mention dispatch + pluggable shared context (SQLite/Redis) |
| **Let Claude and Codex actively talk to each other in a group**        | [A2A-TG: Heterogeneous agents in one group chat](#a2a-tg-heterogeneous-agents-in-one-group-chat) | A2A-TG envelope + 5-layer loop guard |
| **Read the protocol / embed A2A-TG in your own bot**                   | [A2A-TG v1 spec](docs/a2a-tg-v1.md)                | HTTP/JSON envelope, generation cap |

---

## What This Unlocks

### Parallel Sessions — Desktop Power, Phone Form Factor

On your desktop you run 4-5 Claude Code windows simultaneously. Now do the same from your phone:

```
TG Bot 1 (🟣) ──→ CC Instance 1 ──┐
TG Bot 2 (🔵) ──→ CC Instance 2 ──┤── Shared: CLAUDE.md + MCP memory + ~/.claude/
TG Bot 3 (🟢) ──→ CC Instance 3 ──┤
TG Bot 4 (🟡) ──→ CC Instance 4 ──┘
```

Each bot runs an independent CC process with its own session. Not a thin API client — **full Claude Code** with all native tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch), skills, hooks, and MCP servers. All instances share the same memory layer (CLAUDE.md, memory-store, project settings) — what you tell one, the others already know. No memory fragmentation, no sync overhead.

Setup takes 30 seconds per instance: create a bot with @BotFather, copy a config, start a process. See [Multi-Instance Deployment](#multi-instance-deployment) below.

**Want different personalities?** Point each bot's `cwd` to a directory with its own `CLAUDE.md`. CC loads global rules from `~/.claude/CLAUDE.md` + per-bot persona from the workspace — just like OpenClaw's SOUL.md, but with CC's full skill/hook/MCP stack behind it.

```
~/.claude/CLAUDE.md              ← shared rules (memory, safety, workflow)
~/bots/researcher/CLAUDE.md      ← "You are a deep research analyst..."
~/bots/reviewer/CLAUDE.md        ← "You are a senior code reviewer..."
~/bots/writer/CLAUDE.md          ← "You are a content strategist..."
```

### Phone-First Agent Control

Walk away from your desk. Open Telegram. `/new` starts a fresh session. `/resume 3` picks up where you left off. `/peek 5` reads a session without touching it. `/model` switches models on the fly. Full session lifecycle from your phone — no terminal required.

The session picker shows **the last thing you said** as the title — not a truncated UUID. Tap a button or type `/resume 3`. Sessions from all sources (this bot, terminal CLI, other bridges) appear in one unified list.

### Bidirectional Media — Screenshots & Files Flow Back

Input has always been bidirectional: text, photos, documents, voice all flow to CC. Now **output is too**:

- **Screenshots**: CC takes a screenshot → image appears in your TG chat automatically
- **Files**: CC creates or references a file → bridge detects the path and sends it as a TG attachment
- **Long code**: Output >4000 chars with >60% code → sent as a file attachment with preview summary

The bridge captures images from SDK tool results (base64 data from Read/peekaboo/screenshot tools) and scans CC's response text for file paths. No manual copy-paste, no "where did you save it?" — files just appear in the chat.

> **Reply to cancel**: Task taking too long? Send `/cancel` to abort. Need context from a previous message? Reply to it — the quoted text is automatically included as context.

### Multi-Agent Collaboration

Put `@claude-bot` and `@codex-bot` in the same Telegram group. Ask Claude to review code — Codex reads the reply via shared context and offers its own take automatically. Built-in loop guards and circuit breakers prevent runaway bot-to-bot conversations. For DM cross-checking, bots communicate directly via MCP/CLI — no relay needed.

### War Room — Multi-CC Command Center

Put all 4 CC bots in one Telegram group. Each bot stays silent until @mentioned — no crosstalk, no chaos. But every bot can read what the others said via a pluggable shared context store (SQLite by default, Redis as an option for multi-bot / Docker setups — see [Storage Backend Comparison](#storage-backend-comparison)). You orchestrate — they execute.

Two collaboration modes in one project:
- **A2A mode** (CC + Codex group): bots auto-respond to each other with loop guards — for brainstorming and debate
- **War Room mode** (multi-CC group): @mention only — for coordinated parallel execution

For softer group-chat behavior, allowlist the room with `shared.discussChatIds`. Allowlisted rooms default to Discuss mode: each bot can read an unmentioned human message and independently decide whether it has something useful to add. A bot that is explicitly @mentioned or replied to must answer; the others still self-select. Bots that opt out stay silent; bots that opt in send normal text only. Use `/discuss off` to quiet a room explicitly, and `/discuss on` to re-enable it. The bridge suppresses progress bubbles in this mode but keeps Telegram's native typing indicator, so the room stays quiet without becoming opaque.

Done discussing? `/export` dumps the entire cross-bot conversation as a Markdown file — full audit trail, every bot's contribution timestamped.

### Always-On, Self-Hosted

macOS LaunchAgent or Docker keeps the bridge running in the background. Sessions and bridge configuration stay on the host in SQLite/JSON files. Telegram messages still pass through Telegram, and prompts plus selected code/tool context follow the data path of the Claude, Codex, Agy, or Kimi backend you configure. Owner-only triggering is the default; it is not a guarantee that model traffic remains local.

### Production-Grade Reliability

Not a toy — built for all-day use:

- **Send retry with backoff**: Exponential retry (3 attempts, 1s→2s→4s + jitter), auto-parse Telegram 429 rate limits, HTML→plaintext fallback on parse errors
- **Sliding-window rate limiter**: Configurable per-chat throttle (default 10 req/60s), auto-cleanup of expired windows
- **FlushGate message batching**: 800ms aggregation window (max 5 buffered), prevents rapid-fire messages from flooding the chat
- **Graceful shutdown**: 25-second drain timeout for active queries, force-abort hung tasks, progress message cleanup
- **Live streaming preview**: Real-time editMessage updates (2s throttle, 20-char min delta), tool call collapsing ("Bash x5" instead of 5 lines)
- **Polling conflict recovery**: Automatic detection and backoff when multiple processes poll the same bot token

> **Why this matters:** Claude's official tools give you one session, tied to a terminal. OpenClaw gives you one bot per session, isolated memory. This project gives you N parallel sessions with shared memory, persistent state, and full CC capabilities — the same productive workflow you have on desktop, now available everywhere you have Telegram.

---

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) runtime, a Telegram bot token (from [@BotFather](https://t.me/BotFather)), and at least one backend CLI: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://openai.com/index/codex/), [Antigravity CLI](https://antigravity.google) (`agy`), or [Kimi Code](https://moonshotai.github.io/kimi-code/).

> **Supported v5 install path:** clone this repository and use Bun as shown below. The npm package is still a historical v3.1.0 snapshot and is not a supported v5 distribution channel; do not use `npm install telegram-ai-bridge` for this release line.

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
bun run setup --backend claude   # interactive wizard: prompts for owner ID, bot token, etc.
bun run check --backend claude
bun run start --backend claude
```

### Upgrade from v5.0.1

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run check --backend claude  # repeat for each configured backend
```

Existing Claude, Codex, and legacy Gemini configurations remain valid. Agy and
Kimi are disabled unless you add and enable their backend blocks. Codex keeps
the existing `sdk` transport by default; `app-server` is opt-in. No session or
database migration is required. Restart processes only when you are ready to
put the prepared version into service.

> **Run `setup` on its own — it's interactive.** It's a prompt-driven wizard that waits for your input and writes `config.json` for you, so don't paste the whole block at once.
>
> **What `check` verifies (and what it doesn't):** it validates config *shape* — required fields present, token *format* looks plausible. It does **not** confirm the backend CLI is installed and logged in, or that the token is real — a well-formed but fake token passes `check` and only fails at runtime. Make sure the Prerequisites above are actually in place.
>
> **Prefer a non-interactive flow?** Run `bun run bootstrap --backend claude` to generate a `config.json` template, then edit it by hand (`ownerTelegramId`, `telegramBotToken`, `tasksDb`) before `check`. See the Configuration section below.

> **Want parallel agents?** Add a second bot in 30 seconds — see [Multi-Instance Deployment](#multi-instance-deployment).

### Recommended Deployment

Run multiple bots for parallel workflows:

- `@cc-alpha` → Claude Code instance 1 (primary)
- `@cc-beta` → Claude Code instance 2 (parallel tasks)
- `@cc-gamma` → Claude Code instance 3 (parallel tasks)
- `@your-codex-bot` → Codex (different backend)

Each Claude instance shares memory automatically. No configuration needed — CC's memory lives in `~/.claude/`, not in the bot.

Supported backends:

| Backend | CLI / SDK | Capabilities |
|---------|-----------|--------------|
| `claude` | Claude Code (via Agent SDK) | Full native toolchain, skills, hooks, MCP; streaming output; effort tiers; `/sessions` `/resume` |
| `codex` | Codex CLI (via app-server transport) | Reasoning-effort tiers, sandbox modes; `/sessions` `/resume` |
| `agy` | Antigravity CLI (Gemini-family models) | Streaming output; `--effort` low/medium/high; `/sessions` `/resume` |
| `kimi` | Kimi Code CLI | Streaming output; `/sessions` `/resume`; thinking effort is a global CLI setting, not per-call |

> **On `agy`.** `agy` is the [Antigravity CLI](https://antigravity.google) — Google's unified CLI (the standalone `gemini` command was folded into it) and the current way this bridge reaches Gemini-family models. It supersedes the older `gemini` backend, which went through the Gemini Code Assist API rather than a real CLI.
>
> **Do not use the legacy `gemini` backend. This is an account-safety issue, not just a dead feature.**
>
> That adapter reads `~/.gemini/oauth_creds.json` and reuses the Gemini CLI's own OAuth client to reach the
> internal Code Assist endpoint. Google's FAQ names this exact pattern: *"Using third-party software, tools,
> or services to harvest or piggyback on Gemini CLI's OAuth authentication to access our backend services is
> a direct violation of our applicable terms and policies"*, and says it *"may be grounds for immediate
> suspension or termination of your account."* Paid subscribers have reportedly lost access over it. This
> applies regardless of your plan tier — it is the mechanism that is prohibited, not the account type.
>
> Separately, Google retired the standalone `gemini` CLI for personal accounts on 2026-06-18, so
> `oauth_creds.json` is no longer produced and the adapter cannot authenticate there either.
>
> The supported way for third-party software to reach Gemini models is a **Vertex AI or Google AI Studio API
> key**. Use the `agy` backend instead.

> **Core rule:** One bot = one process = one independent agent. Run as many as you need.

> **The bridge is transparent.** Your TG bot inherits whatever skills, MCP servers, and hooks your local CC has. If CC can browse the web, generate images, or query databases in terminal — it can do the same through Telegram. The bridge adds session management; the capabilities come from CC itself.

---

## Telegram Commands

Sessions are sticky: messages continue the current session until you explicitly change it.

| Command | Description |
|---------|-------------|
| `/help` | Show all commands with descriptions |
| `/new` | Start a new session |
| `/cancel` | Abort the currently running task |
| `/sessions` | List recent sessions |
| `/peek <id>` | Read-only preview a session |
| `/resume <#\|id>` | Resume by sequence number or session ID |
| `/model` | Pick a model for the current bot |
| `/effort [level\|default]` | Show or set reasoning effort for the current bot (levels come from the backend adapter; `default` restores the configured default) |
| `/status` | Show backend, model, cwd, and session |
| `/discuss status\|on\|off` | Control opt-in Discuss mode for allowlisted group chats |
| `/dir` | Switch working directory |
| `/tasks` | Show recent task history |
| `/verbose 0\|1\|2` | Change progress verbosity |
| `/cron` | Manage scheduled tasks |
| `/export` | Export group shared context as Markdown file |
| `/doctor` | Run health check |
| `/a2a` | Show A2A bus status, peer health, and loop guard stats |

---

## How It Compares

Comparison snapshot: **2026-07-17**. These products evolve quickly; follow the linked official documentation for current behavior.

- [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) is Anthropic's supported web/mobile window into local Claude Code. Its server mode can create multiple sessions, while interactive mode exposes one local session per process.
- [Claude Code Channels](https://code.claude.com/docs/en/channels) supplies official Telegram, Discord, and iMessage plugins with sender allowlists and optional permission relay. It is a Claude-only, research-preview path tied to a running session.
- [OpenClaw](https://docs.openclaw.ai/providers) is a broad multi-provider, multi-channel gateway. It is not provider-locked and serves a wider platform role than this repository.
- **telegram-ai-bridge** is the narrower choice when you specifically want a self-hosted Telegram-first bridge with its own `/new`/`resume`/`peek` lifecycle, multi-bot shared context, and the repository's A2A-TG loop-suppression protocol across Claude, Codex, Agy, and Kimi backends.

Choose the official Claude paths for the smallest supported Claude-only setup, OpenClaw for a general gateway, and this project for its specific Telegram multi-bot workflow. This is positioning, not a claim that every feature in the alternatives has an exact equivalent here.

---

## Multi-Bot Group Collaboration

Telegram bots cannot see each other's messages — this is a platform-level limitation. When you put Claude and Codex in the same group, neither can read the other's replies.

This project works around it with a **pluggable shared context store**. Each bot writes its reply after responding. When another bot is @mentioned, it reads the shared context and includes the other bot's replies in its prompt.

```text
You: @claude Review this code
CC:  [reviews code, writes reply to shared store]

You: @codex Do you agree with CC's review?
Codex: [reads CC's reply from shared store, gives opinion]
```

No copy-pasting needed. Built-in limits (30 messages / 3000 tokens / 20-minute TTL) prevent context bloat.

### Storage Backend Comparison

| Backend | Dependencies | Concurrency | Best For |
|---------|-------------|-------------|----------|
| `sqlite` (default) | None (built-in) | WAL mode, single-writer | Single bot, low concurrency |
| `json` | None (built-in) | Atomic write (tmp+rename) | Zero-dependency deployment |
| `redis` | `ioredis` | Native concurrency + TTL | Multi-bot, Docker environment |

Set `sharedContextBackend` in `config.json`:

```json
{
  "shared": {
    "sharedContextBackend": "redis",
    "redisUrl": "redis://localhost:6379"
  }
}
```

> **Note:** Bots only respond when explicitly @mentioned or replied to. They don't auto-reply to each other.

### A2A-TG: Heterogeneous agents in one group chat

Beyond passive shared context, A2A-TG lets bots **actively respond** to each other. When one bot replies to a user, the A2A-TG bus broadcasts the envelope over loopback HTTP to sibling bots. Each sibling independently decides whether to chime in — and crucially, **it does not re-broadcast its own reply**, so the chain terminates by design.

```text
You:    @claude What's the best way to handle retries?
Claude: [responds with retry pattern advice]
         ↓ A2A-TG broadcast (generation=1)
Codex:  [reads Claude's reply, adds: "I'd also suggest exponential backoff..."]
         ✗ Codex's reply is NOT broadcast further — chain ends here
```

#### Why A2A-TG and not plain A2A

The [official A2A protocol](https://a2a-protocol.org) is designed for web services discovering each other via Agent Cards and exchanging long-running Tasks over HTTPS. telegram-ai-bridge runs agents in group chats, where peers are few and pre-configured, turns are short and high-frequency, and the dominant failure mode is ping-pong loops.

A2A-TG keeps the spirit (agent-to-agent peer communication, envelope with correlation/idempotency, TTL) but adds what IM actually needs:

- **`generation`** — a turn counter with a hard cap (`>= 2` is rejected). Official A2A has no equivalent.
- **Chat-scoped idempotency** — fingerprints are keyed on `(chat_id, sender, content)`, not on a web-service task ID.
- **Loopback-only transport** — peers live on `127.0.0.1`; there is no internet-facing endpoint and no OAuth dance.

Full field-by-field definition, compatibility matrix, and reserved-hooks list: **[A2A-TG v1 spec](docs/a2a-tg-v1.md)**.

#### Envelope at a glance

```json
{
  "protocol_version": "a2a-tg/v1",
  "message_id": "<time-ordered id>",
  "idempotency_key": "<unique per envelope>",
  "sender": "claude",
  "chat_id": -1001234567890,
  "generation": 1,
  "content": "...",
  "ttl_seconds": 300
}
```

Source of truth: [`a2a/envelope.js`](a2a/envelope.js). As of v1.1 the on-wire tag is `a2a-tg/v1` (self-identifying, distinct from official A2A). The validator still accepts the legacy `a2a/v1` tag during a two-minor-version compatibility window and logs a one-time deprecation warning per legacy tag, so running bot instances keep talking to each other mid-rollout (see spec §1, §9).

#### Five layers of loop suppression (all active today)

1. **Generation cap** — `validateEnvelope()` rejects `generation >= 2`. User prompts are generation 0, a bot's first reply is generation 1, any further rebroadcast is blocked at the wire.
2. **AI self-decline** — each bot's prompt allows returning `[NO_RESPONSE]` when it has nothing useful to add; the bridge skips the TG send.
3. **No-rebroadcast policy** — A2A-triggered replies are written to shared context and sent to Telegram, but are **not** re-broadcast through the A2A-TG bus. This breaks the ping-pong chain at the source. Reference: [`bridge.js:311`](bridge.js).
4. **Idempotency dedup** — SHA-256 fingerprint of `(chat_id, sender, content)` with 300s TTL rejects duplicate envelopes.
5. **Peer circuit breaker** — a peer that fails 3 times in a row is marked unavailable; a half-open probe resets it on recovery.

> `loop-guard.js` also keeps `cooldownMs` / `maxResponsesPerWindow` / `windowMs` as **reserved hooks** (not currently wired). The no-rebroadcast policy already covers loop prevention for the current architecture — the fields are preserved as extension points if a future mode ever re-enables chain replies.

#### Safety boundary

> **A2A-TG only works in group chats.** Private/DM conversations are never broadcast — this is enforced at both the inbound filter and the outbound broadcaster. Two people DMing two different bots on the same account cannot leak into each other's context.

#### Enable

```json
{
  "shared": {
    "a2aEnabled": true,
    "a2aPorts": { "claude": 18810, "codex": 18811 }
  }
}
```

Each bot instance listens on its assigned loopback port. Peers are auto-discovered from `a2aPorts` (excluding self). `/a2a` from Telegram shows live stats — bus status, peer health, loop-guard counters.

For all local LaunchAgent instances plus optional mini targets:

```bash
./scripts/status-all.sh
A2A_STATUS_URLS='mini-claude=http://mini.local:18810/a2a/status' ./scripts/status-all.sh
```

## Security & trust model

This bridge runs full Claude Code / Codex with your local credentials, so it is worth being explicit about what it does and does not protect against.

- **Data does not all stay local.** Config, session state, and A2A-TG envelopes stay on the host, but Telegram traffic goes through Telegram and each AI backend sends prompts plus selected context according to that provider's service and settings.
- **Owner gating protects the trigger, not the content.** `ownerTelegramId` controls who can invoke a bot. It does **not** sanitize the content of replies, shared context, or A2A-TG envelopes. Anyone already in an authorized group chat can see whatever the bots say.
- **Group chats write to shared storage.** Every bot reply in a group is written to the shared-context store (SQLite / JSON / Redis). Do not add the bots to a group you do not control — conversations persist on your disk, and any bot in the group can read them when next @mentioned.
- **A2A-TG broadcasts are loopback-only and group-scoped.** Envelopes never leave `127.0.0.1`, and the inbound/outbound filters reject `chat_id > 0` (DMs). Two people DMing two bots cannot leak into each other's context.
- **`bypassPermissions` disables tool approval prompts.** With this mode enabled, the bot executes Bash / Write / Edit tools without asking. That is convenient for personal use on your own machine; it is dangerous if anyone else can reach the bot. Keep it off unless you understand the blast radius.
- **Secrets in config.** `config.json` is `.gitignore`'d. `bun run config` redacts secrets when printing. Do not share bridge logs raw — they can contain tool outputs with sensitive paths.
- **Upstream trust.** The bridge inherits whatever your local Claude Code / Codex / Agy / Kimi can do — MCP servers, hooks, skills. If you install an untrusted skill or MCP, the bot inherits the risk.

---

## Architecture

```text
Telegram bot
  → start.js
  → config.json
  → bridge.js
  → executor (direct | local-agent)
  → backend adapter (claude | codex | agy | kimi)
  → local credentials and session files
```

Each bot instance keeps its own Telegram token, SQLite DBs, credential directory, and model settings.

---

<details>
<summary><strong>Configuration</strong></summary>

`bun run bootstrap --backend claude` generates a starter `config.json`. Or copy `config.example.json`.

```json
{
  "shared": {
    "ownerTelegramId": "123456789",
    "cwd": "/Users/you",
    "httpProxy": "",
    "defaultVerboseLevel": 1,
    "executor": "direct",
    "tasksDb": "tasks.db",
    "sharedContextBackend": "sqlite",
    "sharedContextDb": "shared-context.db",
    "redisUrl": "",
    "streamPreviewEnabled": true
  },
  "backends": {
    "claude": {
      "enabled": true,
      "telegramBotToken": "...",
      "sessionsDb": "sessions.db",
      "model": "claude-sonnet-4-7",
      "permissionMode": "default"
    },
    "codex": {
      "enabled": true,
      "telegramBotToken": "...",
      "sessionsDb": "sessions-codex.db",
      "model": "",
      "transport": "sdk"
    },
    "agy": {
      "enabled": false,
      "telegramBotToken": "",
      "sessionsDb": "sessions-agy.db",
      "model": "gemini-3.8-flash-high",
      "defaultEffort": "high",
      "timeoutMs": 1800000
    },
    "kimi": {
      "enabled": false,
      "telegramBotToken": "",
      "sessionsDb": "sessions-kimi.db",
      "model": "",
      "defaultEffort": "",
      "timeoutMs": 1800000
    }
  }
}
```

`config.json` is gitignored. Sessions run until completion — no hard timeout (a soft watchdog logs after 15 minutes without aborting).

Inspect resolved config: `bun run config --backend claude` (secrets redacted).

</details>

<details>
<summary><strong>Backend Notes</strong></summary>

**Claude:**
- Requires local login state under `~/.claude/`
- Supports `permissionMode`: `default` or `bypassPermissions`

**Codex:**
- Requires local login state under `~/.codex/`
- Optional `model` override; empty string uses Codex defaults
- `transport: "sdk"` keeps the stable non-interactive SDK path. `transport: "app-server"` is experimental: it writes App-compatible threads that shared thread inventory can index, but it does not make the desktop sidebar live-subscribe to externally created turns.

**Agy:**
- Requires the [Antigravity CLI](https://antigravity.google) (`agy`) with its own login state
- `defaultEffort`: `low` / `medium` / `high`
- Streams output — replies arrive incrementally, and active tool steps surface as progress lines
- `timeoutMs` sets the single-query hard timeout; omit it to fall back to 600000 (10 min)

**Kimi:**
- Requires [Kimi Code CLI](https://moonshotai.github.io/kimi-code/) with its own login state
- Streams output
- No per-call effort flag — thinking effort lives in the CLI's own `config.toml` as a global setting, so this backend deliberately exposes only a single "default" tier rather than a list that would not take effect
- `timeoutMs` as above; long-running tasks generally want 1800000

**Gemini (legacy, superseded by `agy` — retired for personal accounts):**
- Runs through the Gemini Code Assist API rather than a real CLI, so capabilities are narrower
- Requires `~/.gemini/oauth_creds.json`, `oauthClientId`, `oauthClientSecret`
- **Do not use this path — see the account-safety note above.** Piggybacking on Gemini CLI OAuth from third-party software is a direct terms violation per Google's FAQ and may be grounds for account suspension or termination, regardless of plan tier. Separately, the credentials file it needs is no longer produced on personal accounts since the 2026-06-18 CLI retirement. Use `agy`, or a Vertex AI / AI Studio API key.

</details>

## Multi-Instance Deployment

Run N parallel Claude Code instances, each with its own Telegram bot:

**1. Create a bot** — message @BotFather on Telegram, get a token.

**2. Create a config file** — copy and customize:

```bash
cp config.json config-2.json
# Edit config-2.json: use a brand-new bot token from @BotFather (each instance needs its own),
#   and change sessionsDb / tasksDb. Never reuse a token already polled by another running
#   instance or repo — two processes sharing one token both get Telegram 409 Conflict.
```

```json
{
  "shared": {
    "ownerTelegramId": "YOUR_ID",
    "tasksDb": "tasks-2.db"
  },
  "backends": {
    "claude": {
      "enabled": true,
      "telegramBotToken": "NEW_TOKEN_FROM_BOTFATHER",
      "sessionsDb": "sessions-2.db",
      "model": "claude-opus-4-7",
      "permissionMode": "bypassPermissions"
    }
  }
}
```

**3. Start it:**

```bash
bun run start --backend claude --config config-2.json
```

**4. (Optional) Register as LaunchAgent** for auto-start:

```bash
./scripts/install-launch-agent.sh --backend claude --instance 2 --config config-2.json --install
bun run check-configs config.example.json config-2.json
```

See the LaunchAgent section below for plist setup.

**5. (Optional) Mark one instance as the primary bot** — `/sessions` and `/resume` are only exposed on the instance started with `BRIDGE_OWNER=true` (`install-launch-agent.sh --owner`); the other bots hide them and point the user to the primary bot instead. Tell them where to point with `shared.historyBots` (backend → primary bot username):

```json
"shared": {
  "historyBots": { "claude": "@your_claude_bot", "kimi": "@your_kimi_bot" }
}
```

Leave it out and secondary bots just say "another bot".

> **What's shared vs isolated:**
>
> | Shared (automatic) | Isolated (per-instance) |
> |---|---|
> | `~/.claude/` (CLAUDE.md, memory, skills, hooks) | Telegram bot token |
> | MCP servers (memory-store, etc.) | SQLite sessions DB |
> | Project settings & rules | SQLite tasks DB |
> | Git repos & file system | Log files |

---

<details>
<summary><strong>macOS LaunchAgent</strong></summary>

Generate and install:

```bash
./scripts/install-launch-agent.sh --backend claude --install
./scripts/install-launch-agent.sh --backend codex --install
./scripts/install-log-rotation.sh --install
```

The wrapper runs `bun run check` before `bun run start`, so bad config fails fast.
Logs are written under `~/Library/Logs/telegram-ai-bridge/` and the rotation agent copy-truncates them daily at 03:00.

Default labels: `com.telegram-ai-bridge`, `com.telegram-ai-bridge-codex`, `com.telegram-ai-bridge-agy`, `com.telegram-ai-bridge-kimi`.

```bash
launchctl print gui/$(id -u)/com.telegram-ai-bridge
launchctl kickstart -k gui/$(id -u)/com.telegram-ai-bridge
tail -f ~/Library/Logs/telegram-ai-bridge/bridge.log
```

If you see `409 Conflict`, another process is polling the same bot token.

</details>

<details>
<summary><strong>Docker</strong></summary>

```bash
docker build -t telegram-ai-bridge .

docker run -d \
  --name tg-ai-bridge-claude \
  -v $(pwd)/config.json:/app/config.json:ro \
  -v ~/.claude:/root/.claude \
  telegram-ai-bridge --backend claude
```

Swap credential mount and `--backend` for other backends. See `docker-compose.example.yml` for a Compose starter.

</details>

<details>
<summary><strong>Project Structure</strong></summary>

- `start.js` — CLI entry for `start`, `bootstrap`, `check`, `setup`, `config`
- `config.js` — Config loader and setup wizard
- `bridge.js` — Telegram bot runtime
- `sessions.js` — SQLite session persistence
- `discuss-mode.js` — Discuss mode send/silent contract, control command semantics, and probe gating
- `group-context-pipeline.js` — Canonical group-message context reduction and rendering
- `telegram-command-routing.js` — Telegram slash-command target parsing, including mention-first control commands
- `streaming-preview.js` — Live text preview via editMessage (throttled, with degradation)
- `progress.js` — Progress messages and typing-only indicators
- `send-retry.js` — Outbound delivery retry with error classification and HTML fallback
- `file-ref-protect.js` — Prevents Telegram auto-linking filenames as domains (.md, .go, .py etc.)
- `shared-context.js` — Cross-bot shared context entry point
- `shared-context/` — Pluggable backends (SQLite / JSON / Redis)
- `a2a/` — Agent-to-agent communication bus, loop guard, peer health
- `adapters/` — Backend integrations
- `launchd/` — LaunchAgent template for macOS
- `scripts/` — Install wrapper and runtime launcher
- `docker-compose.example.yml` — Compose starter

</details>

<details>
<summary><strong>Execution Modes</strong></summary>

- `direct` — runs the backend adapter in-process (default)
- `local-agent` — communicates with a local agent subprocess over JSONL stdio

Set in `config.json` at `shared.executor`, or override with `BRIDGE_EXECUTOR`.

</details>

---

## How It Fits Together

Three ways to make AI agents talk to each other — different protocols, different scenarios:

| Layer | Protocol | How | Scenario |
|-------|----------|-----|----------|
| **Terminal** | MCP | Built-in `codex mcp-server` + `claude mcp serve`, zero code | CC ↔ Codex direct calls in your terminal |
| **Telegram Group** | **A2A-TG** v1 (this project) | Loopback HTTP envelope bus with generation-based loop guards | Multiple heterogeneous bots in one group, chiming in |
| **Telegram DM** | MCP / CLI | Bots call each other directly via terminal config | Direct cross-bot communication, no bridge needed |
| **Server** | [Official A2A](https://a2a-protocol.org) v0.3.0 | [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) *(archived — A2A now built into OpenClaw)* | Web-service agents across servers |

> **MCP vs A2A**: MCP is a tool-calling protocol (I invoke your capability). A2A is a peer communication protocol (I talk to you as an equal). CC calling Codex via MCP is using Codex as a tool — not two agents chatting.
>
> **Official A2A vs A2A-TG**: Official A2A is a Linux Foundation project (originally proposed by Google) for web-service-to-web-service interop. A2A-TG is this repository's IM-scenario envelope inspired by A2A — different scope, different transport, different loop model. Not interchangeable. See [A2A-TG v1 spec §7](docs/a2a-tg-v1.md#7-relation-to-official-a2a).

### Terminal: CLI-to-CLI via MCP (No Telegram Needed)

Claude Code and Codex each have a built-in MCP server mode. Register them with each other and they can call each other directly — no bridge, no Telegram, no custom code:

```bash
# In Claude Code: register Codex as MCP server
claude mcp add codex -- codex mcp-server

# In Codex: register Claude Code as MCP server (in ~/.codex/config.toml)
[mcp_servers.claude-code]
type = "stdio"
command = "claude"
args = ["mcp", "serve"]
```

### Telegram: This Project

Groups use A2A auto-broadcast. DMs go through MCP/CLI direct communication. See sections above.

### Server: openclaw-a2a-gateway *(archived)*

For OpenClaw agents communicating across servers via the official A2A v0.3.0 protocol (Linux Foundation project, originally proposed by Google). A2A is now built into OpenClaw as a native plugin — the standalone gateway has been archived. See [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) for historical reference.

Code attribution: the `a2a/` directory in this repository (envelope, idempotency store, peer-health manager) started as a simplified port of openclaw-a2a-gateway (MIT license) and has since diverged into the A2A-TG shape. Original copyright and license text are preserved.

## Development

```bash
bun test
```

GitHub Actions runs the same suite on every push and pull request.

## Ecosystem

Part of the **小试AI** open-source AI workflow:

| Project | Description |
|---------|-------------|
| [recallnest](https://github.com/AliceLJY/recallnest) | MCP memory workbench (LanceDB + Jina v5) |
| content-publisher *(private)* | Image generation + layout + WeChat publishing |
| [openclaw-tunnel](https://github.com/AliceLJY/openclaw-tunnel) | Docker ↔ host CLI bridge (/cc /codex) |
| [digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill) | Build digital clones from corpus data |
| [claude-code-studio](https://github.com/AliceLJY/claude-code-studio) | Multi-session collaboration platform for Claude Code |
| cc-empire *(private)* | Complete Claude Code workflow scaffold |
| [tg-bridge-channel](https://github.com/AliceLJY/tg-bridge-channel) | Sister bridge using Claude Agent View background sessions (channel/pool engine) |

## License

MIT
