// Claude Agent SDK 适配器
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, statSync, createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";

export function createAdapter(config = {}) {
  const model = config.model || process.env.CC_MODEL || "claude-sonnet-4-6";
  const cwd = config.cwd || process.env.CC_CWD || process.env.HOME;

  return {
    name: "claude",
    label: "CC",
    icon: "🟣",

    async *streamQuery(prompt, sessionId, abortSignal) {
      const options = {
        model,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd,
      };

      if (sessionId) {
        options.resume = sessionId;
      } else {
        options.settingSources = ["user", "project"];
      }

      // Claude SDK 需要 AbortController 对象，bridge 传来的是 AbortSignal
      const abortController = new AbortController();
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => abortController.abort(), { once: true });
      }

      for await (const msg of query({
        prompt,
        options: { ...options, abortController },
      })) {
        // 捕获 session ID
        if (msg.type === "system" && msg.subtype === "init") {
          yield { type: "session_init", sessionId: msg.session_id };
        }

        // 助手消息 → 进度事件（工具调用 + 文本）
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "tool_use") {
              yield {
                type: "progress",
                toolName: block.name,
                input: block.input,
              };
            } else if (block.type === "text" && block.text) {
              yield { type: "text", text: block.text };
            }
          }
        }

        // 最终结果
        if (msg.type === "result") {
          yield {
            type: "result",
            success: msg.subtype === "success",
            text: msg.subtype === "success" ? (msg.result || "") : (msg.errors || []).join("\n"),
            cost: msg.total_cost_usd,
            duration: msg.duration_ms,
          };
        }
      }
    },

    statusInfo() {
      return { model, cwd, mode: "Agent SDK direct" };
    },

    async listSessions(limit = 10) {
      const projectsDir = join(process.env.HOME, ".claude", "projects");
      const allFiles = [];

      try {
        const dirs = readdirSync(projectsDir).filter(d => {
          try { return statSync(join(projectsDir, d)).isDirectory(); } catch { return false; }
        });
        for (const dir of dirs) {
          const fullDir = join(projectsDir, dir);
          try {
            const files = readdirSync(fullDir)
              .filter(f => f.endsWith(".jsonl"))
              .map(f => {
                const fp = join(fullDir, f);
                const stat = statSync(fp);
                return { file: f, path: fp, mtime: stat.mtimeMs, size: stat.size };
              });
            allFiles.push(...files);
          } catch { /* skip */ }
        }
      } catch { return []; }

      allFiles.sort((a, b) => b.mtime - a.mtime);
      const recent = allFiles.slice(0, limit);

      const results = [];
      for (const s of recent) {
        let topic = "";
        try {
          const stream = createReadStream(s.path, { encoding: "utf8" });
          const rl = createInterface({ input: stream });
          for await (const line of rl) {
            try {
              const d = JSON.parse(line);
              if (d.message?.role === "user") {
                const content = d.message.content;
                if (Array.isArray(content)) {
                  const txt = content.find(c => typeof c === "object" && c.type === "text");
                  if (txt) topic = txt.text.slice(0, 80);
                } else if (typeof content === "string") {
                  topic = content.slice(0, 80);
                }
                if (topic && !topic.startsWith("[Request interrupted")) break;
                topic = "";
              }
            } catch { /* skip */ }
          }
          rl.close();
          stream.destroy();
        } catch { /* skip */ }

        results.push({
          session_id: s.file.replace(".jsonl", ""),
          display_name: topic || "(空)",
          last_active: s.mtime,
          backend: "claude",
        });
      }
      return results;
    },
  };
}
