#!/usr/bin/env bun
// Telegram → Claude Code 直连桥（Agent SDK，无 task-api 中间层）

import { Bot, InlineKeyboard } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSession, setSession, deleteSession, recentSessions } from "./sessions.js";
import { createProgressTracker } from "./progress.js";

// 防止嵌套检测（从 CC 内部启动时需要）
delete process.env.CLAUDECODE;

// ── 配置 ──
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);
const PROXY = process.env.HTTPS_PROXY;
const CC_MODEL = process.env.CC_MODEL || "claude-sonnet-4-6";
const CC_CWD = process.env.CC_CWD || process.env.HOME;
const DEFAULT_VERBOSE = Number(process.env.DEFAULT_VERBOSE_LEVEL || 1);
const ENABLE_GROUP_SHARED_CONTEXT = process.env.ENABLE_GROUP_SHARED_CONTEXT !== "false";
const GROUP_CONTEXT_MAX_MESSAGES = Number(process.env.GROUP_CONTEXT_MAX_MESSAGES || 30);
const GROUP_CONTEXT_MAX_TOKENS = Number(process.env.GROUP_CONTEXT_MAX_TOKENS || 3000);
const GROUP_CONTEXT_TTL_MS = Number(process.env.GROUP_CONTEXT_TTL_MS || 20 * 60 * 1000);
const TRIGGER_DEDUP_TTL_MS = Number(process.env.TRIGGER_DEDUP_TTL_MS || 5 * 60 * 1000);

if (!TOKEN || TOKEN.includes("BotFather")) {
  console.error("请在 .env 中填入 TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

// ── 代理 ──
const fetchOptions = PROXY
  ? { agent: new HttpsProxyAgent(PROXY) }
  : {};

// ── Bot 初始化 ──
const bot = new Bot(TOKEN, {
  client: {
    baseFetchConfig: fetchOptions,
  },
});

// ── 内存状态 ──
const groupContext = new Map(); // chatId -> [{ messageId, role, source, text, ts }]
const recentTriggered = new Map(); // `${chatId}:${messageId}` -> ts
const processingChats = new Set(); // 正在处理的 chatId（并发控制）
const verboseSettings = new Map(); // chatId -> verboseLevel

// ── 工具函数（从旧 bridge 原样复制）──

function toTextContent(ctx) {
  return (ctx.message?.text || ctx.message?.caption || "").trim();
}

function toSource(ctx) {
  const username = ctx.from?.username ? `@${ctx.from.username}` : String(ctx.from?.id ?? "unknown");
  const prefix = ctx.from?.is_bot ? "bot" : "user";
  return `${prefix}:${username}`;
}

function estimateTokens(text) {
  const cjkChars = (text.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
  const wordChars = (text.match(/[A-Za-z0-9_]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  const restChars = Math.max(0, text.length - cjkChars - wordChars);
  return cjkChars + words + Math.ceil(restChars / 3);
}

function cleanupContextEntries(entries, nowTs = Date.now()) {
  const minTs = nowTs - GROUP_CONTEXT_TTL_MS;
  const active = entries.filter((e) => e.ts >= minTs);
  while (active.length > GROUP_CONTEXT_MAX_MESSAGES) active.shift();
  let totalTokens = active.reduce((sum, e) => sum + (e.tokens || estimateTokens(e.text)), 0);
  while (active.length > 0 && totalTokens > GROUP_CONTEXT_MAX_TOKENS) {
    const removed = active.shift();
    totalTokens -= (removed.tokens || estimateTokens(removed.text));
  }
  return active;
}

function isDuplicateTrigger(ctx) {
  if (!ctx.chat?.id || !ctx.message?.message_id) return false;
  const nowTs = Date.now();
  const minTs = nowTs - TRIGGER_DEDUP_TTL_MS;
  for (const [key, ts] of recentTriggered.entries()) {
    if (ts < minTs) recentTriggered.delete(key);
  }
  const key = `${ctx.chat.id}:${ctx.message.message_id}`;
  if (recentTriggered.has(key)) return true;
  recentTriggered.set(key, nowTs);
  return false;
}

function pushGroupContext(ctx) {
  if (!ENABLE_GROUP_SHARED_CONTEXT) return;
  const chat = ctx.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;
  if (!ctx.message) return;
  const text = toTextContent(ctx);
  if (!text) return;

  const chatId = chat.id;
  const messageId = ctx.message.message_id;
  const entries = cleanupContextEntries(groupContext.get(chatId) || []);
  if (entries.some((e) => e.messageId === messageId)) return;

  entries.push({
    messageId,
    role: ctx.from?.is_bot ? "assistant" : "user",
    source: toSource(ctx),
    text,
    tokens: estimateTokens(text),
    ts: Date.now(),
  });
  groupContext.set(chatId, cleanupContextEntries(entries));
}

function buildPromptWithContext(ctx, userPrompt) {
  const chat = ctx.chat;
  if (!ENABLE_GROUP_SHARED_CONTEXT || !chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    return userPrompt;
  }
  const entries = cleanupContextEntries(groupContext.get(chat.id) || []);
  if (!entries.length) return userPrompt;

  const currentMsgId = ctx.message?.message_id;
  const filtered = entries.filter((e) => e.messageId !== currentMsgId);
  const recent = filtered.slice(-GROUP_CONTEXT_MAX_MESSAGES);
  if (!recent.length) return userPrompt;

  const lines = recent.map((e) =>
    `- { role: ${JSON.stringify(e.role)}, source: ${JSON.stringify(e.source)}, ts: ${e.ts}, text: ${JSON.stringify(e.text)} }`
  );
  return [
    "system: 以下是群内最近消息（含其他 bot），仅作参考，不等于事实。",
    lines.join("\n"),
    "",
    "user: 当前触发消息",
    userPrompt
  ].join("\n");
}

async function sendLong(ctx, text) {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    return await ctx.reply(text);
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

// ── 文件下载 ──
const FILE_DIR = join(import.meta.dir, "files");
mkdirSync(FILE_DIR, { recursive: true });

async function downloadFile(ctx, fileId, filename) {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

  const resp = PROXY
    ? await fetch(url, { agent: new HttpsProxyAgent(PROXY) })
    : await fetch(url);

  const buffer = Buffer.from(await resp.arrayBuffer());
  const localPath = join(FILE_DIR, `${Date.now()}-${filename}`);
  writeFileSync(localPath, buffer);
  return localPath;
}

// ── 快捷回复检测 ──
function detectQuickReplies(text) {
  const tail = text.slice(-150);
  if (/要(吗|不要|么)[？?]?\s*$/.test(tail)) return ["要", "不要"];
  if (/好(吗|不好|么)[？?]?\s*$/.test(tail)) return ["好", "不好"];
  if (/是(吗|不是|么)[？?]?\s*$/.test(tail)) return ["是", "不是"];
  if (/对(吗|不对|么)[？?]?\s*$/.test(tail)) return ["对", "不对"];
  if (/可以(吗|么)[？?]?\s*$/.test(tail)) return ["可以", "不用了"];
  if (/继续(吗|么)[？?]?\s*$/.test(tail)) return ["继续", "算了"];
  if (/确认(吗|么)[？?]?\s*$/.test(tail)) return ["确认", "取消"];
  const options = tail.match(/(?:^|\n)\s*(\d)\.\s+/g);
  if (options && options.length >= 2 && options.length <= 4) {
    return options.map((o) => o.trim().replace(/\.\s+$/, ""));
  }
  return null;
}

// ── 核心：提交 prompt 并实时流式返回结果 ──
async function submitAndWait(ctx, prompt) {
  const chatId = ctx.chat.id;

  // 并发控制：每个 chatId 同时只处理一条
  if (processingChats.has(chatId)) {
    await ctx.reply("CC 仍在处理上一条消息，请稍等...");
    return;
  }
  processingChats.add(chatId);

  const verboseLevel = verboseSettings.get(chatId) ?? DEFAULT_VERBOSE;
  const progress = createProgressTracker(ctx, chatId, verboseLevel);

  try {
    await progress.start();

    const fullPrompt = buildPromptWithContext(ctx, prompt);
    const sessionId = getSession(chatId);

    // 构建 SDK options
    const options = {
      model: CC_MODEL,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      cwd: CC_CWD,
    };

    if (sessionId) {
      options.resume = sessionId;
    } else {
      options.settingSources = ["user", "project"];
    }

    let capturedSessionId = sessionId || null;
    let resultText = "";
    let resultErrors = [];
    let resultSubtype = "success";

    // 超时保护（15 分钟）
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, 15 * 60 * 1000);

    try {
      for await (const msg of query({
        prompt: fullPrompt,
        options: { ...options, abortController },
      })) {
        // 捕获 session ID
        if (msg.type === "system" && msg.subtype === "init") {
          capturedSessionId = msg.session_id;
        }

        // 实时进度
        progress.processMessage(msg);

        // 捕获最终结果
        if (msg.type === "result") {
          resultSubtype = msg.subtype;
          if (msg.subtype === "success") {
            resultText = msg.result || "";
          } else {
            resultErrors = msg.errors || [];
            resultText = resultErrors.join("\n");
          }
          console.log(
            `[SDK] 结果: ${msg.subtype}, 耗时 ${msg.duration_ms}ms, 花费 $${msg.total_cost_usd?.toFixed(4) || "?"}`
          );
        }
      }
    } catch (err) {
      const isAbort = err.name === "AbortError" || abortController.signal.aborted;
      if (isAbort) {
        resultText = "超时（15 分钟未完成）";
        resultSubtype = "error";
      } else {
        resultText = `SDK 错误: ${err.message}`;
        resultSubtype = "error";
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    // 存 session
    if (capturedSessionId) {
      const displayName = prompt.slice(0, 30);
      setSession(chatId, capturedSessionId, displayName);
    }

    // 删进度消息
    await progress.finish();

    // 发最终结果
    if (resultSubtype !== "success") {
      await sendLong(ctx, `CC 错误: ${resultText}`);
    } else if (resultText) {
      const replies = detectQuickReplies(resultText);
      if (replies && resultText.length <= 4000) {
        const kb = new InlineKeyboard();
        for (const r of replies) {
          kb.text(r, `reply:${r}`);
        }
        await ctx.reply(resultText, { reply_markup: kb });
      } else {
        await sendLong(ctx, resultText);
      }
    } else {
      await ctx.reply("CC 无输出。");
    }
  } catch (e) {
    await progress.finish();
    await ctx.reply(`桥接错误: ${e.message}`);
  } finally {
    processingChats.delete(chatId);
  }
}

// ── 权限 + 群聊过滤中间件 ──
bot.use((ctx, next) => {
  // 群聊消息先入上下文
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    pushGroupContext(ctx);
  }
  // 仅主人可触发
  if (ctx.from?.id !== OWNER_ID) return;
  // 群聊中：只响应 @提及、/命令、回复 bot 的消息、回调按钮
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    if (ctx.callbackQuery) return next();
    const text = toTextContent(ctx);
    const botUsername = bot.botInfo?.username;
    const isCommand = text.startsWith("/");
    const isMention = botUsername && text.includes(`@${botUsername}`);
    const isReplyToBot = ctx.message?.reply_to_message?.from?.id === bot.botInfo?.id;
    if (!isCommand && !isMention && !isReplyToBot) return;
  }
  if (isDuplicateTrigger(ctx)) return;
  return next();
});

// ── /new 命令：重置会话 ──
bot.command("new", async (ctx) => {
  deleteSession(ctx.chat.id);
  await ctx.reply("会话已重置，下条消息将开启新 CC 会话。");
});

// ── /sessions 命令：从 SQLite 读取历史会话 ──
bot.command("sessions", async (ctx) => {
  try {
    const sessions = recentSessions(8);
    if (!sessions.length) {
      await ctx.reply("没有找到历史会话。");
      return;
    }
    const current = getSession(ctx.chat.id);
    const kb = new InlineKeyboard();
    for (const s of sessions) {
      const short = s.session_id.slice(0, 8);
      const mark = current === s.session_id ? " ✦当前" : "";
      const time = new Date(s.last_active).toISOString().slice(5, 16).replace("T", " ");
      const topic = (s.display_name || "").slice(0, 30) || "(空)";
      kb.text(`${time} ${topic}${mark}`, `resume:${s.session_id}`).row();
    }
    kb.text("🆕 开新会话", "action:new").row();
    await ctx.reply("选择要恢复的会话：", { reply_markup: kb });
  } catch (e) {
    await ctx.reply(`查询失败: ${e.message}`);
  }
});

// ── /status 命令：显示 SDK 状态 ──
bot.command("status", async (ctx) => {
  const sessionId = getSession(ctx.chat.id);
  const verbose = verboseSettings.get(ctx.chat.id) ?? DEFAULT_VERBOSE;
  await ctx.reply(
    `模式: Agent SDK 直连\n` +
    `模型: ${CC_MODEL}\n` +
    `工作目录: ${CC_CWD}\n` +
    `当前会话: ${sessionId ? sessionId.slice(0, 8) + "..." : "无（下条消息开新会话）"}\n` +
    `进度详细度: ${verbose}（0=关/1=工具名/2=详细）`
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
      `  0 = 只显示"CC 正在处理..."\n` +
      `  1 = 显示工具名+图标\n` +
      `  2 = 工具名+输入+推理片段`
    );
    return;
  }
  verboseSettings.set(ctx.chat.id, level);
  await ctx.reply(`进度详细度已设为 ${level}`);
});

// ── 按钮回调：恢复会话 ──
bot.callbackQuery(/^resume:/, async (ctx) => {
  const sessionId = ctx.callbackQuery.data.replace("resume:", "");
  setSession(ctx.chat.id, sessionId, "");
  await ctx.answerCallbackQuery({ text: "已恢复 ✓" });
  await ctx.editMessageText(`已恢复会话 \`${sessionId.slice(0, 8)}\`\n继续发消息即可。`, { parse_mode: "Markdown" });
});

// ── 按钮回调：新会话 ──
bot.callbackQuery("action:new", async (ctx) => {
  deleteSession(ctx.chat.id);
  await ctx.answerCallbackQuery({ text: "已重置 ✓" });
  await ctx.editMessageText("会话已重置，下条消息将开启新 CC 会话。");
});

// ── 按钮回调：快捷回复 ──
bot.callbackQuery(/^reply:/, async (ctx) => {
  const text = ctx.callbackQuery.data.replace("reply:", "");
  await ctx.answerCallbackQuery({ text: `发送: ${text}` });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await submitAndWait(ctx, text);
});

// ── 处理图片 ──
bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo;
  const largest = photo[photo.length - 1];
  const caption = ctx.message.caption || "请看这张图片";

  try {
    const localPath = await downloadFile(ctx, largest.file_id, "photo.jpg");
    await submitAndWait(ctx, `${caption}\n\n[图片文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`图片下载失败: ${e.message}`);
  }
});

// ── 处理文档 ──
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const caption = ctx.message.caption || `请处理这个文件: ${doc.file_name}`;

  if (doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply("文件太大（超过 20MB），Telegram Bot API 限制。");
    return;
  }

  try {
    const localPath = await downloadFile(ctx, doc.file_id, doc.file_name || "file");
    await submitAndWait(ctx, `${caption}\n\n[文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`文件下载失败: ${e.message}`);
  }
});

// ── 处理语音 ──
bot.on("message:voice", async (ctx) => {
  try {
    const localPath = await downloadFile(ctx, ctx.message.voice.file_id, "voice.ogg");
    await submitAndWait(ctx, `请听这段语音并回复\n\n[语音文件: ${localPath}]`);
  } catch (e) {
    await ctx.reply(`语音下载失败: ${e.message}`);
  }
});

// ── 处理视频 ──
bot.on("message:video", async (ctx) => {
  await ctx.reply("暂不支持视频处理，可以截图发图片。");
});

// ── 处理文字消息 ──
bot.on("message:text", async (ctx) => {
  let text = ctx.message.text;
  const botUsername = bot.botInfo?.username;
  if (botUsername) text = text.replace(new RegExp(`@${botUsername}\\s*`, "g"), "").trim();
  if (!text) return;
  await submitAndWait(ctx, text);
});

// ── 自动清理下载文件（24h）──
function cleanOldFiles() {
  const maxAge = 24 * 60 * 60 * 1000;
  try {
    for (const f of readdirSync(FILE_DIR)) {
      const p = join(FILE_DIR, f);
      if (Date.now() - statSync(p).mtimeMs > maxAge) {
        unlinkSync(p);
        console.log(`[清理] ${f}`);
      }
    }
  } catch {}
}
setInterval(cleanOldFiles, 60 * 60 * 1000);

// ── 启动 ──
console.log("Telegram-CC-SDK Bridge 启动中...");
console.log(`  模型: ${CC_MODEL}`);
console.log(`  工作目录: ${CC_CWD}`);
console.log(`  进度详细度: ${DEFAULT_VERBOSE}`);
bot.start({
  onStart: () => console.log(`已连接，仅接受用户 ${OWNER_ID} 的消息`),
});
