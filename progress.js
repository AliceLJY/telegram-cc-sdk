// 实时进度显示模块

// 工具图标映射
const TOOL_ICONS = {
  Read: "📖",
  Write: "✍️",
  Edit: "✏️",
  Bash: "💻",
  Glob: "🔍",
  Grep: "🔎",
  WebFetch: "🌐",
  WebSearch: "🔍",
  Agent: "🤖",
  NotebookEdit: "📓",
  TodoWrite: "📝",
  TaskCreate: "📋",
  TaskUpdate: "📋",
  TaskList: "📋",
  TaskGet: "📋",
  AskUserQuestion: "❓",
};

const SILENT_TOOLS = new Set([
  "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet",
]);

const MAX_ENTRIES = 15;
const EDIT_THROTTLE_MS = 2000;

export function createProgressTracker(ctx, chatId, verboseLevel = 1) {
  let progressMsgId = null;
  let typingInterval = null;
  let entries = [];
  let lastEditTime = 0;
  let editTimer = null;
  let finished = false;

  async function start() {
    try {
      const msg = await ctx.api.sendMessage(chatId, "⏳ CC 正在处理...");
      progressMsgId = msg.message_id;
    } catch {
      // 发送失败不影响主流程
    }

    // Typing 心跳（每 4 秒发一次，Telegram typing 持续 5 秒）
    typingInterval = setInterval(() => {
      ctx.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
    // 立刻发一次
    ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  }

  function processMessage(msg) {
    if (finished || verboseLevel === 0) return;
    if (msg.type !== "assistant" || !msg.message?.content) return;

    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        if (SILENT_TOOLS.has(block.name)) continue;
        const icon = TOOL_ICONS[block.name] || "🔧";

        if (verboseLevel >= 2) {
          const input = typeof block.input === "object"
            ? (block.input.command || block.input.file_path || block.input.description || block.input.pattern || block.input.query || "").slice(0, 60)
            : "";
          entries.push(`${icon} ${block.name}${input ? ": " + input : ""}`);
        } else {
          entries.push(`${icon} ${block.name}`);
        }
      } else if (block.type === "text" && block.text && verboseLevel >= 2) {
        // 推理片段：取前 80 字符
        const snippet = block.text.slice(0, 80).replace(/\n/g, " ");
        if (snippet.trim()) {
          entries.push(`💭 ${snippet}${block.text.length > 80 ? "..." : ""}`);
        }
      }
    }

    // 保留最近 MAX_ENTRIES 条
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(-MAX_ENTRIES);
    }

    scheduleEdit();
  }

  function scheduleEdit() {
    if (!progressMsgId || finished) return;
    const now = Date.now();
    const timeSinceLastEdit = now - lastEditTime;

    if (timeSinceLastEdit >= EDIT_THROTTLE_MS) {
      doEdit();
    } else if (!editTimer) {
      editTimer = setTimeout(() => {
        editTimer = null;
        if (!finished) doEdit();
      }, EDIT_THROTTLE_MS - timeSinceLastEdit);
    }
  }

  function doEdit() {
    if (!progressMsgId || finished) return;
    lastEditTime = Date.now();

    const text = entries.length > 0
      ? `⏳ CC 正在处理...\n\n${entries.join("\n")}`
      : "⏳ CC 正在处理...";

    ctx.api.editMessageText(chatId, progressMsgId, text).catch(() => {});
  }

  async function finish() {
    finished = true;

    if (editTimer) {
      clearTimeout(editTimer);
      editTimer = null;
    }
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
    if (progressMsgId) {
      await ctx.api.deleteMessage(chatId, progressMsgId).catch(() => {});
      progressMsgId = null;
    }
  }

  return { start, processMessage, finish };
}
