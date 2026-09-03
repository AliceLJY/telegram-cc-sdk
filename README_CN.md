<div align="center">

# telegram-ai-bridge

**异构 AI agent 在 Telegram 群里真正接话——带代际防环，不是把两个 bot 扔一块那种。**

*Claude Code、Codex、Agy、Kimi 各自独立的全栈 bot，通过 IM 原生的封装协议（A2A-TG）协作，带硬性代际计数防死循环。常驻运行，自托管，只有你本人能触发。*

这四个是当前内置并端到端验证的 adapter，不是封闭的 provider 名单。Telegram 路由、session、流式、A2A-TG 和安全闸都收在一个很小的 adapter 边界之外；其他有可调用 CLI 或 SDK 的 agent，可以沿同一边界接入，不必重写整套编排。

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-5.1.0-green.svg)](https://github.com/AliceLJY/telegram-ai-bridge/releases)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![Telegram](https://img.shields.io/badge/Interface-Telegram-26A5E4?logo=telegram)](https://telegram.org/)
[![A2A-TG spec](https://img.shields.io/badge/A2A--TG-v1-8a2be2)](docs/a2a-tg-v1.md)
[![GitHub stars](https://img.shields.io/github/stars/AliceLJY/telegram-ai-bridge)](https://github.com/AliceLJY/telegram-ai-bridge)

[English](README.md) | **简体中文**

</div>

> **关于 "A2A" 这个名字。** [A2A 协议](https://a2a-protocol.org)最早由 Google 提出，现在是 Linux Foundation 的开源项目。本仓库实现的是 **A2A-TG**——一个专为 IM 场景设计的封装协议，借鉴 A2A 的思路，加了代际防环（generation）和群聊级别的指纹去重。A2A-TG **不兼容**官方 A2A，也跟官方项目没有从属关系。完整规范见 [A2A-TG v1 spec](docs/a2a-tg-v1.md)。

> Remote Control = 手机*看着*终端。Channels = 终端*收着*手机消息。**本项目 = 异构 agent 在群里协作，群聊就是终端。**

```
你:       @cc-alpha 分析这个 API 设计
Alpha:    [深度分析，写入共享上下文]

你:       @cc-beta 根据 Alpha 的分析写集成测试
Beta:     [读取 Alpha 的上下文，写测试]

你:       @cc-gamma 审查两边的产出——有没有遗漏？
Gamma:    [读取所有上下文，审查]

你:       @cc-delta 提交推送
Delta:    [读取完整上下文，commit and push]
```

**4 个 agent，1 个群，共享记忆，零噪音。** 桌面上要开 4 个终端窗口的工作流，现在装进口袋。

---

## 挑一条路径用

项目有四种不同用法，互相独立，不必全读完才能用其中一种。

| 你想做的事                                                 | 从哪里开始                                           | 核心技术                         |
|------------------------------------------------------------|------------------------------------------------------|----------------------------------|
| **手机控制一个 Claude Code**                               | [快速开始](#快速开始)                                | 单 bot，Agent SDK                |
| **N 个 Claude 会话并行，共享记忆（War Room）**             | [多窗口并行](#多窗口并行手机就是多窗口终端) → [多实例部署](#多实例部署) | @点名派活 + 可插拔共享上下文（SQLite/Redis） |
| **让 Claude 和 Codex 在群里主动互相接话**                  | [A2A-TG：异构 agent 的群聊协作](#a2a-tg异构-agent-的群聊协作) | A2A-TG 封装 + 五层防环           |
| **读协议规范 / 把 A2A-TG 嵌到你自己的 bot**                | [A2A-TG v1 规范](docs/a2a-tg-v1.md)                  | HTTP/JSON 封装，代际上限         |

---

## 能解锁什么

### 多窗口并行——手机就是多窗口终端

在电脑上你同时开 4-5 个 Claude Code 窗口。现在手机上也一样：

```
TG Bot 1 (🟣) ──→ CC 实例 1 ──┐
TG Bot 2 (🔵) ──→ CC 实例 2 ──┤── 共享：CLAUDE.md + MCP 记忆 + ~/.claude/
TG Bot 3 (🟢) ──→ CC 实例 3 ──┤
TG Bot 4 (🟡) ──→ CC 实例 4 ──┘
```

每个 bot 运行独立的 CC 进程，有自己的会话。不是 API 套壳——是**完整的 Claude Code**，Bash、Read、Write、Edit、Glob、Grep、WebFetch 等原生工具全部可用，skills、hooks、MCP 服务器一个不少。所有实例共享同一套记忆层——你跟任何一个说过的话，其他的都知道。

配一个新实例只要 30 秒：@BotFather 建 bot，复制配置，启动进程。详见下方[多实例部署](#多实例部署)。

**想要不同人格？** 给每个 bot 的 `cwd` 指向一个有自己 `CLAUDE.md` 的目录。CC 加载全局规则 + 工作空间人格——跟 OpenClaw 的 SOUL.md 一样，但背后是 CC 完整的 skill/hook/MCP 能力栈。

```
~/.claude/CLAUDE.md              ← 共享规则（记忆、安全、工作流）
~/bots/researcher/CLAUDE.md      ← "你是一个深度调研分析师..."
~/bots/reviewer/CLAUDE.md        ← "你是一个资深代码审查员..."
~/bots/writer/CLAUDE.md          ← "你是一个内容策略师..."
```

### 手机优先的 Agent 控制

离开工位，打开 Telegram。`/new` 建新会话，`/resume 3` 恢复之前的进度，`/peek 5` 只读浏览某个会话，`/model` 随时切模型。完整的会话生命周期管理——不需要终端。

会话列表以**你说的最后一句话**为标题——不是截断的 UUID。点按钮或输 `/resume 3`。所有来源的会话（本 bot、终端 CLI、其他 bridge）统一显示。

### 双向媒体——截图和文件自动回传

输入一直是双向的：文字、图片、文件、语音都能发给 CC。现在**输出也是**：

- **截图**：CC 截屏 → 图片自动出现在 TG 对话里
- **文件**：CC 创建或引用文件 → bridge 检测路径自动发送为 TG 附件
- **长代码**：输出超 4000 字符且代码占比 >60% → 自动转为文件附件 + 摘要预览

bridge 从 SDK 工具结果中捕获 base64 图片数据，同时扫描 CC 回复文本中的文件路径。不用手动拷贝，不用问"你把文件存哪了"——文件直接出现在对话里。

> **回复消息带上下文**：在 TG 里回复某条历史消息，引用内容自动作为上下文发给 CC。任务跑太久？发 `/cancel` 中断。

### 多 Agent 协作

把 `@claude-bot` 和 `@codex-bot` 拉进同一个 Telegram 群。让 Claude review 代码——Codex 通过共享上下文读到 Claude 的回复，自动给出自己的意见。内置防死循环和熔断机制，防止 bot 之间无限接话。私聊场景下，bot 通过 MCP/CLI 直接互通，无需中转。

### War Room——多 CC 指挥中心

把 4 个 CC bot 拉进同一个群。每个 bot @才说话——不抢话，不混乱。但每个 bot 都能通过可插拔的共享上下文存储读到其他人的回复（默认 SQLite，多 bot / Docker 场景可切 Redis，详见[存储后端对比](#存储后端对比)）。你来调度——它们执行。

两种协作模式：
- **A2A 模式**（CC + Codex 群）：bot 自动互相接话，适合头脑风暴
- **War Room 模式**（多 CC 群）：@点名才说话，适合协调并行执行

如果想要更像群聊的柔性接话，把群 ID 加到 `shared.discussChatIds`。allowlist 群默认就是 Discuss 模式：人类普通消息不需要 @，每个 bot 都会读上下文并自行判断要不要接话；被明确 @ 或被回复的 bot 必须回答，其他 bot 仍然自行判断。不想接的静默，想接的只发正文。需要安静时用 `/discuss off` 显式关闭，需要恢复时用 `/discuss on`。这个模式不显示进度气泡，只保留 Telegram 原生 typing 状态，所以群里安静，但你仍能看见谁在思考。

讨论完了？`/export` 把整个跨 bot 对话导出为 Markdown 文件——完整审计记录，每个 bot 的贡献带时间戳。

### 常驻运行，自托管

macOS LaunchAgent 或 Docker 让 bridge 在后台持续运行。会话和 bridge 配置保存在宿主机的 SQLite/JSON 文件中。Telegram 消息仍会经过 Telegram；prompt、被选中的代码与工具上下文会按你配置的 Claude、Codex、Agy 或 Kimi 后端的数据路径发送。默认只允许 owner 触发，但这不代表模型流量只在本机。

### 生产级可靠性

不是玩具——为全天候使用而设计：

- **发送重试 + 退避**：指数重试（3 次，1s→2s→4s + 随机抖动），自动解析 Telegram 429 限流，HTML 解析失败自动降级纯文本
- **滑动窗口限频**：可配置的 per-chat 限流（默认 10 次/60 秒），自动清理过期窗口
- **FlushGate 消息聚合**：800ms 聚合窗口（最多缓冲 5 条），防止消息洪水
- **优雅关闭**：25 秒排空等待活跃查询完成，超时强制中断挂起任务，自动清理进度消息
- **实时流式预览**：editMessage 实时更新（2 秒节流 + 20 字符最小变化量），工具调用折叠（"Bash x5" 而非 5 行刷屏）
- **Polling 冲突恢复**：多进程轮询同一 bot token 时自动检测并退避

> **为什么这很重要：** 官方工具给你一个会话，绑在终端上。OpenClaw 一个 bot 一个会话，记忆隔离。本项目给你 N 个并行会话，共享记忆，持久状态，完整 CC 能力——桌面上的高效工作流，现在有 Telegram 的地方就能用。

---

## 快速开始

**前置条件：** [Bun](https://bun.sh) 运行时、一个 Telegram bot token（从 [@BotFather](https://t.me/BotFather) 获取）、以及至少一个后端 CLI：[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex](https://openai.com/index/codex/)、[Antigravity CLI](https://antigravity.google)（`agy`）或 [Kimi Code](https://moonshotai.github.io/kimi-code/)。

> **v5 支持的安装方式：** 按下方命令 clone 仓库并使用 Bun。npm 上仍是历史 v3.1.0 快照，不是 v5 的受支持分发渠道；本版本线不要使用 `npm install telegram-ai-bridge`。

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
bun run setup --backend claude   # 交互式向导：逐项提示填 owner ID、bot token 等
bun run check --backend claude
bun run start --backend claude
```

### 从 v5.0.1 升级

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run check --backend claude  # 每个已配置的后端都检查一次
```

现有 Claude、Codex 和旧 Gemini 配置仍然有效。Agy、Kimi 只有在配置块中启用后才会运行；
Codex 继续默认使用原有 `sdk` 传输，`app-server` 需要主动选择。session 和数据库都不需要迁移。
准备完成后，可在你决定启用新版本时再重启进程。

> **`setup` 要单独运行——它是交互式的。** 这是个逐项提示、等你输入的向导，会帮你写好 `config.json`，别把整段命令一次性粘贴进去。
>
> **`check` 验什么、不验什么：** 它只校验配置的*形状*——必填字段是否齐、token *格式*是否像样；**不**确认后端 CLI 是否装好并登录，也**不**验证 token 是否真实——格式合法但假的 token 能过 `check`，只会在运行时才失败。请确保上面的前置条件真的就绪。
>
> **想要非交互流程？** 用 `bun run bootstrap --backend claude` 生成 `config.json` 模板，再手动编辑（填 `ownerTelegramId`、`telegramBotToken`、`tasksDb`）后再 `check`。详见下方的「配置」章节。

> **想跑多个并行实例？** 30 秒加一个 bot——详见[多实例部署](#多实例部署)。

### 推荐部署方式

多 bot 并行，按需扩展：

- `@cc-alpha` → Claude Code 实例 1（主力）
- `@cc-beta` → Claude Code 实例 2（并行任务）
- `@cc-gamma` → Claude Code 实例 3（并行任务）
- `@your-codex-bot` → Codex（不同后端）

所有 Claude 实例自动共享记忆，无需配置——CC 的记忆在 `~/.claude/`，不在 bot 层。

支持的后端：

| 后端 | CLI / SDK | 能力 |
|------|-----------|------|
| `claude` | Claude Code（通过 Agent SDK） | 完整原生工具链、skills、hooks、MCP；流式输出；effort 档位；`/sessions` `/resume` |
| `codex` | Codex CLI（app-server 传输） | reasoning effort 档位、sandbox 模式；`/sessions` `/resume` |
| `agy` | Antigravity CLI（Gemini 系模型） | 流式输出；`--effort` low/medium/high；`/sessions` `/resume` |
| `kimi` | Kimi Code CLI | 流式输出；`/sessions` `/resume`；thinking effort 是 CLI 全局设定，不能按次指定 |

> **关于 `agy`。** `agy` 是 [Antigravity CLI](https://antigravity.google)——Google 的统一 CLI（独立的 `gemini` 命令已被合并进它），也是本 bridge 现在接触 Gemini 系模型的方式。它取代了旧的 `gemini` 后端（后者走 Gemini Code Assist API 而非真正的 CLI）。
>
> **请不要使用旧的 `gemini` 后端。这是账号安全问题，不只是功能失效。**
>
> 该 adapter 读取 `~/.gemini/oauth_creds.json`，复用 Gemini CLI 自己的 OAuth client 去访问 Code Assist
> 内部端点。Google 官方 FAQ 点的正是这种用法：*"Using third-party software, tools, or services to harvest
> or piggyback on Gemini CLI's OAuth authentication to access our backend services is a direct violation of
> our applicable terms and policies"*，并称其 *"may be grounds for immediate suspension or termination of
> your account"*（可构成立即暂停或终止账号的理由）。已有付费订阅用户因此失去访问权限的报告。
> **这与你的套餐等级无关——被禁的是这个机制本身，不是账号类型。**
>
> 另外，Google 已于 2026-06-18 对个人账号停止独立 `gemini` CLI 服务，`oauth_creds.json` 不再产生，
> 该 adapter 在个人账号上也已无法完成认证。
>
> 第三方软件访问 Gemini 模型的受支持方式是 **Vertex AI 或 Google AI Studio API key**。请改用 `agy` 后端。

> **核心规则：** 一个 bot = 一个独立进程 = 一个独立 Agent。想开几个开几个。

> **Bridge 是透明的。** TG bot 继承你本地 CC 的全部能力——skills、MCP 服务器、hooks，终端里能做的事，TG 里一样能做。Bridge 只管会话管理和消息中转，能力全部来自 CC 本身。

---

## Telegram 命令

会话默认是粘住的：只要你不主动切，后续消息继续当前会话。

| 命令 | 说明 |
|------|------|
| `/help` | 查看所有命令及说明 |
| `/new` | 新建会话 |
| `/cancel` | 中断当前正在执行的任务 |
| `/sessions` | 查看最近会话 |
| `/peek <id>` | 只读预览某个会话 |
| `/resume <序号\|id>` | 按序号或 ID 恢复会话 |
| `/model` | 切换当前 bot 的模型 |
| `/status` | 查看后端、模型、工作目录和会话 |
| `/discuss status\|on\|off` | 控制 allowlist 群聊里的 Discuss 模式 |
| `/dir` | 切换工作目录 |
| `/tasks` | 查看最近任务记录 |
| `/verbose 0\|1\|2` | 调整进度输出详细度 |
| `/cron` | 管理定时任务 |
| `/export` | 导出群聊上下文为 Markdown 文件 |
| `/doctor` | 健康检查 |
| `/a2a` | 查看 A2A 总线状态、节点健康和防循环统计 |

---

## 与竞品对比

能力快照日期：**2026-07-17**。这些产品变化很快，当前行为请以链接的一手文档为准。

- [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) 是 Anthropic 官方的 Web/手机远控入口。它的 server mode 可创建多个会话，interactive mode 则是每个本地进程暴露一个会话。
- [Claude Code Channels](https://code.claude.com/docs/en/channels) 提供官方 Telegram、Discord、iMessage 插件，带发送者 allowlist，并可选择转发权限审批；它是依附运行中 Claude 会话的 Claude-only research preview 路径。
- [OpenClaw](https://docs.openclaw.ai/providers) 是覆盖多模型供应商和多种频道的通用 gateway，并不是“绑定单一 Provider”。它的产品范围比本仓更宽。
- **telegram-ai-bridge** 更窄：适合明确需要自托管、Telegram-first、自己维护 `/new`/`resume`/`peek` 生命周期、多 bot 共享上下文，以及跨 Claude/Codex/Agy/Kimi 后端使用 A2A-TG 防环协议的场景。

想要最小、官方支持的 Claude-only 方案，优先选 Anthropic 官方路径；想要通用 gateway，选 OpenClaw；想要本仓这套特定的 Telegram 多 bot 工作流，再选 telegram-ai-bridge。这里是定位说明，不声称其它产品的所有功能在本仓都有一一对应。

---

## 多 Bot 群聊协作

Telegram 的平台限制：bot 之间互相收不到消息。把 Claude 和 Codex 放在同一个群里，它们看不到对方说了什么。

本项目通过**可插拔的共享上下文存储**绕过这个限制。每个 bot 回复后把内容写入共享存储，其他 bot 被 @ 时读取共享上下文，把对方的回复带入 prompt。

```text
你:     @claude 帮我 review 这段代码
CC:     [review 完毕，回复写入共享存储]

你:     @codex 你同意 CC 的 review 吗？
Codex:  [从共享存储读到 CC 的回复，给出自己的意见]
```

不用再复制粘贴。内置三重保护（30 条 / 3000 token / 20 分钟过期）防止上下文膨胀。

### 存储后端对比

| 后端 | 依赖 | 并发 | 适用场景 |
|------|------|------|----------|
| `sqlite`（默认）| 无（内置）| WAL 模式，单写 | 单 bot、低并发 |
| `json` | 无（内置）| 原子写（tmp+rename）| 零依赖部署 |
| `redis` | `ioredis` | 原生并发 + TTL | 多 bot、Docker 环境 |

在 `config.json` 中设置 `sharedContextBackend`：

```json
{
  "shared": {
    "sharedContextBackend": "redis",
    "redisUrl": "redis://localhost:6379"
  }
}
```

> **注意：** bot 只在被 @ 或被回复时才响应，不会自动互相接话。

### A2A-TG：异构 agent 的群聊协作

共享上下文是被动的（被 @ 时才读取）。A2A-TG 让 bot **主动接话**——群聊中一个 bot 回复用户后，A2A-TG 总线通过 loopback HTTP 把信封发给兄弟 bot，每个兄弟独立判断要不要补充。关键一点：**兄弟 bot 自己的回复不会再被广播出去**，链条在设计层面就会终止。

```text
你:     @claude 重试策略怎么写比较好？
Claude: [给出重试建议]
         ↓ A2A-TG 广播（generation=1）
Codex:  [读到 Claude 的回复，补充："我建议再加个指数退避..."]
         ✗ Codex 的回复不会再广播——链条在这里终止
```

#### 为什么叫 A2A-TG 而不是直接用官方 A2A

[官方 A2A 协议](https://a2a-protocol.org)是给 web service 之间通过 Agent Card 互相发现、用 Task 模型交换长事务设计的，走 HTTPS/JSON-RPC。telegram-ai-bridge 的场景完全不同：peer 少、预配置、每轮消息短、高频，主要威胁是 bot 之间的乒乓死循环。

A2A-TG 保留 A2A 的精神（agent 对等通信、带 correlation/idempotency 的信封、TTL），但加了 IM 场景真正需要的东西：

- **`generation` 代际计数**：每个信封有个代数，`>= 2` 直接拒收。官方 A2A 没有这个字段。
- **群聊级指纹去重**：指纹基于 `(chat_id, sender, content)`，不是 web service 的 task ID。
- **只走 loopback**：peer 都在 `127.0.0.1`，没有对外端点，也不需要 OAuth 流程。

逐字段定义、兼容性对照表、预留 hook 说明见 **[A2A-TG v1 规范](docs/a2a-tg-v1.md)**。

#### Envelope 速览

```json
{
  "protocol_version": "a2a-tg/v1",
  "message_id": "<时间有序 id>",
  "idempotency_key": "<每封唯一>",
  "sender": "claude",
  "chat_id": -1001234567890,
  "generation": 1,
  "content": "...",
  "ttl_seconds": 300
}
```

源码见 [`a2a/envelope.js`](a2a/envelope.js)。v1.1 起线上 tag 是 `a2a-tg/v1`，协议身份自证，不再跟官方 A2A 视觉混淆。验证器在过渡期（至少保留两个次版本号的兼容窗口）内继续接受旧 `a2a/v1` tag，并按每个旧 tag 打一次 deprecation 日志，保证所有在跑 bot 实例升级期间不会互相拒收（详见规范 §1、§9）。

#### 五层防环（目前全部激活）

1. **代数上限**：`validateEnvelope()` 拒收 `generation >= 2`。用户触发 = 0，bot 首次回复 = 1，再往上直接在线上被丢。
2. **AI 自我拒答**：bot prompt 允许返回 `[NO_RESPONSE]` 表示"没啥要补充的"，bridge 检测到后跳过 TG 发送。
3. **不再广播策略**：A2A 触发的回复只写共享上下文 + 发 TG，不再调用 `bus.broadcast()`——从源头切断乒乓链。参考：[`bridge.js:311`](bridge.js)。
4. **指纹去重**：`(chat_id, sender, content)` 的 SHA-256 指纹 + 300 秒 TTL，拒收重复信封。
5. **Peer 熔断**：连续 3 次失败的 peer 自动屏蔽，半开探针恢复后重新放行。

> `loop-guard.js` 还保留了 `cooldownMs` / `maxResponsesPerWindow` / `windowMs` 作为**预留 hook**（当前不接入）。"不再广播"策略已经覆盖当前架构的防环需求——这些字段留作未来如果切换到链式回复模式时的扩展点。

#### 安全边界

> **A2A-TG 只在群聊生效。** 私聊/DM 消息永不被广播——入站和出站两端都过滤 `chat_id > 0`。两个人各自 DM 同一个账户下不同的 bot，信息不会互相泄漏。

#### 启用

```json
{
  "shared": {
    "a2aEnabled": true,
    "a2aPorts": { "claude": 18810, "codex": 18811 }
  }
}
```

每个 bot 实例监听自己的 loopback 端口。Peer 列表从 `a2aPorts` 自动发现（排除自身）。Telegram 里发 `/a2a` 查看实时状态——总线状态、peer 健康、防环计数器。

查看本机 LaunchAgent 实例和可选 mini 目标：

```bash
./scripts/status-all.sh
A2A_STATUS_URLS='mini-claude=http://mini.local:18810/a2a/status' ./scripts/status-all.sh
```

## 安全与信任模型

这座桥用你本地的凭证跑完整 Claude Code / Codex，所以值得把"它保护什么、不保护什么"说清楚。

- **并非所有数据都留在本机。** 配置、session 状态与 A2A-TG 信封保存在宿主机；Telegram 流量经过 Telegram，各 AI 后端也会按对应服务与设置发送 prompt 和被选中的上下文。
- **Owner 白名单管的是触发权限，不是内容。** `ownerTelegramId` 控制谁能触发 bot。它**不会**过滤回复内容、共享上下文或 A2A-TG 信封。已经进了授权群的任何人，都能看到 bot 说的所有话。
- **群聊会写进共享存储。** 每条群内 bot 回复都会写入共享上下文存储（SQLite / JSON / Redis）。不要把 bot 拉进你控制不了的群——对话会持久化在你磁盘上，群里任何一个 bot 被 @ 时都能读到。
- **A2A-TG 广播只走 loopback，只在群聊。** 信封从不离开 `127.0.0.1`，入站/出站两端都拒绝 `chat_id > 0`（即 DM）。两个人各自 DM 不同 bot 不会互相泄漏。
- **`bypassPermissions` 会关掉工具授权确认。** 启用这个模式后，bot 不再询问就执行 Bash / Write / Edit。自己本地用很方便，但如果别人能访问到 bot 就危险了——影响半径请心里有数。
- **配置里的密钥。** `config.json` 已在 `.gitignore`。`bun run config` 输出时会隐藏敏感字段。不要把 bridge 日志原样分享出去——日志里可能有工具输出的敏感路径。
- **上游信任传递。** Bridge 继承本地 Claude Code / Codex / Agy / Kimi 的全部能力——MCP 服务器、hooks、skills。装了不可信的 skill 或 MCP，bot 一样继承风险。

---

## 架构

```text
Telegram bot
  → start.js
  → config.json
  → bridge.js
  → executor（direct | local-agent）
  → backend adapter（claude | codex | agy | kimi）
  → 本地凭证和 session 文件
```

每个 bot 实例都有自己独立的 Telegram token、SQLite DB、凭证目录和模型配置。

---

<details>
<summary><strong>配置说明</strong></summary>

`bun run bootstrap --backend claude` 生成起步版 `config.json`。也可以直接复制 `config.example.json`。

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

`config.json` 已加入 `.gitignore`。会话持续运行直到完成——没有硬性超时（软看门狗在 15 分钟无活动后记录日志，但不中断）。

查看最终生效配置：`bun run config --backend claude`（敏感字段自动隐藏）。

</details>

<details>
<summary><strong>后端说明</strong></summary>

**Claude：**
- 需要本地登录状态 `~/.claude/`
- 支持 `permissionMode`：`default` 或 `bypassPermissions`

**Codex：**
- 需要本地登录状态 `~/.codex/`
- `model` 可留空，使用 Codex 默认模型
- `transport: "sdk"` 保留稳定的非交互 SDK 路径；`transport: "app-server"` 是实验路径：它写出的线程可被共享 thread inventory 索引，但不会让桌面 App 侧边栏实时订阅外部创建的 turn。

**Agy：**
- 需要 [Antigravity CLI](https://antigravity.google)（`agy`）及其自身登录态
- `defaultEffort`：`low` / `medium` / `high`
- 流式输出——回复逐段到达，工具执行中的步骤也会作为进度行显示
- `timeoutMs` 设置单次查询硬超时；不填则回落到 600000（10 分钟）

**Kimi：**
- 需要 [Kimi Code CLI](https://moonshotai.github.io/kimi-code/) 及其自身登录态
- 流式输出
- 没有按次生效的 effort 参数——thinking effort 在该 CLI 自己的 `config.toml` 里是全局设定，因此这个后端有意只暴露"默认"一档，而不是给出一个选了也不会生效的列表
- `timeoutMs` 同上；长任务一般需要 1800000

**Gemini（旧路径，已由 `agy` 取代——个人账号已停用）：**
- 走 Gemini Code Assist API 而非真正的 CLI，能力更窄
- 需要 `~/.gemini/oauth_creds.json`、`oauthClientId`、`oauthClientSecret`
- **不要走这条路——见上方账号安全说明。** 按 Google 官方 FAQ，第三方软件 piggyback Gemini CLI 的 OAuth 认证属直接违反条款，可构成暂停或终止账号的理由，**与套餐等级无关**。另外它需要的凭证文件自 2026-06-18 CLI 停服后在个人账号上已不再产生。请改用 `agy`，或 Vertex AI / AI Studio API key。

</details>

## 多实例部署

跑 N 个并行 Claude Code 实例，每个配自己的 Telegram bot：

**1. 创建 bot** — 在 Telegram 找 @BotFather，拿到 token。

**2. 创建配置文件** — 复制并修改：

```bash
cp config.json config-2.json
# 编辑 config-2.json：换成 @BotFather 新发的 bot token（每个实例要独立 token），
#   并改 sessionsDb / tasksDb。绝不要复用其他正在运行的实例/仓库已占用的 token——
#   同一 token 两个进程会双双收到 Telegram 409 Conflict。
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
      "telegramBotToken": "BOTFATHER_给的新_TOKEN",
      "sessionsDb": "sessions-2.db",
      "model": "claude-opus-4-7",
      "permissionMode": "bypassPermissions"
    }
  }
}
```

**3. 启动：**

```bash
bun run start --backend claude --config config-2.json
```

**4.（可选）注册为 LaunchAgent** 开机自启：

```bash
./scripts/install-launch-agent.sh --backend claude --instance 2 --config config-2.json --install
bun run check-configs config.example.json config-2.json
```

详见下方 LaunchAgent 部分。

> **哪些共享，哪些隔离：**
>
> | 共享（自动） | 隔离（按实例） |
> |---|---|
> | `~/.claude/`（CLAUDE.md、记忆、skills、hooks） | Telegram bot token |
> | MCP 服务器（memory-store 等） | SQLite sessions DB |
> | 项目配置和规则 | SQLite tasks DB |
> | Git 仓库和文件系统 | 日志文件 |

---

<details>
<summary><strong>macOS LaunchAgent</strong></summary>

生成并安装：

```bash
./scripts/install-launch-agent.sh --backend claude --install
./scripts/install-launch-agent.sh --backend codex --install
./scripts/install-log-rotation.sh --install
```

包装层会先跑 `bun run check` 再跑 `bun run start`，配置有问题直接失败。
日志写入 `~/Library/Logs/telegram-ai-bridge/`，轮转 agent 每天 03:00 copy-truncate。

默认 label：`com.telegram-ai-bridge`、`com.telegram-ai-bridge-codex`、`com.telegram-ai-bridge-agy`、`com.telegram-ai-bridge-kimi`。

```bash
launchctl print gui/$(id -u)/com.telegram-ai-bridge
launchctl kickstart -k gui/$(id -u)/com.telegram-ai-bridge
tail -f ~/Library/Logs/telegram-ai-bridge/bridge.log
```

如果日志出现 `409 Conflict`，说明另一条进程在轮询同一个 bot token。

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

其他后端替换挂载目录和 `--backend`。详见 `docker-compose.example.yml`。

</details>

<details>
<summary><strong>项目结构</strong></summary>

- `start.js` — `start` / `bootstrap` / `check` / `setup` / `config` CLI 入口
- `config.js` — 配置加载与 setup wizard
- `bridge.js` — Telegram bot 运行时
- `sessions.js` — SQLite 会话持久化
- `discuss-mode.js` — Discuss 模式 send/silent 契约、控制命令和 probe gate
- `group-context-pipeline.js` — 群聊消息上下文归一化、裁剪与渲染
- `telegram-command-routing.js` — TG slash command 目标解析，包括 @bot /command 写法
- `streaming-preview.js` — 实时文本预览（editMessage 流式更新，带节流和降级）
- `progress.js` — 进度消息和 typing-only 状态显示
- `send-retry.js` — 发送重试（错误分类 + 指数退避 + HTML 降级）
- `file-ref-protect.js` — 文件引用保护（防止 TG 把 .md/.go/.py 自动识别为域名链接）
- `shared-context.js` — 跨 bot 共享上下文入口
- `shared-context/` — 可插拔后端（SQLite / JSON / Redis）
- `a2a/` — Bot 间通信总线、防死循环、节点健康检测
- `adapters/` — 后端接入层
- `launchd/` — macOS LaunchAgent 模板
- `scripts/` — 安装脚本与运行包装器
- `docker-compose.example.yml` — Compose 起步模板

</details>

<details>
<summary><strong>执行模式</strong></summary>

- `direct` — 进程内直接调用 backend adapter（默认）
- `local-agent` — 通过 JSONL stdio 与本地 agent 子进程通讯

在 `config.json` 的 `shared.executor` 中设置，或用 `BRIDGE_EXECUTOR` 覆盖。

</details>

---

## 通信全景图

三种让 AI agent 互相对话的方式——协议不同，场景不同：

| 层 | 协议 | 方式 | 场景 |
|---|------|------|------|
| **终端** | MCP | 内置 `codex mcp-server` + `claude mcp serve`，零代码 | CC ↔ Codex 在终端互调 |
| **TG 群聊** | **A2A-TG** v1（本项目） | loopback HTTP 信封总线 + 代际防环 | 多个异构 bot 在群里互相接话 |
| **TG 私聊** | MCP / CLI | Bot 通过终端配置直接互通 | 无需中转，直接跨 bot 通信 |
| **服务端** | [官方 A2A](https://a2a-protocol.org) v0.3.0 | [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway)（已归档） | Web service agent 跨服务器通信 |

> **MCP vs A2A**：MCP 是工具调用协议（我调你的能力），A2A 是对等通信协议（我跟你对话）。CC 通过 MCP 调 Codex，本质是把 Codex 当工具用，不是两个 agent 在聊天。
>
> **官方 A2A vs A2A-TG**：官方 A2A 是 Linux Foundation 的开源项目（Google 最早提出），面向 web service 互通。A2A-TG 是本仓库的 IM 场景信封协议，借鉴 A2A——场景不同、传输不同、防环模型不同，不能直接互换。详见 [A2A-TG v1 规范 §7](docs/a2a-tg-v1.md#7-relation-to-official-a2a)。

### 终端：CLI 直连（不经过 Telegram）

Claude Code 和 Codex 各自内置了 MCP server 模式，互相注册就通了——不需要桥接、不需要 Telegram、不需要写代码：

```bash
# Claude Code 里注册 Codex
claude mcp add codex -- codex mcp-server

# Codex 里注册 Claude Code（在 ~/.codex/config.toml）
[mcp_servers.claude-code]
type = "stdio"
command = "claude"
args = ["mcp", "serve"]
```

### Telegram：本项目

群聊走 A2A 自动广播，私聊通过 MCP/CLI 直接互通。详见上面的章节。

### 服务端：openclaw-a2a-gateway（已归档）

OpenClaw agent 通过官方 A2A v0.3.0 标准协议跨服务器通信（Linux Foundation 项目，Google 最早提出）。A2A 现在是 OpenClaw 的原生插件，独立 gateway 已归档——见 [openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) 作为历史参考。

代码归属：本仓库 `a2a/` 目录（envelope、idempotency store、peer-health manager）最初从 openclaw-a2a-gateway（MIT 协议）简化移植而来，之后按 A2A-TG 形态演化。原始 copyright 和 license 已保留。

## 开发

```bash
bun test
```

GitHub Actions 会在每次 push 和 pull request 上运行同一套测试。

## 生态

**小试AI** 开源 AI 工作流的一部分：

| 项目 | 说明 |
|------|------|
| [recallnest](https://github.com/AliceLJY/recallnest) | MCP 记忆工作台（LanceDB + Jina v5） |
| content-publisher *(private)* | AI 配图 + 排版 + 微信公众号发布 |
| [openclaw-tunnel](https://github.com/AliceLJY/openclaw-tunnel) | Docker ↔ 宿主机 CLI 桥接（/cc /codex） |
| [digital-clone-skill](https://github.com/AliceLJY/digital-clone-skill) | 从语料数据构建数字分身 |
| [claude-code-studio](https://github.com/AliceLJY/claude-code-studio) | Claude Code 多会话协作平台 |
| cc-empire *(private)* | Claude Code 完整工作流脚手架 |
| [tg-bridge-channel](https://github.com/AliceLJY/tg-bridge-channel) | 姊妹桥接，基于 Claude Agent View 后台 session（channel/pool 引擎） |

## 许可证

MIT
