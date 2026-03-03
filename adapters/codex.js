// Codex SDK 适配器
// @openai/codex-sdk — CLI wrapper，sessions 存 ~/.codex/sessions/
// codex --resume <threadId> 终端可直接接续

let Codex;
try {
  ({ Codex } = await import("@openai/codex-sdk"));
} catch {
  // SDK 未安装时给出友好提示，不阻塞 Claude 后端
  Codex = null;
}

export function createAdapter(config = {}) {
  const model = config.model || process.env.CODEX_MODEL || "";
  const cwd = config.cwd || process.env.CC_CWD || process.env.HOME;

  let codex = null;

  function ensureSDK() {
    if (!Codex) {
      throw new Error("@openai/codex-sdk not installed. Run: bun add @openai/codex-sdk");
    }
    if (!codex) {
      const opts = {};
      if (model) {
        opts.config = { model };
      }
      codex = new Codex(opts);
    }
    return codex;
  }

  return {
    name: "codex",
    label: "Codex",
    icon: "🟢",

    async *streamQuery(prompt, sessionId, abortSignal) {
      const sdk = ensureSDK();

      const thread = sessionId
        ? sdk.resumeThread(sessionId)
        : sdk.startThread({ workingDirectory: cwd, skipGitRepoCheck: true });

      // runStreamed 支持 signal 取消
      const turnOpts = abortSignal ? { signal: abortSignal } : {};
      const { events } = await thread.runStreamed(prompt, turnOpts);

      let yieldedInit = false;
      let lastAgentMessage = ""; // 累积最后的 agent_message 文本

      for await (const event of events) {
        // thread.started 事件包含 thread_id
        if (event.type === "thread.started") {
          yield { type: "session_init", sessionId: event.thread_id };
          yieldedInit = true;
        }

        // 首次拿到 thread.id 时兜底发 session_init
        if (!yieldedInit && thread.id) {
          yield { type: "session_init", sessionId: thread.id };
          yieldedInit = true;
        }

        if (event.type === "item.completed") {
          const item = event.item;
          // agent_message 是最终回复文本，累积它
          if (item.type === "agent_message") {
            lastAgentMessage = item.text || "";
          }
          yield {
            type: "progress",
            toolName: summarizeItemName(item),
            detail: summarizeItemDetail(item),
          };
        }

        if (event.type === "turn.completed") {
          // turn.completed 只有 usage，最终文本从 agent_message 累积
          yield {
            type: "result",
            success: true,
            text: lastAgentMessage,
            cost: null,
            duration: null,
          };
        }

        if (event.type === "turn.failed") {
          yield {
            type: "result",
            success: false,
            text: event.error?.message || "Codex turn failed",
            cost: null,
            duration: null,
          };
        }

        if (event.type === "error") {
          yield {
            type: "result",
            success: false,
            text: event.error?.message || "Codex stream error",
            cost: null,
            duration: null,
          };
        }
      }

      // 安全兜底：如果 events 全部消费完但没发过 session_init
      if (!yieldedInit && thread.id) {
        yield { type: "session_init", sessionId: thread.id };
      }
    },

    statusInfo() {
      return {
        model: model || "(default)",
        cwd,
        mode: "Codex SDK direct",
      };
    },
  };
}

// Codex ThreadItem types:
// agent_message, reasoning, command_execution, file_change, mcp_tool_call, web_search, todo_list, error
function summarizeItemName(item) {
  if (!item) return "action";
  switch (item.type) {
    case "command_execution": return "Bash";
    case "file_change": return "Edit";
    case "mcp_tool_call": return item.tool || "MCP";
    case "web_search": return "WebSearch";
    case "agent_message": return "message";
    case "reasoning": return "reasoning";
    case "todo_list": return "todo";
    case "error": return "error";
    default: return item.type || "action";
  }
}

function summarizeItemDetail(item) {
  if (!item) return "";
  switch (item.type) {
    case "command_execution": return (item.command || "").slice(0, 60);
    case "file_change": return (item.changes || []).map((c) => c.path).join(", ").slice(0, 60);
    case "mcp_tool_call": return `${item.server}/${item.tool}`;
    case "web_search": return (item.query || "").slice(0, 60);
    case "agent_message": return (item.text || "").slice(0, 60);
    case "reasoning": return (item.text || "").slice(0, 60);
    default: return "";
  }
}
