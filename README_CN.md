# telegram-ai-bridge

[English](README.md) | **简体中文**

这个仓库把 Claude、Codex、Gemini 做成三个独立 Telegram Bot。代码库是同一套，但三个后端的能力并不等价。

## 测试环境

- macOS
- Bun
- 每个后端各自一个 Telegram bot token
- Claude 本地登录状态已就绪
- Codex 本地登录状态已就绪
- Gemini 的 OAuth 凭据已存在于 `~/.gemini/`
- 多实例 LaunchAgent 工作流只在作者自己的机器上实测

## 兼容性说明

- 这个项目是在作者自己的 macOS 多 bot 环境里实测的。
- 辅助启动脚本带有作者自己的绝对路径，其他人必须自行改写。
- 不同后端的能力边界并不相同。
- 这个仓库里的 Gemini 是 API 聊天模式，不是完整 CLI 模式。
- 这个 bridge 从设计上就是 owner-only，用法依赖有效的 `OWNER_TELEGRAM_ID`。

## 后端差异

这三个后端不是同一等级的能力面：

| 后端 | 本仓实现方式 | Session 来源 | 本地工具 / 文件能力 |
|------|--------------|--------------|---------------------|
| Claude | 通过 [`adapters/claude.js`](adapters/claude.js) 走 Agent SDK | `~/.claude/projects/` | 有，通过本地 Claude Code 工具能力 |
| Codex | 通过 [`adapters/codex.js`](adapters/codex.js) 走 Codex SDK | `~/.codex/sessions/` | 有，但 `/sessions` 默认只显示当前 chat 自己可恢复的会话 |
| Gemini | 通过 [`adapters/gemini.js`](adapters/gemini.js) 走 Code Assist API | 会话在内存里，鉴权依赖 `~/.gemini/oauth_creds.json` | 没有与本地 CLI 等价的文件或命令控制能力 |

直接结论：

- Claude 是这里本地工具能力最强的后端。
- Codex 能恢复本地 session，和终端工作流更接近。
- 这里的 Gemini 不是 Gemini CLI，而是 Code Assist API 聊天模式，所以本地文件和命令能力并不等价。

如果你想要 Gemini 更接近 CLI 的形态，请使用 [telegram-cli-bridge](https://github.com/AliceLJY/telegram-cli-bridge)。

## 本地假设

- `CC_CWD` 默认是 `$HOME`
- Session 发现逻辑会读取各家后端自己的本地目录
- SQLite session 数据库是本地的，并且按实例隔离
- `SESSIONS_DB` 控制本地 SQLite 文件路径
- Claude 的 session 发现逻辑读取 `~/.claude/`
- Codex 的 session 发现逻辑读取 `~/.codex/`
- Gemini 的鉴权默认依赖 `~/.gemini/oauth_creds.json`
- 启动脚本是机器专用示例，不是通用脚本

## 已知限制

- 这个项目默认你的本地凭据已经在机器上就绪。
- SQLite session 状态是每个实例自己的本地状态，不是共享的远程 session 服务。
- 三个后端的行为差异很大，不能简单理解成“同一个 bot 换了个模型”。
- 这里的 Gemini 不能被当作本地 CLI 执行能力的等价替代品。
- 自带的 [`start-codex.sh`](start-codex.sh) 和 [`start-gemini.sh`](start-gemini.sh) 都是带硬编码路径的个人示例。

## 架构

```text
Telegram Bot A (.env)        -> bridge.js -> Claude adapter -> Agent SDK
Telegram Bot B (.env.codex)  -> bridge.js -> Codex adapter  -> Codex SDK
Telegram Bot C (.env.gemini) -> bridge.js -> Gemini adapter -> Code Assist API
                                      |
                               SQLite (per-instance DB)
```

每个实例都是一个独立的 `bridge.js` 进程，并且各自拥有：

- 自己的 `.env` 文件
- 自己的 Telegram bot token
- 自己的 `SESSIONS_DB`
- 自己的本地后端凭据

## 前置条件

- Bun 运行时
- 每个后端各自一个 Telegram bot token
- 有效的 `OWNER_TELEGRAM_ID`
- Claude 实例所需的本地 Claude Code 登录
- Codex 实例所需的本地 Codex 登录
- Gemini 实例所需的 OAuth 凭据

## 安装

```bash
git clone https://github.com/AliceLJY/telegram-ai-bridge.git
cd telegram-ai-bridge
bun install
```

为每个后端准备一份 env 文件：

```bash
cp .env.example .env
cp .env.example .env.codex
cp .env.example .env.gemini
```

建议变量：

```env
TELEGRAM_BOT_TOKEN=<bot-token>
OWNER_TELEGRAM_ID=<your-telegram-id>
DEFAULT_BACKEND=claude
CC_CWD=/Users/you
SESSIONS_DB=sessions.db
```

后端各自的真实前提：

- Claude 依赖 `~/.claude/` 下的本地状态
- Codex 依赖 `~/.codex/` 下的本地状态
- Gemini 依赖 `~/.gemini/oauth_creds.json`，以及 `adapters/gemini.js` 使用的 OAuth 变量

## 运行

### 直接运行

```bash
bun bridge.js
./start-codex.sh
./start-gemini.sh
```

### LaunchAgent 工作流

作者机器上的生产实测路径是每个后端实例一个 macOS LaunchAgent。

### Docker

如果你要在 Docker 里跑，请只挂载你所选后端真正需要的本地凭据目录。

## 命令

| 命令 | 说明 |
|------|------|
| `/new` | 重置当前聊天 session |
| `/sessions` | 列出当前 chat 自己可恢复的 session |
| `/sessions all` | 同时查看当前 chat 会话和外部本机会话（外部仅展示，不可直接恢复） |
| `/resume <session-id>` | 把 Telegram 重新绑定到当前 chat 自己的已有 session |
| `/status` | 显示后端、模型、cwd 和当前 session |
| `/verbose 0\|1\|2` | 设置进度输出等级 |

## Session 存储

[`sessions.js`](sessions.js) 通过 `bun:sqlite` 把聊天绑定状态存到 SQLite。

- 数据库文件名由 `SESSIONS_DB` 决定
- 相对路径会解析到当前仓库目录内
- 每个实例都应该使用独立 DB 文件
- Session 持久化是本地的，不是远程的

## 机器专用脚本

[`start-codex.sh`](start-codex.sh) 和 [`start-gemini.sh`](start-gemini.sh) 里写的是作者自己的绝对路径，例如 `/Users/anxianjingya/...` 和固定 Bun 路径。应把它们视为个人示例，而不是可直接复用的通用启动脚本。

## 作者

作者是 **小试AI** ([@AliceLJY](https://github.com/AliceLJY))。

## License

MIT
