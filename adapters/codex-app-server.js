import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

function writeMessage(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function rejectUnsupportedServerRequest(child, message) {
  if (message.id == null || !message.method) return false;
  writeMessage(child, {
    id: message.id,
    error: {
      code: -32601,
      message: `${message.method} is not supported by the Telegram bridge`,
    },
  });
  return true;
}

function normalizeItem(item = {}) {
  const typeMap = {
    agentMessage: "agent_message",
    commandExecution: "command_execution",
    fileChange: "file_change",
    mcpToolCall: "mcp_tool_call",
    webSearch: "web_search",
    todoList: "todo_list",
  };
  return { ...item, type: typeMap[item.type] || item.type };
}

function getNotificationScope(message = {}) {
  const params = message.params || {};
  return {
    threadId: params.threadId || params.thread?.id || null,
    turnId: params.turnId || params.turn?.id || null,
  };
}

function mappedNotificationScope(message) {
  const { threadId, turnId } = getNotificationScope(message);
  return {
    ...(threadId ? { thread_id: threadId } : {}),
    ...(turnId ? { turn_id: turnId } : {}),
  };
}

export function isExpectedAppServerTurn(message, expectedThreadId, expectedTurnId) {
  const method = message?.method || "";
  const { threadId, turnId } = getNotificationScope(message);

  // Item/turn notifications are multiplexed across parent and sub-agent threads
  // on one app-server connection. Fail closed unless both provenance fields match.
  if (method === "item/completed" || method === "turn/completed") {
    return threadId === expectedThreadId && turnId === expectedTurnId;
  }

  // Connection-level errors may have no provenance. Scoped errors must match.
  if (method === "error") {
    if (threadId && threadId !== expectedThreadId) return false;
    if (turnId && turnId !== expectedTurnId) return false;
  }

  return true;
}

function createAbortError(message = "Codex turn aborted") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function mapAppServerNotification(message) {
  const { method, params = {} } = message;

  if (method === "thread/started") {
    return {
      type: "thread.started",
      thread_id: params.thread?.id,
    };
  }
  if (method === "item/completed") {
    if (params.item?.type === "userMessage") return null;
    return {
      type: "item.completed",
      ...mappedNotificationScope(message),
      item: normalizeItem(params.item),
    };
  }
  if (method === "turn/completed") {
    if (params.turn?.status === "failed") {
      return {
        type: "turn.failed",
        ...mappedNotificationScope(message),
        error: params.turn.error,
      };
    }
    if (["interrupted", "cancelled", "canceled"].includes(params.turn?.status)) {
      return {
        type: "turn.interrupted",
        ...mappedNotificationScope(message),
      };
    }
    return {
      type: "turn.completed",
      ...mappedNotificationScope(message),
      status: params.turn?.status || "completed",
    };
  }
  if (method === "error") {
    return {
      type: "error",
      ...mappedNotificationScope(message),
      message: params.error?.message || params.message || "Codex app-server error",
    };
  }
  return null;
}

export async function* streamAppServerEvents({
  codexPath,
  prompt,
  sessionId,
  cwd,
  model,
  effort,
  serviceTier,
  abortSignal,
  spawnProcess = spawn,
}) {
  const child = spawnProcess(codexPath, ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  let stderr = "";
  let spawnError = null;
  let nextId = 1;
  let aborted = abortSignal?.aborted === true;

  child.on("error", error => {
    spawnError = error;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => {
    stderr = `${stderr}${chunk}`.slice(-8000);
  });

  const abort = () => {
    aborted = true;
    child.kill("SIGTERM");
  };
  if (abortSignal) {
    if (abortSignal.aborted) abort();
    else abortSignal.addEventListener("abort", abort, { once: true });
  }

  async function request(method, params) {
    const id = nextId++;
    writeMessage(child, { id, method, params });
    while (true) {
      const { value, done } = await iterator.next();
      if (done) {
        if (aborted) throw createAbortError();
        throw new Error(spawnError?.message || stderr.trim() || `Codex app-server exited before ${method} responded`);
      }
      const message = JSON.parse(value);
      if (rejectUnsupportedServerRequest(child, message)) continue;
      if (message.id !== id) continue;
      if (message.error) throw new Error(message.error.message || JSON.stringify(message.error));
      return message.result;
    }
  }

  try {
    await request("initialize", {
      clientInfo: {
        name: "telegram-ai-bridge",
        title: "Telegram AI Bridge",
        version: "5.1.1",
      },
      capabilities: {},
    });
    writeMessage(child, { method: "initialized", params: {} });

    const threadParams = { cwd, approvalPolicy: "never" };
    if (model) threadParams.model = model;
    if (serviceTier) threadParams.serviceTier = serviceTier;

    const threadResult = sessionId
      ? await request("thread/resume", { threadId: sessionId, ...threadParams })
      : await request("thread/start", { ...threadParams, threadSource: "telegram_ai_bridge" });
    const thread = threadResult.thread;
    if (!thread?.id) throw new Error("Codex app-server did not return a thread id");

    yield {
      event: { type: "thread.started", thread_id: thread.id },
      thread,
    };

    const turnParams = {
      threadId: thread.id,
      input: [{ type: "text", text: prompt }],
    };
    if (model) turnParams.model = model;
    if (effort) turnParams.effort = effort;
    if (serviceTier) turnParams.serviceTier = serviceTier;
    const turnResult = await request("turn/start", turnParams);
    const turnId = turnResult?.turn?.id;
    if (!turnId) throw new Error("Codex app-server did not return a turn id");

    const ignoredTurns = new Set();

    for await (const line of iterator) {
      if (aborted || abortSignal?.aborted) throw createAbortError();
      const message = JSON.parse(line);
      if (rejectUnsupportedServerRequest(child, message)) continue;
      if (!isExpectedAppServerTurn(message, thread.id, turnId)) {
        const scope = getNotificationScope(message);
        const key = `${scope.threadId || "unknown"}:${scope.turnId || "unknown"}`;
        if (!ignoredTurns.has(key)) {
          ignoredTurns.add(key);
          console.warn(
            `[Codex app-server] ignored off-turn notification thread=${scope.threadId || "unknown"} turn=${scope.turnId || "unknown"} expected=${thread.id}:${turnId}`,
          );
        }
        continue;
      }
      const event = mapAppServerNotification(message);
      if (!event || event.type === "thread.started") continue;
      if (event.type === "turn.interrupted") throw createAbortError("Codex turn interrupted");
      yield { event, thread };
      if (event.type === "turn.completed" || event.type === "turn.failed") return;
    }

    if (aborted || abortSignal?.aborted) throw createAbortError();
    throw new Error(stderr.trim() || "Codex app-server exited before the turn completed");
  } catch (error) {
    if (aborted || abortSignal?.aborted) throw createAbortError();
    throw error;
  } finally {
    if (abortSignal) abortSignal.removeEventListener("abort", abort);
    lines.close();
    if (child.exitCode == null && !child.killed) {
      child.stdin.end();
      await Promise.race([
        once(child, "exit"),
        new Promise(resolve => setTimeout(resolve, 2000)),
      ]);
      if (child.exitCode == null) child.kill("SIGTERM");
    }
  }
}
