import { basename } from "path";

export function registerCommands(bot, deps) {
  const {
    ACTIVE_BACKENDS,
    AVAILABLE_BACKENDS,
    CC_CWD,
    DEFAULT_EFFORT,
    DEFAULT_VERBOSE,
    DISCUSS_CHAT_IDS,
    HISTORY_BOTS,
    InlineKeyboard,
    a2aBus,
    adapters,
    buildResumeHint,
    buildDiscussCommandResult,
    buildSessionButtonLabel,
    chatAbortControllers,
    chatPermState,
    cronManager,
    deleteChatEffort,
    deleteChatModel,
    deleteSession,
    dirManager,
    executor,
    flushGate,
    formatSessionIdShort,
    formatTaskStatus,
    getActiveTask,
    getAdapter,
    getBackendName,
    getBackendStatusNote,
    getChatEffort,
    getChatModel,
    getExternalSessionsForChat,
    getDiscussTurnState,
    getOwnedSessionsForChat,
    getPermState,
    getSession,
    getSessionTypeState,
    getSessionProjectLabel,
    getSessionSourceLabel,
    idleMonitor,
    lastSessionList,
    markTaskApproved,
    markTaskRejected,
    mergeSessionsForPicker,
    pendingPermissions,
    rateLimiter,
    readSharedMessages,
    recentTasks,
    runHealthCheck,
    sendLong,
    sendSessionPeek,
    sessionBelongsToChat,
    setChatEffort,
    setChatModel,
    setSession,
    setSessionType,
    sharedContextConfig,
    sortSessionsForDisplay,
    submitAndWait,
    tgSendDocument,
    verboseSettings,
  } = deps;

  function getEffectiveSession(chatId) {
    const session = getSession(chatId);
    const sessionTypeState = typeof getSessionTypeState === "function"
      ? getSessionTypeState(chatId)
      : { sessionType: session?.session_type || "normal", explicit: false };
    return session
      ? {
        ...session,
        session_type: sessionTypeState.sessionType,
        session_type_explicit: sessionTypeState.explicit,
      }
      : {
        session_type: sessionTypeState.sessionType,
        session_type_explicit: sessionTypeState.explicit,
      };
  }

  // 副 bot 不暴露 /sessions /resume —— 强制走主力 bot 看完整聊天记录
  // owner 通过 plist env BRIDGE_OWNER=true 标记
  const IS_OWNER = process.env.BRIDGE_OWNER === "true";
  // 指路文案从 config.shared.historyBots 读（backend → 主力 bot 用户名），源码里不写死任何实例名；
  // 没配置时只说「另一个 bot」。只该填真正带 BRIDGE_OWNER=true 的实例——副 bot 自己也没有 /sessions，指过去没用。
  const HISTORY_BOT_LABELS = { claude: "Claude", codex: "Codex", gemini: "Gemini", agy: "Agy", kimi: "Kimi" };
  const configuredHistoryBots = Object.entries(HISTORY_BOTS || {})
    .filter(([, name]) => typeof name === "string" && name.trim());
  const historyBotLines = configuredHistoryBots.length > 0
    ? configuredHistoryBots.map(([backend, name]) => `· ${HISTORY_BOT_LABELS[backend] || backend} 历史 → ${name.trim()}`)
    : ["· 历史会话 → 另一个 bot（主力 bot；可在 config.shared.historyBots 里填它的用户名）"];
  const NON_OWNER_SESSIONS_HINT =
    "📋 /sessions 和 /resume 仅在主力 bot 启用。\n" +
    historyBotLines.join("\n") + "\n" +
    "· agy 暂无会话浏览（adapter 未实现 listSessions）";

  // 取消某个 chat 所有挂起的工具审批：cleanup timeout + 标记 rejected + resolve deny + 删除。
  // 与 perm 回调的 deny 分支同构，供 /new、/cancel、Stop 复用——abort 不会让等待中的审批 Promise 自行结束，
  // 不清就会留下悬挂 Promise、未触发的 5 分钟超时、以及点了无效的旧审批按钮。
  function cancelPendingPermsForChat(chatId, reason = "会话已重置") {
    let count = 0;
    for (const [permId, pending] of pendingPermissions) {
      if (pending.chatId !== chatId) continue;
      pendingPermissions.delete(permId);
      pending.cleanup();
      if (pending.taskId) markTaskRejected(pending.taskId, pending.toolName);
      pending.resolve({ behavior: "deny", message: reason, toolUseID: pending.toolUseID });
      count++;
    }
    return count;
  }

  // ── /help 命令 ──
  bot.command("help", async (ctx) => {
    const adapter = getAdapter(ctx.chat.id);
    const backendName = getBackendName(ctx.chat.id);
    const text = [
      `*Telegram AI Bridge* — ${adapter.icon} ${adapter.label}`,
      "",
      "📋 *会话管理*",
      "/new — 开启新会话（停当前任务+清排队）",
      "/cancel — 停止当前任务（保留会话）",
      "/sessions — 查看/切换会话",
      "/resume <id> — 恢复指定会话",
      "/peek \\[n] — 查看会话最后 n 条",
      "",
      "⚙️ *设置*",
      "/model — 切换模型",
      "/effort — 切换思考深度",
      "/dir — 切换工作目录",
      "/verbose \\[0-2] — 输出详细度",
      "/discuss status|on|off — 控制群聊 Discuss 模式",
      "",
      "📊 *状态*",
      "/status — 当前状态",
      "/doctor — 健康检查",
      "/tasks — 任务队列",
      "/a2a — A2A 跨 bot 状态",
      "/export — 导出群聊上下文为 Markdown 文件",
      "",
      "⏰ *定时*",
      "/cron — 定时任务管理",
      "",
      "💡 *使用技巧*",
      "• 直接发文字/图片/文件/语音，自动转发给 AI",
      "• 回复 bot 消息可追加上下文",
      `• 当前后端: ${backendName}`,
    ].join("\n");
    await ctx.reply(text, { parse_mode: "Markdown" }).catch(() => {
      ctx.reply(text.replace(/[*\\]/g, "")).catch(() => {});
    });
  });

  // ── /discuss 命令：控制当前群聊 session 的 Discuss 模式 ──
  bot.command("discuss", async (ctx) => {
    const session = getEffectiveSession(ctx.chat.id);
    const result = buildDiscussCommandResult({
      arg: ctx.match,
      chat: ctx.chat,
      from: ctx.from,
      ownerId: deps.OWNER_ID,
      session,
      discussChatIds: DISCUSS_CHAT_IDS,
    });

    if (result.ignored) return;

    if (result.nextSessionType) {
      const changed = setSessionType(ctx.chat.id, result.nextSessionType);
      if (!changed) {
        await ctx.reply("会话状态未更新：当前会话不存在或已过期。");
        return;
      }
    }

    await ctx.reply(result.replyText);
  });

  // ── 按钮回调：Stop（一键停止） ──
  bot.callbackQuery("stop", async (ctx) => {
    const chatId = ctx.chat.id;
    const controller = chatAbortControllers.get(chatId);
    cancelPendingPermsForChat(chatId, "已停止");
    if (controller) {
      controller.abort();
      chatAbortControllers.delete(chatId);
      await ctx.answerCallbackQuery({ text: "⏹ 已停止" });
      // 移除按钮，保留当前消息文本
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    } else {
      await ctx.answerCallbackQuery({ text: "没有运行中的任务" });
    }
  });

  // ── 按钮回调：取消排队消息 ──
  bot.callbackQuery("queue:clear", async (ctx) => {
    const chatId = ctx.chat.id;
    const cleared = flushGate.clearBuffer(chatId);
    if (cleared > 0) {
      await ctx.answerCallbackQuery({ text: `🗑 已取消 ${cleared} 条排队消息` });
      await ctx.editMessageText(`🗑 已取消 ${cleared} 条排队消息。`).catch(() => {});
    } else {
      await ctx.answerCallbackQuery({ text: "队列已空" });
    }
  });

  // ── /new 命令：硬重置会话（停当前任务 + 清排队 + 解绑映射） ──
  bot.command("new", async (ctx) => {
    const chatId = ctx.chat.id;
    // 1) 停掉正在跑的任务：写回保护是兜底，这里主动 abort 更干净、也省掉无谓算力
    const controller = chatAbortControllers.get(chatId);
    if (controller) {
      controller.abort();
      chatAbortControllers.delete(chatId);
    }
    // 2) 取消挂起的工具审批（abort 不会让等待中的审批 Promise 自行结束）
    cancelPendingPermsForChat(chatId, "会话已重置");
    // 3) 清掉还没处理的排队消息，避免旧排队消息灌进新会话
    const cleared = flushGate.clearBuffer(chatId);
    // 3) 解绑会话映射（deleteSession 内部记 sessionResetAt，挡住在途旧 turn 的写回）
    deleteSession(chatId, "/new-command");
    chatPermState.delete(chatId);
    const adapter = getAdapter(chatId);
    const extra = cleared > 0 ? `，已清理 ${cleared} 条排队消息` : "";
    await ctx.reply(`会话已重置${extra}，下条消息将开启新 ${adapter.label} 会话。`);
  });

  // ── /cancel 命令：只停当前任务，不动会话映射（停下手头这个、接着聊） ──
  bot.command("cancel", async (ctx) => {
    const chatId = ctx.chat.id;
    const controller = chatAbortControllers.get(chatId);
    cancelPendingPermsForChat(chatId, "已停止");
    if (controller) {
      controller.abort();
      chatAbortControllers.delete(chatId);
      await ctx.reply("⏹ 已停止当前任务，会话保留，可继续发消息。");
    } else {
      await ctx.reply("当前没有运行中的任务。");
    }
  });

  // ── /resume 命令：显式绑定已有 session id（适合终端/TG 手动接续） ──
  bot.command("resume", async (ctx) => {
    if (!IS_OWNER) {
      await ctx.reply(NON_OWNER_SESSIONS_HINT);
      return;
    }
    let sessionId = ctx.match?.trim();
    if (!sessionId) {
      const backendName = getBackendName(ctx.chat.id);
      await ctx.reply(`用法: /resume <序号或ID>\n先 /sessions 查看列表，再 /resume 3 恢复第3条。`);
      return;
    }

    // 支持序号：/resume 3 → 从上次 /sessions 列表取第3条
    const num = parseInt(sessionId, 10);
    if (!isNaN(num) && num >= 1 && String(num) === sessionId) {
      const cached = lastSessionList.get(ctx.chat.id);
      if (cached && num <= cached.length) {
        sessionId = cached[num - 1].session_id;
      } else {
        await ctx.reply(`序号 ${num} 无效，请先 /sessions 查看列表。`);
        return;
      }
    }

    const backend = getBackendName(ctx.chat.id);
    const adapter = getAdapter(ctx.chat.id);
    const adapterInfo = adapter.statusInfo(getChatModel(ctx.chat.id), getChatEffort(ctx.chat.id));
    const sessionMeta = adapter.resolveSession ? await adapter.resolveSession(sessionId) : null;
    const project = getSessionProjectLabel(sessionMeta, adapterInfo.cwd);
    const source = getSessionSourceLabel(sessionMeta);

    if (!sessionBelongsToChat(ctx.chat.id, sessionId, backend, "owned")) {
      const resumeCmd = buildResumeHint(backend, sessionId, sessionMeta?.cwd || adapterInfo.cwd);
      await ctx.reply(
        `${adapter.icon} 已拒绝绑定外部会话 \`${sessionId}\`（${backend}）\n` +
        `${project ? `项目: ${project}${source ? ` ${source}` : ""}\n` : ""}` +
        `当前 TG 实例默认只允许恢复本 chat 自己创建的会话。` +
        `${resumeCmd ? `\n终端如需单独查看，可用: \`${resumeCmd}\`` : ""}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    setSession(
      ctx.chat.id,
      sessionId,
      sessionMeta?.display_name || "",
      backend,
      "owned",
    );
    await ctx.reply(
      `${adapter.icon} 已绑定会话 \`${sessionId}\`（${backend}）\n` +
      `${project ? `项目: ${project}${source ? ` ${source}` : ""}\n` : ""}` +
      `后续消息会继续这个 session。`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /peek 命令：只读查看指定 session 内容，不切换当前会话 ──
  bot.command("peek", async (ctx) => {
    const sessionId = ctx.match?.trim();
    if (!sessionId) {
      await ctx.reply("用法: /peek <session-id>\n只读查看该会话的最近片段，不会切换当前会话。");
      return;
    }

    const adapter = getAdapter(ctx.chat.id);
    await sendSessionPeek(ctx, adapter, sessionId, 6);
  });

  // ── /sessions 命令：统一列出最近会话；点按钮只回显 ID + 片段，不切换当前会话 ──
  bot.command("sessions", async (ctx) => {
    if (!IS_OWNER) {
      await ctx.reply(NON_OWNER_SESSIONS_HINT);
      return;
    }
    try {
      const adapter = getAdapter(ctx.chat.id);
      const backendName = getBackendName(ctx.chat.id);
      const adapterInfo = adapter.statusInfo(getChatModel(ctx.chat.id), getChatEffort(ctx.chat.id));
      const ownedSessions = await getOwnedSessionsForChat(
        ctx.chat.id,
        backendName,
        adapter,
        10,
      );
      const externalSessions = await getExternalSessionsForChat(
        ctx.chat.id,
        backendName,
        adapter,
        10,
      );
      const allSessions = mergeSessionsForPicker(ownedSessions, externalSessions);
      const current = getSession(ctx.chat.id);
      const currentProject = adapterInfo.cwd ? basename(adapterInfo.cwd) : "";
      const sortedSessions = sortSessionsForDisplay(allSessions, current, currentProject);

      if (!sortedSessions.length) {
        await ctx.reply("没有找到历史会话。");
        return;
      }

      // 缓存列表供 /resume <序号> 使用
      lastSessionList.set(ctx.chat.id, sortedSessions);

      const kb = new InlineKeyboard();
      for (const s of sortedSessions) {
        const backend = s.backend || backendName;
        const isCurrent = current && current.session_id === s.session_id;
        kb.text(buildSessionButtonLabel(s, backend, isCurrent), `resume:${s.session_id}:${backend}`).row();
      }
      await ctx.reply(
        "选择会话：点按钮接续，或 /resume <序号>（如 /resume 3）。要新开会话发 /new。",
        { reply_markup: kb },
      );
    } catch (e) {
      await ctx.reply(`查询失败: ${e.message}`);
    }
  });

  // ── 按钮回调：只读查看外部会话 ──
  bot.callbackQuery(/^peek:/, async (ctx) => {
    const data = ctx.callbackQuery.data.replace("peek:", "");
    const lastColon = data.lastIndexOf(":");
    let sessionId, backend;
    if (lastColon > 0 && AVAILABLE_BACKENDS.includes(data.slice(lastColon + 1))) {
      sessionId = data.slice(0, lastColon);
      backend = data.slice(lastColon + 1);
    } else {
      sessionId = data;
      backend = getBackendName(ctx.chat.id);
    }

    const adapter = adapters[backend];
    if (!adapter) {
      await ctx.answerCallbackQuery({ text: "后端不可用" });
      return;
    }

    await ctx.answerCallbackQuery({ text: `ID: ${formatSessionIdShort(sessionId, 12)}` });
    await sendSessionPeek(ctx, adapter, sessionId, 6);
  });

  // ── /status 命令：显示状态 ──
  bot.command("status", async (ctx) => {
    const adapter = getAdapter(ctx.chat.id);
    const backendName = getBackendName(ctx.chat.id);
    const session = getSession(ctx.chat.id);
    const effectiveSession = getEffectiveSession(ctx.chat.id);
    const verbose = verboseSettings.get(ctx.chat.id) ?? DEFAULT_VERBOSE;
    const modelOverride = getChatModel(ctx.chat.id);
    const effortOverride = getChatEffort(ctx.chat.id) || DEFAULT_EFFORT || null;
    const info = adapter.statusInfo(modelOverride, effortOverride);
    const activeTask = getActiveTask(ctx.chat.id);
    const discussState = getDiscussTurnState({
      chat: ctx.chat,
      session: effectiveSession,
      discussChatIds: DISCUSS_CHAT_IDS,
    });

    let sessionLine = "当前会话: 无（下条消息开新会话）";
    let resumeHint = "";
    let sessionMetaLine = "";
    if (session) {
      const sid = session.session_id;
      const sessionMeta = adapter.resolveSession ? await adapter.resolveSession(sid) : null;
      const effectiveCwd = sessionMeta?.cwd || info.cwd;
      const project = getSessionProjectLabel(sessionMeta, effectiveCwd);
      const source = getSessionSourceLabel(sessionMeta);
      sessionLine = `当前会话: \`${sid.slice(0, 8)}...\``;
      if (project || source || sessionMeta?.cwd) {
        sessionMetaLine =
          `\n会话项目: ${project || "(unknown)"}${source ? ` ${source}` : ""}` +
          `${sessionMeta?.cwd ? `\n会话目录: ${sessionMeta.cwd}` : ""}`;
      }
      const resumeCmd = buildResumeHint(session.backend, sid, effectiveCwd);
      if (resumeCmd) resumeHint = `\n终端接续: \`${resumeCmd}\``;
    }

    const statusText =
      `${adapter.icon} 实例后端: ${adapter.label} (${backendName})\n` +
      `${getBackendStatusNote(backendName)}` +
      `执行器: ${executor.label} (${executor.name})\n` +
      `模式: ${info.mode}\n` +
      `模型: ${info.model}\n` +
      `思考深度: ${info.effort || DEFAULT_EFFORT || "默认 (high)"}\n` +
      `工作目录: ${dirManager.current(ctx.chat.id)}\n` +
      `${sessionLine}${sessionMetaLine}${resumeHint}\n` +
      `Discuss: ${discussState.active ? "on" : "off"} (${discussState.sessionType})\n` +
      `进度详细度: ${verbose}（0=关/1=工具名/2=详细）` +
      `${cronManager ? `\nCron: ${cronManager.count(ctx.chat.id)} 个任务` : ""}` +
      `${activeTask ? `\n活动任务: ${formatTaskStatus(activeTask)}` : ""}`;
    await ctx.reply(statusText, { parse_mode: "Markdown" }).catch(() =>
      ctx.reply(statusText.replace(/[`*_\[\]]/g, "")).catch(() => {})
    );
  });

  // A2A 命令
  bot.command("a2a", async (ctx) => {
    const args = ctx.message?.text?.split(" ").slice(1) || [];
    const subcmd = args[0] || "status";

    if (subcmd === "status") {
      if (!a2aBus) {
        await ctx.reply("A2A 未启用。请在 config.json 中设置 shared.a2aEnabled = true 并重启。");
        return;
      }
      const stats = a2aBus.getStats();
      const lg = stats.loopGuard;
      const ph = stats.peerHealth;

      await ctx.reply(
        `🤖 A2A 状态\n` +
        `━━━━━━━━━━━━\n` +
        `本体: ${stats.self}\n` +
        `端口: ${stats.port}\n` +
        `Peers: ${stats.peers.join(", ") || "无"}\n` +
        `━━━━━━━━━━━━\n` +
        `Loop Guard:\n` +
        `  收到: ${lg.received}\n` +
        `  放行: ${lg.allowed}\n` +
        `  拦截(Generation): ${lg.blockedGeneration}\n` +
        `  拦截(Dup): ${lg.blockedDuplicate}\n` +
        `━━━━━━━━━━━━\n` +
        `Peer 熔断:\n` +
        Object.entries(ph).map(([name, s]) => `  ${name}: ${s.circuit} (${s.consecutiveFailures} 次失败)`).join("\n") || "  无",
        { parse_mode: "Markdown" }
      );
    } else if (subcmd === "test") {
      if (!a2aBus) {
        await ctx.reply("A2A 未启用");
        return;
      }
      await ctx.reply("正在发送测试消息...");
      const results = await a2aBus.broadcast({
        chatId: ctx.chat.id,
        generation: 0,
        content: "A2A 测试消息",
        originalPrompt: "测试",
      });
      await ctx.reply(`测试结果: 发送 ${results.sent}, 失败 ${results.failed}, 跳过 ${results.skipped}`);
    } else {
      await ctx.reply(`可用子命令: /a2a status, /a2a test`);
    }
  });

  bot.command("tasks", async (ctx) => {
    const tasks = recentTasks(ctx.chat.id, 8);
    if (!tasks.length) {
      await ctx.reply("最近没有任务记录。");
      return;
    }

    await sendLong(
      ctx,
      [
        "最近任务：",
        ...tasks.map((task) => `- ${formatTaskStatus(task)}`),
      ].join("\n"),
    );
  });

  // ── /verbose 命令：设置进度详细度 ──
  bot.command("verbose", async (ctx) => {
    const arg = ctx.match?.trim();
    const level = Number(arg);
    if (arg === "" || isNaN(level) || level < 0 || level > 2) {
      const current = verboseSettings.get(ctx.chat.id) ?? DEFAULT_VERBOSE;
      await ctx.reply(
        `当前进度详细度: ${current}\n` +
        `用法: /verbose 0|1|2\n` +
        `  0 = 只显示"正在处理..."\n` +
        `  1 = 显示工具名+图标\n` +
        `  2 = 工具名+输入+推理片段`
      );
      return;
    }
    verboseSettings.set(ctx.chat.id, level);
    await ctx.reply(`进度详细度已设为 ${level}`);
  });

  // ── /model 命令：切换当前实例的模型 ──
  bot.command("model", async (ctx) => {
    const adapter = getAdapter(ctx.chat.id);
    const models = adapter.availableModels ? adapter.availableModels() : [];
    const currentModel = getChatModel(ctx.chat.id);
    const arg = ctx.match?.trim();

    if (!arg) {
      // 无参数：显示 inline 按钮选择
      if (!models.length) {
        await ctx.reply(`${adapter.icon} ${adapter.label} 不支持模型切换。`);
        return;
      }
      const kb = new InlineKeyboard();
      for (const m of models) {
        const isCurrent = (m.id === "__default__" && !currentModel) || (m.id === currentModel);
        const mark = isCurrent ? " ✦" : "";
        kb.text(`${m.label}${mark}`, `model:${m.id}`).row();
      }
      const displayModel = currentModel || models[0]?.label || "(default)";
      await ctx.reply(`${adapter.icon} 当前模型: ${displayModel}\n选择模型：`, { reply_markup: kb });
      return;
    }

    // 有参数：直接设置
    if (arg === "default" || arg === "__default__") {
      deleteChatModel(ctx.chat.id);
      await ctx.reply(`${adapter.icon} 已恢复默认模型。`);
      return;
    }
    const found = models.find(m => m.id === arg || m.label === arg);
    if (!found && models.length) {
      const list = models.map(m => `  ${m.id} — ${m.label}`).join("\n");
      await ctx.reply(`未知模型: ${arg}\n\n可用模型:\n${list}`);
      return;
    }
    setChatModel(ctx.chat.id, arg);
    await ctx.reply(`${adapter.icon} 模型已切换为: ${arg}`);
  });

  // ── /effort 命令：切换思考深度（从 adapter 读取可用级别）──
  bot.command("effort", async (ctx) => {
    const adapter = getAdapter(ctx.chat.id);
    const effortLevels = typeof adapter.availableEfforts === "function"
      ? adapter.availableEfforts()
      : [
          { id: "__default__", label: "默认", description: "标准思考深度" },
          { id: "low", label: "Low", description: "轻量思考" },
          { id: "medium", label: "Medium", description: "中等思考深度" },
          { id: "high", label: "High", description: "深度思考" },
        ];
    const currentEffort = getChatEffort(ctx.chat.id);
    const effectiveEffort = currentEffort || DEFAULT_EFFORT || null;
    const arg = ctx.match?.trim();

    if (!arg) {
      const kb = new InlineKeyboard();
      for (const e of effortLevels) {
        const isCurrent = (e.id === "__default__" && !effectiveEffort) || (e.id === effectiveEffort);
        const mark = isCurrent ? " ✦" : "";
        kb.text(`${e.label}${mark}`, `effort:${e.id}`).row();
      }
      const displayEffort = effectiveEffort || effortLevels[0]?.label || "默认";
      await ctx.reply(`${adapter.icon} 当前思考深度: ${displayEffort}\n选择深度：`, { reply_markup: kb });
      return;
    }

    if (arg === "default" || arg === "__default__") {
      deleteChatEffort(ctx.chat.id);
      await ctx.reply(`${adapter.icon} 已恢复默认思考深度。`);
      return;
    }
    const found = effortLevels.find(e => e.id === arg);
    if (!found) {
      const list = effortLevels.map(e => `  ${e.id} — ${e.description}`).join("\n");
      await ctx.reply(`未知深度: ${arg}\n\n可用级别:\n${list}`);
      return;
    }
    setChatEffort(ctx.chat.id, arg);
    await ctx.reply(`${adapter.icon} 思考深度已切换为: ${found.label}`);
  });

  // ── /dir 命令：切换工作目录 ──
  bot.command("dir", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = ctx.match?.trim();

    if (!arg) {
      const current = dirManager.current(chatId);
      await ctx.reply(`📂 当前目录: ${current}`);
      return;
    }

    if (arg === "list") {
      const hist = dirManager.history(chatId);
      if (!hist.length) {
        await ctx.reply("📂 暂无目录历史");
        return;
      }
      const current = dirManager.current(chatId);
      const lines = hist.map((d, i) =>
        `${d === current ? "▸ " : "  "}${i + 1}. ${d}`
      );
      await ctx.reply(`📂 目录历史:\n${lines.join("\n")}`);
      return;
    }

    const result = dirManager.switchDir(chatId, arg);
    if (!result.ok) {
      await ctx.reply(`❌ ${result.error}`);
      return;
    }
    await ctx.reply(`📂 已切换: ${result.current}\n   上一个: ${result.prev}`);
  });

  // ── /cron 命令：定时任务管理 ──
  bot.command("cron", async (ctx) => {
    if (!cronManager) {
      await ctx.reply("⏭️ Cron 未启用（config: cronEnabled=false）");
      return;
    }

    const chatId = ctx.chat.id;
    const arg = ctx.match?.trim() || "";
    const parts = arg.split(/\s+/);
    const subCmd = parts[0]?.toLowerCase();

    if (!subCmd || subCmd === "list") {
      const jobList = cronManager.list(chatId);
      if (!jobList.length) {
        await ctx.reply("⏰ 没有定时任务。\n\n用法:\n/cron add <cron表达式> <指令>\n/cron remove <id>\n/cron pause <id>\n/cron resume <id>");
        return;
      }
      const lines = jobList.map((j) => {
        const status = j.status === "active" ? "▶️" : "⏸️";
        const next = j.nextRun ? new Date(j.nextRun).toLocaleString("zh-CN") : "-";
        return `${status} \`${j.id}\`\n   ${j.cronExpr} — ${j.prompt.slice(0, 40)}\n   下次: ${next}`;
      });
      await ctx.reply(`⏰ 定时任务 (${jobList.length}):\n\n${lines.join("\n\n")}`, { parse_mode: "Markdown" }).catch(() =>
        ctx.reply(`⏰ 定时任务 (${jobList.length}):\n\n${lines.join("\n\n").replace(/`/g, "")}`)
      );
      return;
    }

    if (subCmd === "add") {
      // /cron add "0 9 * * *" bun test
      // /cron add 0 9 * * * bun test
      const rest = arg.slice(4).trim();
      let cronExpr, prompt;

      if (rest.startsWith('"') || rest.startsWith("'")) {
        // 引号包裹的 cron 表达式
        const quote = rest[0];
        const endQuote = rest.indexOf(quote, 1);
        if (endQuote === -1) {
          await ctx.reply('❌ 未闭合的引号。用法: /cron add "0 9 * * *" 你的指令');
          return;
        }
        cronExpr = rest.slice(1, endQuote);
        prompt = rest.slice(endQuote + 1).trim();
      } else {
        // 前 5 个 token 是 cron 表达式
        const tokens = rest.split(/\s+/);
        if (tokens.length < 6) {
          await ctx.reply('❌ 参数不足。用法: /cron add "0 9 * * *" 你的指令\n或: /cron add 0 9 * * * 你的指令');
          return;
        }
        cronExpr = tokens.slice(0, 5).join(" ");
        prompt = tokens.slice(5).join(" ");
      }

      if (!prompt) {
        await ctx.reply("❌ 缺少执行指令。");
        return;
      }

      const result = cronManager.add(chatId, cronExpr, prompt);
      if (!result.ok) {
        await ctx.reply(`❌ ${result.error}`);
        return;
      }
      const nextStr = result.nextRun ? new Date(result.nextRun).toLocaleString("zh-CN") : "-";
      await ctx.reply(`✅ 任务已创建\nID: \`${result.id}\`\n表达式: ${cronExpr}\n指令: ${prompt}\n下次执行: ${nextStr}`, { parse_mode: "Markdown" }).catch(() =>
        ctx.reply(`✅ 任务已创建\nID: ${result.id}\n表达式: ${cronExpr}\n指令: ${prompt}\n下次执行: ${nextStr}`)
      );
      return;
    }

    if (subCmd === "remove" || subCmd === "delete" || subCmd === "rm") {
      const id = parts[1];
      if (!id) { await ctx.reply("❌ 缺少任务 ID。"); return; }
      if (cronManager.remove(id)) {
        await ctx.reply(`✅ 任务 ${id} 已删除`);
      } else {
        await ctx.reply(`❌ 未找到任务: ${id}`);
      }
      return;
    }

    if (subCmd === "pause") {
      const id = parts[1];
      if (!id) { await ctx.reply("❌ 缺少任务 ID。"); return; }
      if (cronManager.pause(id)) {
        await ctx.reply(`⏸️ 任务 ${id} 已暂停`);
      } else {
        await ctx.reply(`❌ 未找到任务: ${id}`);
      }
      return;
    }

    if (subCmd === "resume") {
      const id = parts[1];
      if (!id) { await ctx.reply("❌ 缺少任务 ID。"); return; }
      if (cronManager.resume(id)) {
        await ctx.reply(`▶️ 任务 ${id} 已恢复`);
      } else {
        await ctx.reply(`❌ 未找到任务: ${id}`);
      }
      return;
    }

    await ctx.reply("❌ 未知子命令。可用: list / add / remove / pause / resume");
  });

  // ── /export 命令：导出群聊共享上下文为 Markdown ──
  bot.command("export", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const messages = await readSharedMessages(chatId, { limit: 200 });
      if (!messages || messages.length === 0) {
        await ctx.reply("当前聊天没有共享上下文记录。");
        return;
      }
      const lines = messages.map((m) => {
        const time = new Date(m.ts).toISOString().slice(0, 19).replace("T", " ");
        const who = m.source || m.backend || "unknown";
        const text = (m.text || "").trim();
        return `### ${who}  \`${time}\`\n\n${text}\n`;
      });
      const md = `# War Room Export\n\n**Chat:** ${chatId}  \n**Exported:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}  \n**Messages:** ${messages.length}\n\n---\n\n${lines.join("\n---\n\n")}`;
      await tgSendDocument(chatId, Buffer.from(md, "utf-8"), `war-room-${Date.now()}.md`);
      await ctx.reply(`📎 已导出 ${messages.length} 条共享上下文记录。`);
    } catch (e) {
      await ctx.reply(`导出失败: ${e.message}`);
    }
  });

  // ── /doctor 命令：健康检查 ──
  bot.command("doctor", async (ctx) => {
    const chatId = ctx.chat.id;
    const report = await runHealthCheck({
      adapters,
      activeBackends: ACTIVE_BACKENDS,
      cronManager,
      rateLimiter,
      idleMonitor,
      dirManager,
      a2aBus,
      sharedContextConfig,
      cwd: dirManager.current(chatId),
      chatId,
    });
    await ctx.reply(report, { parse_mode: "Markdown" }).catch(() =>
      ctx.reply(report.replace(/\*/g, ""))
    );
  });

  // ── 按钮回调：模型选择 ──
  bot.callbackQuery(/^model:/, async (ctx) => {
    const modelId = ctx.callbackQuery.data.replace("model:", "");
    const adapter = getAdapter(ctx.chat.id);
    if (modelId === "__default__") {
      deleteChatModel(ctx.chat.id);
      await ctx.answerCallbackQuery({ text: "已恢复默认 ✓" });
      await ctx.editMessageText(`${adapter.icon} 已恢复默认模型。`);
    } else {
      const models = typeof adapter.availableModels === "function" ? adapter.availableModels() : [];
      if (!models.some((model) => model.id === modelId)) {
        await ctx.answerCallbackQuery({
          text: "该模型已不可用，请重新打开 /model",
          show_alert: true,
        });
        return;
      }
      setChatModel(ctx.chat.id, modelId);
      await ctx.answerCallbackQuery({ text: `已切换 ✓` });
      await ctx.editMessageText(`${adapter.icon} 模型已切换为: ${modelId}`);
    }
  });

  // ── 按钮回调：effort 选择 ──
  bot.callbackQuery(/^effort:/, async (ctx) => {
    const effortId = ctx.callbackQuery.data.replace("effort:", "");
    const adapter = getAdapter(ctx.chat.id);
    const effortLevels = typeof adapter.availableEfforts === "function"
      ? adapter.availableEfforts()
      : [];
    if (effortId === "__default__") {
      deleteChatEffort(ctx.chat.id);
      await ctx.answerCallbackQuery({ text: "已恢复默认 ✓" });
      await ctx.editMessageText(`${adapter.icon} 已恢复默认思考深度。`);
    } else {
      const found = effortLevels.find(e => e.id === effortId);
      const label = found ? found.label : effortId;
      setChatEffort(ctx.chat.id, effortId);
      await ctx.answerCallbackQuery({ text: `已切换 ✓` });
      await ctx.editMessageText(`${adapter.icon} 思考深度已切换为: ${label}`);
    }
  });

  // ── 按钮回调：恢复会话 ──
  // non-owner 守护：菜单已隐藏 /sessions /resume，但旧消息里的按钮 callback 仍可被点
  // 触发。这里加 owner gate 防止绕过命令隐藏（Codex 二审 P1.1, 2026-05-29）
  bot.callbackQuery(/^resume:/, async (ctx) => {
    if (!IS_OWNER) {
      await ctx.answerCallbackQuery({ text: "仅主力 bot 可用", show_alert: true });
      return;
    }
    const data = ctx.callbackQuery.data.replace("resume:", "");
    // 格式: sessionId:backend
    const lastColon = data.lastIndexOf(":");
    let sessionId, backend;
    if (lastColon > 0 && AVAILABLE_BACKENDS.includes(data.slice(lastColon + 1))) {
      sessionId = data.slice(0, lastColon);
      backend = data.slice(lastColon + 1);
    } else {
      sessionId = data;
      backend = "claude";
    }

    const adapter = adapters[backend];
    const icon = adapter?.icon || "🟣";
    const adapterInfo = adapter ? adapter.statusInfo(getChatModel(ctx.chat.id), getChatEffort(ctx.chat.id) || DEFAULT_EFFORT || null) : { cwd: CC_CWD };
    const sessionMeta = adapter?.resolveSession ? await adapter.resolveSession(sessionId) : null;
    setSession(
      ctx.chat.id,
      sessionId,
      sessionMeta?.display_name || "",
      backend,
      "owned",
    );
    const project = getSessionProjectLabel(sessionMeta, adapterInfo.cwd);
    const source = getSessionSourceLabel(sessionMeta);
    await ctx.answerCallbackQuery({ text: "已恢复 ✓" });
    await ctx.editMessageText(
      `${icon} 已恢复会话 \`${sessionId.slice(0, 8)}\`（${backend}）\n` +
      `${project ? `项目: ${project}${source ? ` ${source}` : ""}\n` : ""}` +
      `继续发消息即可。`,
      { parse_mode: "Markdown" }
    );
  });

  // ── 按钮回调：AskUserQuestion 选项 ──
  bot.callbackQuery(/^ask:/, async (ctx) => {
    const raw = ctx.callbackQuery.data.replace("ask:", "");
    const label = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
    await ctx.answerCallbackQuery({ text: `选择: ${label}` });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await submitAndWait(ctx, label);
  });

  // ── 按钮回调：快捷回复 ──
  bot.callbackQuery(/^reply:/, async (ctx) => {
    const text = ctx.callbackQuery.data.replace("reply:", "");
    await ctx.answerCallbackQuery({ text: `发送: ${text}` });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await submitAndWait(ctx, text);
  });

  // ── 按钮回调：Tool Approval ──
  bot.callbackQuery(/^perm:/, async (ctx) => {
    const parts = ctx.callbackQuery.data.split(":");
    const permId = Number(parts[1]);
    const action = parts[2];
    const pending = pendingPermissions.get(permId);

    if (!pending) {
      await ctx.answerCallbackQuery({ text: "已过期" });
      return;
    }

    pendingPermissions.delete(permId);
    pending.cleanup();

    const state = getPermState(pending.chatId);

    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    if (action === "allow") {
      if (pending.taskId) markTaskApproved(pending.taskId, pending.toolName);
      await ctx.answerCallbackQuery({ text: "Allowed" });
      pending.resolve({ behavior: "allow", toolUseID: pending.toolUseID });
    } else if (action === "deny") {
      if (pending.taskId) markTaskRejected(pending.taskId, pending.toolName);
      await ctx.answerCallbackQuery({ text: "Denied" });
      pending.resolve({ behavior: "deny", message: "用户拒绝", toolUseID: pending.toolUseID });
    } else if (action === "always") {
      state.alwaysAllowed.add(pending.toolName);
      if (pending.taskId) markTaskApproved(pending.taskId, pending.toolName);
      await ctx.answerCallbackQuery({ text: `Always "${pending.toolName}"` });
      pending.resolve({
        behavior: "allow",
        updatedPermissions: pending.suggestions || [],
        toolUseID: pending.toolUseID,
      });
    } else if (action === "yolo") {
      state.yolo = true;
      if (pending.taskId) markTaskApproved(pending.taskId, pending.toolName);
      await ctx.answerCallbackQuery({ text: "YOLO mode ON" });
      pending.resolve({ behavior: "allow", toolUseID: pending.toolUseID });
    }
  });
}
