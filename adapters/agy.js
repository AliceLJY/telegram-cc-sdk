// Antigravity CLI (`agy`) 适配器 —— Google Gemini 系模型
//
// ⚠️ 凭证存在 macOS keychain（svce=gemini / acct=antigravity），不是文件：
//   ✅ launchd 的 gui/<uid> domain 能解开 → bridge 由 launchd 拉起，实测可用
//      （2026-07-30 两机各装临时 launchd 探针跑 canary，均 AGY_EXIT=0）
//   ❌ ssh 非交互解不开 → 报 "You are not logged into Antigravity" 后转交互 OAuth 并超时
//   → 排障时别用 `ssh mini 'agy -p ...'` 判断死活，那必然红灯且与 bridge 实际处境无关。
//      要么装个临时 launchd job，要么 `ssh -t` 带伪终端。
//
// 二进制名是 agy 而不是 antigravity（brew: Linking Binary 'antigravity' to '.../agy'）。
// `gemini` CLI 已合并进 agy，不再单独存在——本仓另有一个 gemini backend，那是直连
// Code Assist API 的实现，和这里走 CLI 的路径无关，别混。

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { createCliAgentAdapter } from "./cli-agent.js";

// agy 每个 conversation 落一个 sqlite：~/.gemini/antigravity-cli/conversations/<uuid>.db
const CONV_DIR = join(process.env.HOME || "", ".gemini", "antigravity-cli", "conversations");
// agy 只认 low|medium|high。这里要挡的是 config 里沿用 codex 的 "ultra"——传过去会被 CLI 拒。
const AGY_EFFORTS = ["low", "medium", "high"];

// agy 的模型 id 自带档位后缀（-high / -medium / -low），CLI 会校验它与 --effort 是否一致，
// 不一致就整轮拒掉：
//   invalid model selection (--model "gemini-3.1-pro-high" --effort "low"):
//   --model gemini-3.1-pro-high conflicts with --effort=low        （2026-07-30 实测）
// 而本 adapter 的 models 菜单里同时摆着 pro-high / pro-low / flash-medium 等多个档位，
// defaultEffort 又固定是 high——用户用 /model 切到任何非 high 档，effort 还停在 high 上，
// 下一句话必然撞这个冲突。所以档位以 model id 自带的后缀为准（它更具体、且是 CLI 的校验基准），
// 只有 model 没带档位后缀时才采用显式 effort。
export function resolveAgyEffort(model, effort) {
  const fromModel = AGY_EFFORTS.find((e) => typeof model === "string" && model.endsWith(`-${e}`));
  if (fromModel) return fromModel;
  return effort && AGY_EFFORTS.includes(effort) ? effort : null;
}

// agy 的 result JSON 除 status 外还带一个 error 字段（实测），早期版本只取 status，于是 TG 侧
// 永远只看到光秃秃的 "agy status=ERROR"，真因全丢——而真因恰恰都在 error 里，实测见过三类：
//   · "Encountered retryable error from model provider: There was a network issue..."（长会话高发）
//   · "invalid model selection (--model X --effort Y): ... conflicts with ..."（参数打架）
//   · 配额 / 登录态类
// 另有一种实测形态：status=ERROR 但 response 非空——模型其实答完了，只是中途撞过一次 retryable
// 错误没自愈，agy 就把整个 result 标 ERROR。旧逻辑走 success=false 分支，cli-agent 会丢掉
// finalResult.text，用户白等一场还什么都拿不到。这里按"有正文就算部分成功"处理，正文照给，
// 顶部贴一行 agy 自己的错误原话，让人自己判断这轮可不可信。
export function normalizeAgyResult(r = {}) {
  const status = r.status || "(未知)";
  const text = r.response || "";
  const detail = r.error ? `\n${r.error}` : "";
  const sessionId = r.conversation_id || null;

  if (status === "SUCCESS") {
    return { success: true, text, sessionId, error: null };
  }
  if (text.trim()) {
    return {
      success: true,
      text: `⚠️ agy status=${status}（正文已生成，但这轮报过错，内容可能不完整）${detail}\n\n---\n\n${text}`,
      sessionId,
      error: null,
    };
  }
  return { success: false, text: "", sessionId, error: `agy status=${status}${detail}` };
}

export function createAdapter(config = {}) {
  return createCliAgentAdapter(
    {
      name: "agy",
      label: "Agy",
      icon: "🟠",
      // Resolve at adapter creation rather than module import. Bun may share the
      // ESM module cache across test files, and runtime callers may inject a
      // canary binary without depending on import order.
      bin: config.bin || process.env.AGY_BIN || "/opt/homebrew/bin/agy",
      defaultModel: process.env.AGY_MODEL || "gemini-3.8-flash-high",
      defaultEffort: "high",
      modeLabel: "Antigravity CLI (Gemini)",

      // 只列 Gemini 系。Antigravity 里也能选 claude-*，但这个 bot 的全部意义就是提供一个
      // 非 Claude 的引擎；把同源模型摆进菜单只会让人误选成回音。
      //
      // 菜单以 `agy models` 的实时输出为准——CLI 会下线旧模型，菜单里留着的就成了死选项：
      // 2026-09-03 校对时 gemini-3.5-flash-high 已从 CLI 消失，选中即被拒。改这里之前先跑一次
      // `agy models` 对一遍，别照着记忆写。
      models: [
        { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
        { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
        { id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
        { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)" },
        { id: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
      ],

      // agy 支持逐次指定 --effort（low|medium|high），所以给出真实档位
      efforts: [
        { id: "__default__", label: "默认 (high)", description: "跟随 adapter 默认档" },
        { id: "low", label: "Low", description: "轻量思考，最快" },
        { id: "medium", label: "Medium", description: "中等思考深度" },
        { id: "high", label: "High", description: "深度思考，最慢" },
      ],

      // 轻量会话枚举：只列 conversation 文件 + mtime，不打开 .db。
      // 内部表是 trajectory_meta / steps / *_blob，step_payload 是 blob——解析它才能拿到
      // "首条消息"当标题，但那是 agy 内部格式，升级即碎，故按 YAGNI 不做。
      enumerateSessions(limit = 10) {
        let files;
        try {
          files = readdirSync(CONV_DIR).filter((f) => f.endsWith(".db"));
        } catch {
          return [];
        }
        const rows = [];
        for (const f of files) {
          try {
            const st = statSync(join(CONV_DIR, f));
            const id = f.replace(/\.db$/, "");
            rows.push({
              session_id: id,
              display_name: `agy 会话 ${id.slice(0, 8)}`,
              last_active: st.mtimeMs,
            });
          } catch {
            /* 单个文件读不到就跳过，不影响其余 */
          }
        }
        rows.sort((a, b) => b.last_active - a.last_active);
        return rows.slice(0, Math.max(limit, 1));
      },

      buildArgs({ prompt, sessionId, model, effort, timeoutMs }) {
        // stream-json 而非 json：走 cli-agent 的流式路径，边生成边往 TG 推（体验同 CC）。
        const args = ["-p", prompt, "--output-format", "stream-json"];
        args.push("--print-timeout", "3600s"); // 打破十分钟天花板
        if (sessionId) args.push("--conversation", sessionId);
        if (model) args.push("--model", model);
        const eff = resolveAgyEffort(model, effort);
        if (eff) args.push("--effort", eff);
        return args;
      },

      // 流式解析：agy stream-json 每行一个 JSON 事件（实测结构）：
      //   {"event":"init", "init":{cwd,tools,permission_mode}}                      ← 无 conv_id
      //   {"event":"step_update","step_update":{conversation_id, step_index, state,
      //       step_type, text_delta?, ...}}   ← step_type=="agent_response" 且带 text_delta 才是正文增量
      //   {"event":"result","result":{conversation_id, status, response, ...}}      ← 收尾，response=完整
      // text_delta 已逐字节验证是增量 delta（全部拼接 == result.response）。
      streamParse(line) {
        if (!line.startsWith("{")) return null;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          return null;
        }
        const ev = o.event;
        if (ev === "step_update") {
          const su = o.step_update || {};
          const out = { sessionId: su.conversation_id || null };
          // 只有 agent_response 的 text_delta 是给用户看的正文
          if (su.step_type === "agent_response" && typeof su.text_delta === "string" && su.text_delta) {
            out.kind = "text";
            out.delta = su.text_delta;
          } else if (su.step_type === "tool" && su.state === "ACTIVE" && su.tool_name) {
            out.kind = "progress";
            out.toolName = su.tool_name;
            out.detail = `正在执行: ${su.tool_name}`;
          }
          return out;
        }
        if (ev === "result") {
          return { kind: "result", ...normalizeAgyResult(o.result) };
        }
        if (ev === "init") {
          const init = o.init || {};
          // init 事件不带 conversation_id（实测），无正文，纯忽略
          return init.conversation_id ? { sessionId: init.conversation_id } : null;
        }
        return null;
      },

      // 一次性 json 解析：保留给非流式 fallback / 手动调用（当前 streamParse 存在则不走这里）。
      // {"conversation_id":"...","status":"SUCCESS","response":"...","duration_seconds":5.8,...}
      parseResult({ stdout, stderr, code }) {
        const trimmed = stdout.trim();
        // 保险：agy 偶尔在 JSON 前打日志行，从后往前找第一个 { 开头的行
        const jsonLine = trimmed.startsWith("{")
          ? trimmed
          : trimmed
              .split("\n")
              .reverse()
              .find((line) => line.trim().startsWith("{"));

        if (!jsonLine) {
          return {
            success: false,
            error:
              `agy 未返回 JSON (exit=${code})\n` +
              `${(stderr || stdout).slice(0, 400) || "(无输出)"}`,
          };
        }

        return normalizeAgyResult(JSON.parse(jsonLine));
      },
    },
    config
  );
}
