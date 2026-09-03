import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { resolve, dirname, join, isAbsolute } from "path";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { A2A_TOOL_MODES, normalizeA2AToolMode } from "./a2a/tool-mode.js";
import { resolveCodexCommand } from "./codex-cli-resolver.js";

const REPO_DIR = import.meta.dir;
const DEFAULT_CONFIG_PATH = join(REPO_DIR, "config.json");
const DEFAULT_PLACEHOLDER_TELEGRAM_TOKEN = "123456:replace-me";
export const AVAILABLE_BACKENDS = ["claude", "codex", "gemini", "agy", "kimi"];
export const AVAILABLE_EXECUTORS = ["direct", "local-agent"];
export const CLAUDE_PERMISSION_MODES = ["default", "bypassPermissions"];
export const CODEX_TRANSPORTS = ["sdk", "app-server"];
const BACKEND_PROFILES = {
  claude: {
    label: "Claude",
    maturity: "recommended",
    summary: "Recommended primary backend.",
  },
  codex: {
    label: "Codex",
    maturity: "recommended",
    summary: "Recommended primary backend.",
  },
  gemini: {
    label: "Gemini",
    maturity: "experimental",
    summary: "Experimental compatibility backend. Claude/Codex are the primary paths.",
  },
  agy: {
    label: "Agy",
    maturity: "experimental",
    summary: "Antigravity CLI (Gemini models) via one-shot -p calls.",
  },
  kimi: {
    label: "Kimi",
    maturity: "experimental",
    summary: "Kimi Code CLI (Moonshot models) via one-shot -p calls.",
  },
};

function homeDir() {
  return process.env.HOME || REPO_DIR;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function pushIssue(issues, path, message) {
  issues.push({ path, message });
}

function parseInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function isPositiveInteger(value) {
  const parsed = parseInteger(value);
  return parsed != null && parsed > 0;
}

function parseChatIdList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [value];
}

function normalizeChatIdList(value) {
  return parseChatIdList(value).map((item) => String(item).trim());
}

function looksLikeTelegramUserId(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

function looksLikeTelegramChatId(value) {
  return /^-?\d+$/.test(String(value ?? "").trim());
}

function looksLikeTelegramBotToken(value) {
  const token = String(value ?? "").trim();
  if (!token || /\s/.test(token)) return false;
  if (/replace-me|botfather/i.test(token)) return false;
  return /^\d{6,}:[A-Za-z0-9_-]{10,}$/.test(token);
}

function getBackendCredentialWarning(backend) {
  if (backend === "claude") {
    return {
      path: join(homeDir(), ".claude"),
      message: "Claude backend expects local login state under ~/.claude.",
    };
  }
  if (backend === "codex") {
    return {
      path: join(homeDir(), ".codex"),
      message: "Codex backend expects local login state under ~/.codex.",
    };
  }
  if (backend === "agy") {
    // agy 的登录态在 macOS keychain（svce=gemini / acct=antigravity），没有可 stat 的文件。
    // 指向 CLI 自己的状态目录只是为了给出「装过没」的线索；真正的可用性由 checkBackendCliAvailable 探。
    return {
      path: join(homeDir(), ".gemini", "antigravity-cli"),
      message:
        "Agy backend keeps credentials in the macOS keychain; it only resolves under a GUI/launchd session (not plain ssh).",
    };
  }
  if (backend === "kimi") {
    return {
      path: join(homeDir(), ".kimi-code", "credentials"),
      message: "Kimi backend expects credentials under ~/.kimi-code/credentials.",
    };
  }
  return {
    path: join(homeDir(), ".gemini", "oauth_creds.json"),
    message: "Gemini backend expects oauth_creds.json under ~/.gemini.",
  };
}

// 后端 CLI 探活：两个后端都经 SDK 调底层 CLI 二进制——
//   claude-agent-sdk 0.2.117+ 需显式 claude CLI 路径（见 adapters/claude.js: CLAUDE_CLI_PATH，默认 ~/.local/bin/claude）；
//   @openai/codex-sdk 默认优先 node_modules vendor，因此要验证 bridge 实际会用的 Codex binary。
//   gemini 走 Code Assist API，不需本地 CLI。
// which / exists 可注入，便于测试（默认 Bun.which / existsSync）。
function checkBackendCliAvailable(backend, options = {}) {
  const whichFn = options.which || ((cmd) => (typeof Bun !== "undefined" ? Bun.which(cmd) : null));
  const existsFn = options.exists || existsSync;
  if (backend === "claude") {
    const cliPath = process.env.CLAUDE_CLI_PATH || join(homeDir(), ".local", "bin", "claude");
    return { ok: Boolean(existsFn(cliPath)), name: "claude", probe: cliPath };
  }
  if (backend === "codex") {
    try {
      const resolved = resolveCodexCommand({
        env: options.env || process.env,
        knownPaths: options.codexKnownPaths,
        validateTimeoutMs: options.validateTimeoutMs,
      });
      return { ok: true, name: "codex", probe: `${resolved.path} (${resolved.version})` };
    } catch (error) {
      const fallbackProbe = whichFn("codex") || "codex (validated path)";
      return { ok: false, name: "codex", probe: `${fallbackProbe}: ${error.message}` };
    }
  }
  if (backend === "agy") {
    // 只验二进制在不在。登录态验不了：agy 的凭证在 keychain，而 check 跑在 launchd 之外的
    // 上下文里也能解开（同属 GUI 会话），所以「这里能解」不代表 bridge 能解，反之亦然——
    // 真正的登录态由首次实际对话暴露，别在 check 阶段假装验过。
    const cliPath = process.env.AGY_BIN || "/opt/homebrew/bin/agy";
    return { ok: Boolean(existsFn(cliPath)), name: "agy", probe: cliPath };
  }
  if (backend === "kimi") {
    // kimi 装在 ~/.kimi-code/bin，不在 PATH——用 which 探会误判「没装」。
    const cliPath = process.env.KIMI_BIN || join(homeDir(), ".kimi-code", "bin", "kimi");
    return { ok: Boolean(existsFn(cliPath)), name: "kimi", probe: cliPath };
  }
  return { ok: true, name: "gemini", probe: "(Code Assist API, no local CLI)" };
}

function ensureExistingDirectory(issues, pathLabel, targetPath) {
  if (!isNonEmptyString(targetPath)) {
    pushIssue(issues, pathLabel, "must be set.");
    return;
  }

  const resolvedPath = resolve(targetPath);
  if (!existsSync(resolvedPath)) {
    pushIssue(issues, pathLabel, `directory does not exist: ${resolvedPath}`);
    return;
  }

  try {
    if (!statSync(resolvedPath).isDirectory()) {
      pushIssue(issues, pathLabel, `must point to a directory: ${resolvedPath}`);
    }
  } catch {
    pushIssue(issues, pathLabel, `could not inspect directory: ${resolvedPath}`);
  }
}

function ensureParentDirectoryExists(issues, pathLabel, targetPath) {
  if (!isNonEmptyString(targetPath)) {
    pushIssue(issues, pathLabel, "must be set.");
    return;
  }

  const parentDir = dirname(resolve(targetPath));
  if (!existsSync(parentDir)) {
    pushIssue(issues, pathLabel, `parent directory does not exist: ${parentDir}`);
    return;
  }

  try {
    if (!statSync(parentDir).isDirectory()) {
      pushIssue(issues, pathLabel, `parent path is not a directory: ${parentDir}`);
    }
  } catch {
    pushIssue(issues, pathLabel, `could not inspect parent directory: ${parentDir}`);
  }
}

function validatePositiveIntegerField(issues, path, value) {
  if (!isPositiveInteger(value)) {
    pushIssue(issues, path, "must be a positive integer.");
  }
}

export function createDefaultConfig() {
  return {
    shared: {
      ownerTelegramId: "",
      cwd: homeDir(),
      httpProxy: "",
      defaultVerboseLevel: 1,
      executor: "direct",
      tasksDb: "",
      taskRetentionDays: 14,
      taskRetentionMinRows: 200,
      enableGroupSharedContext: true,
      discussChatIds: [],
      groupContextMaxMessages: 30,
      groupContextMaxTokens: 3000,
      groupContextTtlMs: 1200000,
      sharedContextBackend: "sqlite",
      sharedContextDb: "shared-context.db",
      sharedContextJsonPath: "shared-context.json",
      redisUrl: "",
      triggerDedupTtlMs: 300000,
      sessionTimeoutMs: 900000,
      // A2A 配置
      a2aEnabled: false,
      a2aPorts: { claude: 18810, codex: 18811, gemini: 18812, agy: 18813, kimi: 18814 },
      a2aToolMode: "read-only",
      a2aCooldownMs: 60000,
      a2aMaxResponsesPerWindow: 3,
      a2aWindowMs: 300000,
      a2aCircuitBreakerThreshold: 3,
      a2aCircuitBreakerResetMs: 30000,
      // Streaming Preview 配置
      streamPreviewEnabled: true,
      streamPreviewIntervalMs: 700,
      streamPreviewMinDeltaChars: 20,
      streamPreviewMaxChars: 3900,
      streamPreviewActivationChars: 50,
      // 限流配置
      rateLimitMaxRequests: 10,
      rateLimitWindowMs: 60000,
      // Idle 监控配置
      idleTimeoutMs: 1800000,
      resetOnIdleMs: 0,
      // Cron 配置
      cronEnabled: true,
      cronMaxJobs: 10,
      cronDefaultTimeoutMs: 600000,
    },
    backends: {
      claude: {
        enabled: true,
        telegramBotToken: "",
        sessionsDb: "sessions.db",
        model: "opus",
        defaultEffort: "",
        permissionMode: "default",
      },
      codex: {
        enabled: false,
        telegramBotToken: "",
        sessionsDb: "sessions-codex.db",
        model: "",
        serviceTier: "",
        defaultEffort: "",
        transport: "sdk",
      },
      gemini: {
        enabled: false,
        telegramBotToken: "",
        sessionsDb: "sessions-gemini.db",
        model: "gemini-2.5-pro",
        oauthClientId: "",
        oauthClientSecret: "",
        googleCloudProject: "",
      },
      agy: {
        enabled: false,
        telegramBotToken: "",
        sessionsDb: "sessions-agy.db",
        model: "gemini-3.8-flash-high",
        defaultEffort: "high",
      },
      kimi: {
        enabled: false,
        telegramBotToken: "",
        sessionsDb: "sessions-kimi.db",
        // 留空 = 吃 ~/.kimi-code/config.toml 的 default_model
        model: "",
        defaultEffort: "",
      },
    },
  };
}

export function createBootstrapConfig(backend = "claude") {
  const selectedBackend = normalizeBackendName(backend);
  const config = createDefaultConfig();

  config.shared.ownerTelegramId = "123456789";
  for (const name of AVAILABLE_BACKENDS) {
    // guard：AVAILABLE_BACKENDS 可能领先于传入 config 里实际存在的 backend 块
    // （新增 backend 时，用户手上的旧 config.json 还没有对应块）。少了就跳过，
    // 别让「注册了新 backend」这件事把 bootstrap 路径整条炸掉。
    if (!config.backends[name]) continue;
    config.backends[name].enabled = name === selectedBackend;
    if (name !== selectedBackend) {
      config.backends[name].telegramBotToken = "";
    }
  }

  if (config.backends[selectedBackend]) {
    config.backends[selectedBackend].enabled = true;
    config.backends[selectedBackend].telegramBotToken = DEFAULT_PLACEHOLDER_TELEGRAM_TOKEN;
  }

  return config;
}

function mergeConfig(base, patch) {
  const result = structuredClone(base);
  if (!patch || typeof patch !== "object") return result;

  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object") {
      result[key] = mergeConfig(result[key], value);
      continue;
    }
    result[key] = value;
  }

  return result;
}

function normalizeBackendName(name) {
  return String(name || "claude").toLowerCase();
}

export function getBackendProfile(name) {
  return BACKEND_PROFILES[normalizeBackendName(name)] || {
    label: String(name || "unknown"),
    maturity: "unknown",
    summary: "",
  };
}

function resolvePathMaybe(baseDir, targetPath) {
  if (!targetPath) return targetPath;
  if (isAbsolute(targetPath)) return targetPath;
  return resolve(baseDir, targetPath);
}

function parseJsonConfig(configPath) {
  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return mergeConfig(createDefaultConfig(), parsed);
}

function writePrivateConfig(configPath, config) {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  // The mode option only applies when creating a file. Tighten existing configs too.
  chmodSync(configPath, 0o600);
}

function buildEnvFromConfig(config, backend, configPath) {
  const selectedBackend = normalizeBackendName(backend);
  if (!AVAILABLE_BACKENDS.includes(selectedBackend)) {
    throw new Error(`Unsupported backend: ${selectedBackend}`);
  }

  const backendConfig = config.backends?.[selectedBackend];
  if (!backendConfig) {
    throw new Error(`Missing backends.${selectedBackend} in ${configPath}`);
  }
  if (backendConfig.enabled === false) {
    throw new Error(`Backend \"${selectedBackend}\" is disabled in ${configPath}`);
  }

  const baseDir = dirname(configPath);
  const shared = config.shared || {};
  // config.shared.httpProxy 优先；为空时回退到已存在的 HTTPS_PROXY 环境变量，
  // 避免 launchd/shell 已经设好代理却被空串覆盖（2026-04-23 GFW 封 telegram 直连 IP 时踩过）
  const resolvedHttpProxy = shared.httpProxy || process.env.HTTPS_PROXY || "";
  const env = {
    OWNER_TELEGRAM_ID: shared.ownerTelegramId != null ? String(shared.ownerTelegramId) : "",
    TELEGRAM_BOT_TOKEN: backendConfig.telegramBotToken || "",
    HTTPS_PROXY: resolvedHttpProxy,
    NO_PROXY: resolvedHttpProxy ? "localhost,127.0.0.1" : "",
    CC_CWD: resolvePathMaybe(baseDir, shared.cwd || process.env.HOME || REPO_DIR),
    DEFAULT_VERBOSE_LEVEL: String(shared.defaultVerboseLevel ?? 1),
    BRIDGE_EXECUTOR: String(shared.executor || "direct"),
    DEFAULT_BACKEND: selectedBackend,
    ENABLED_BACKENDS: selectedBackend,
    ENABLE_GROUP_SHARED_CONTEXT: String(shared.enableGroupSharedContext ?? true),
    DISCUSS_CHAT_IDS: normalizeChatIdList(shared.discussChatIds).join(","),
    GROUP_CONTEXT_MAX_MESSAGES: String(shared.groupContextMaxMessages ?? 30),
    GROUP_CONTEXT_MAX_TOKENS: String(shared.groupContextMaxTokens ?? 3000),
    GROUP_CONTEXT_TTL_MS: String(shared.groupContextTtlMs ?? 1200000),
    TRIGGER_DEDUP_TTL_MS: String(shared.triggerDedupTtlMs ?? 300000),
    SESSION_TIMEOUT_MS: String(shared.sessionTimeoutMs ?? 900000),
    // 单次查询硬超时（毫秒）：backends.<name>.timeoutMs，留空 = adapter 默认（cli-agent 600s）。
    // kimi 长任务（mutual-review 实测 12–15min）建议 1800000。
    BACKEND_TIMEOUT_MS: String(backendConfig.timeoutMs ?? ""),
    SESSIONS_DB: resolvePathMaybe(baseDir, backendConfig.sessionsDb || `${selectedBackend}.db`),
    TASKS_DB: resolvePathMaybe(baseDir, shared.tasksDb || `tasks-${selectedBackend}.db`),
    TASK_RETENTION_DAYS: String(shared.taskRetentionDays ?? 14),
    TASK_RETENTION_MIN_ROWS: String(shared.taskRetentionMinRows ?? 200),
    SHARED_CONTEXT_BACKEND: shared.sharedContextBackend || "sqlite",
    SHARED_CONTEXT_DB: resolvePathMaybe(baseDir, shared.sharedContextDb || "shared-context.db"),
    SHARED_CONTEXT_JSON_PATH: resolvePathMaybe(baseDir, shared.sharedContextJsonPath || "shared-context.json"),
    SHARED_CONTEXT_REDIS_URL: shared.redisUrl || "",

    // A2A 配置
    A2A_ENABLED: String(shared.a2aEnabled ?? false),
    A2A_PORT: String(shared.a2aPorts?.[selectedBackend] ?? 0),
    A2A_PEERS: Object.entries(shared.a2aPorts || {})
      .filter(([name]) => name !== selectedBackend)
      .filter(([name]) => config.backends?.[name]?.enabled !== false)
      .map(([name, port]) => `${name}:http://localhost:${port}`)
      .join(","),
    A2A_TOOL_MODE: normalizeA2AToolMode(shared.a2aToolMode),
    A2A_COOLDOWN_MS: String(shared.a2aCooldownMs ?? 60000),
    A2A_MAX_RESPONSES_PER_WINDOW: String(shared.a2aMaxResponsesPerWindow ?? 3),
    A2A_WINDOW_MS: String(shared.a2aWindowMs ?? 300000),
    A2A_CIRCUIT_BREAKER_THRESHOLD: String(shared.a2aCircuitBreakerThreshold ?? 3),
    A2A_CIRCUIT_BREAKER_RESET_MS: String(shared.a2aCircuitBreakerResetMs ?? 30000),

    // Streaming Preview
    STREAM_PREVIEW_ENABLED: String(shared.streamPreviewEnabled ?? true),
    STREAM_PREVIEW_INTERVAL_MS: String(shared.streamPreviewIntervalMs ?? 700),
    STREAM_PREVIEW_MIN_DELTA_CHARS: String(shared.streamPreviewMinDeltaChars ?? 20),
    STREAM_PREVIEW_MAX_CHARS: String(shared.streamPreviewMaxChars ?? 3900),
    STREAM_PREVIEW_ACTIVATION_CHARS: String(shared.streamPreviewActivationChars ?? 50),
    // 限流
    RATE_LIMIT_MAX_REQUESTS: String(shared.rateLimitMaxRequests ?? 10),
    RATE_LIMIT_WINDOW_MS: String(shared.rateLimitWindowMs ?? 60000),
    // Idle 监控
    IDLE_TIMEOUT_MS: String(shared.idleTimeoutMs ?? 1800000),
    RESET_ON_IDLE_MS: String(shared.resetOnIdleMs ?? 0),
    // Cron
    CRON_ENABLED: String(shared.cronEnabled ?? true),
    CRON_MAX_JOBS: String(shared.cronMaxJobs ?? 10),
    CRON_DEFAULT_TIMEOUT_MS: String(shared.cronDefaultTimeoutMs ?? 600000),
  };

  if (selectedBackend === "claude") {
    env.CC_MODEL = backendConfig.model || "opus";
    env.CC_PERMISSION_MODE = backendConfig.permissionMode || "default";
    env.DEFAULT_EFFORT = backendConfig.defaultEffort || "";
  }

  if (selectedBackend === "codex") {
    env.CODEX_MODEL = backendConfig.model || "";
    env.CODEX_SERVICE_TIER = backendConfig.serviceTier || "";
    env.CODEX_TRANSPORT = backendConfig.transport || "sdk";
    env.DEFAULT_EFFORT = backendConfig.defaultEffort || "";
  }

  if (selectedBackend === "gemini") {
    env.GEMINI_MODEL = backendConfig.model || "gemini-2.5-pro";
    env.GEMINI_OAUTH_CLIENT_ID = backendConfig.oauthClientId || "";
    env.GEMINI_OAUTH_CLIENT_SECRET = backendConfig.oauthClientSecret || "";
    env.GOOGLE_CLOUD_PROJECT = backendConfig.googleCloudProject || "";
  }

  return env;
}

export function validateConfig(config, options = {}) {
  const issues = [];
  const selectedBackend = normalizeBackendName(options.backend);
  const shared = config?.shared;

  if (!shared || typeof shared !== "object") {
    pushIssue(issues, "shared", "is required.");
    return issues;
  }

  if (!looksLikeTelegramUserId(shared.ownerTelegramId)) {
    pushIssue(issues, "shared.ownerTelegramId", "must be a numeric Telegram user ID.");
  }
  if (!isNonEmptyString(shared.cwd)) {
    pushIssue(issues, "shared.cwd", "must be set.");
  }
  if (!Number.isInteger(shared.defaultVerboseLevel) || shared.defaultVerboseLevel < 0 || shared.defaultVerboseLevel > 2) {
    pushIssue(issues, "shared.defaultVerboseLevel", "must be an integer between 0 and 2.");
  }
  if (!AVAILABLE_EXECUTORS.includes(String(shared.executor || "").trim().toLowerCase())) {
    pushIssue(
      issues,
      "shared.executor",
      `must be one of: ${AVAILABLE_EXECUTORS.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(shared.tasksDb)) {
    pushIssue(issues, "shared.tasksDb", "must be set.");
  }
  validatePositiveIntegerField(issues, "shared.taskRetentionDays", shared.taskRetentionDays);
  validatePositiveIntegerField(issues, "shared.taskRetentionMinRows", shared.taskRetentionMinRows);
  if (typeof shared.enableGroupSharedContext !== "boolean") {
    pushIssue(issues, "shared.enableGroupSharedContext", "must be true or false.");
  }
  const discussChatIds = parseChatIdList(shared.discussChatIds);
  if (!Array.isArray(shared.discussChatIds)) {
    pushIssue(issues, "shared.discussChatIds", "must be an array of Telegram chat IDs.");
  } else if (!discussChatIds.every(looksLikeTelegramChatId)) {
    pushIssue(issues, "shared.discussChatIds", "must contain only numeric Telegram chat IDs.");
  }
  validatePositiveIntegerField(issues, "shared.groupContextMaxMessages", shared.groupContextMaxMessages);
  validatePositiveIntegerField(issues, "shared.groupContextMaxTokens", shared.groupContextMaxTokens);
  validatePositiveIntegerField(issues, "shared.groupContextTtlMs", shared.groupContextTtlMs);
  validatePositiveIntegerField(issues, "shared.triggerDedupTtlMs", shared.triggerDedupTtlMs);
  validatePositiveIntegerField(issues, "shared.sessionTimeoutMs", shared.sessionTimeoutMs);
  const validContextBackends = ["sqlite", "json", "redis"];
  if (shared.sharedContextBackend && !validContextBackends.includes(shared.sharedContextBackend)) {
    pushIssue(issues, "shared.sharedContextBackend", `must be one of: ${validContextBackends.join(", ")}.`);
  }
  if (shared.sharedContextBackend === "redis" && !isNonEmptyString(shared.redisUrl)) {
    pushIssue(issues, "shared.redisUrl", "must be set when sharedContextBackend is redis.");
  }
  if (!A2A_TOOL_MODES.includes(String(shared.a2aToolMode || "").trim())) {
    pushIssue(issues, "shared.a2aToolMode", `must be one of: ${A2A_TOOL_MODES.join(", ")}.`);
  }
  validatePositiveIntegerField(issues, "shared.a2aCircuitBreakerThreshold", shared.a2aCircuitBreakerThreshold);
  validatePositiveIntegerField(issues, "shared.a2aCircuitBreakerResetMs", shared.a2aCircuitBreakerResetMs);

  const backends = config?.backends;
  if (!backends || typeof backends !== "object") {
    pushIssue(issues, "backends", "is required.");
    return issues;
  }

  const targets = selectedBackend && AVAILABLE_BACKENDS.includes(selectedBackend)
    ? [selectedBackend]
    : AVAILABLE_BACKENDS.filter((name) => backends[name]?.enabled);

  if (!targets.length) {
    pushIssue(issues, "backends", "at least one backend must be enabled.");
  }

  for (const backend of targets) {
    const backendConfig = backends[backend];
    if (!backendConfig || typeof backendConfig !== "object") {
      pushIssue(issues, `backends.${backend}`, "is required.");
      continue;
    }
    if (backendConfig.enabled === false) {
      pushIssue(issues, `backends.${backend}.enabled`, "must be true for the selected backend.");
      continue;
    }
    if (typeof backendConfig.enabled !== "boolean") {
      pushIssue(issues, `backends.${backend}.enabled`, "must be true or false.");
    }
    if (!looksLikeTelegramBotToken(backendConfig.telegramBotToken)) {
      pushIssue(
        issues,
        `backends.${backend}.telegramBotToken`,
        "must be a real Telegram bot token, not an empty or placeholder value.",
      );
    }
    if (!isNonEmptyString(backendConfig.sessionsDb)) {
      pushIssue(issues, `backends.${backend}.sessionsDb`, "must be set.");
    }

    if (backend === "claude" && !CLAUDE_PERMISSION_MODES.includes(String(backendConfig.permissionMode || "").trim())) {
      pushIssue(
        issues,
        "backends.claude.permissionMode",
        `must be one of: ${CLAUDE_PERMISSION_MODES.join(", ")}.`,
      );
    }
    if (backend === "codex" && !CODEX_TRANSPORTS.includes(String(backendConfig.transport || "sdk").trim())) {
      pushIssue(issues, `backends.${backend}.transport`, `must be one of: ${CODEX_TRANSPORTS.join(", ")}.`);
    }

    if (backend === "gemini") {
      if (!isNonEmptyString(backendConfig.oauthClientId)) {
        pushIssue(issues, "backends.gemini.oauthClientId", "must be set when Gemini is enabled.");
      }
      if (!isNonEmptyString(backendConfig.oauthClientSecret)) {
        pushIssue(issues, "backends.gemini.oauthClientSecret", "must be set when Gemini is enabled.");
      }
    }
  }

  const seenTokens = new Map();
  for (const backend of AVAILABLE_BACKENDS) {
    const token = String(backends[backend]?.telegramBotToken || "").trim();
    if (backends[backend]?.enabled !== true || !token) continue;
    if (seenTokens.has(token)) {
      pushIssue(
        issues,
        `backends.${backend}.telegramBotToken`,
        `duplicates the bot token used by ${seenTokens.get(token)}. Use one bot token per backend.`,
      );
    } else {
      seenTokens.set(token, `backends.${backend}.telegramBotToken`);
    }
  }

  return issues;
}

export function validateResolvedEnv(env, options = {}) {
  const issues = [];
  const selectedBackend = normalizeBackendName(options.backend || env.DEFAULT_BACKEND);
  const effectiveCwd = isNonEmptyString(env.CC_CWD) ? env.CC_CWD : homeDir();

  if (!AVAILABLE_BACKENDS.includes(selectedBackend)) {
    pushIssue(issues, "DEFAULT_BACKEND", `must be one of: ${AVAILABLE_BACKENDS.join(", ")}.`);
  }
  if (!looksLikeTelegramUserId(env.OWNER_TELEGRAM_ID)) {
    pushIssue(issues, "OWNER_TELEGRAM_ID", "must be a numeric Telegram user ID.");
  }
  if (!looksLikeTelegramBotToken(env.TELEGRAM_BOT_TOKEN)) {
    pushIssue(issues, "TELEGRAM_BOT_TOKEN", "must be a real Telegram bot token, not an empty or placeholder value.");
  }

  ensureExistingDirectory(issues, "CC_CWD", effectiveCwd);
  if (isNonEmptyString(env.SESSIONS_DB)) {
    ensureParentDirectoryExists(issues, "SESSIONS_DB", env.SESSIONS_DB);
  }
  if (isNonEmptyString(env.TASKS_DB)) {
    ensureParentDirectoryExists(issues, "TASKS_DB", env.TASKS_DB);
  }

  const verbose = parseInteger(env.DEFAULT_VERBOSE_LEVEL);
  if (env.DEFAULT_VERBOSE_LEVEL != null && String(env.DEFAULT_VERBOSE_LEVEL).trim() !== "" && (verbose == null || verbose < 0 || verbose > 2)) {
    pushIssue(issues, "DEFAULT_VERBOSE_LEVEL", "must be an integer between 0 and 2.");
  }
  if (isNonEmptyString(env.BRIDGE_EXECUTOR) && !AVAILABLE_EXECUTORS.includes(String(env.BRIDGE_EXECUTOR).trim().toLowerCase())) {
    pushIssue(issues, "BRIDGE_EXECUTOR", `must be one of: ${AVAILABLE_EXECUTORS.join(", ")}.`);
  }

  const enabledBackends = String(env.ENABLED_BACKENDS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!enabledBackends.length) {
    pushIssue(issues, "ENABLED_BACKENDS", "must contain at least one backend.");
  } else if (!enabledBackends.every((value) => AVAILABLE_BACKENDS.includes(value))) {
    pushIssue(issues, "ENABLED_BACKENDS", `must only contain: ${AVAILABLE_BACKENDS.join(", ")}.`);
  } else if (!enabledBackends.includes(selectedBackend)) {
    pushIssue(issues, "ENABLED_BACKENDS", `must include the selected backend: ${selectedBackend}.`);
  }

  if (isNonEmptyString(env.GROUP_CONTEXT_MAX_MESSAGES)) {
    validatePositiveIntegerField(issues, "GROUP_CONTEXT_MAX_MESSAGES", env.GROUP_CONTEXT_MAX_MESSAGES);
  }
  if (isNonEmptyString(env.GROUP_CONTEXT_MAX_TOKENS)) {
    validatePositiveIntegerField(issues, "GROUP_CONTEXT_MAX_TOKENS", env.GROUP_CONTEXT_MAX_TOKENS);
  }
  if (isNonEmptyString(env.GROUP_CONTEXT_TTL_MS)) {
    validatePositiveIntegerField(issues, "GROUP_CONTEXT_TTL_MS", env.GROUP_CONTEXT_TTL_MS);
  }
  if (isNonEmptyString(env.TRIGGER_DEDUP_TTL_MS)) {
    validatePositiveIntegerField(issues, "TRIGGER_DEDUP_TTL_MS", env.TRIGGER_DEDUP_TTL_MS);
  }
  if (isNonEmptyString(env.SESSION_TIMEOUT_MS)) {
    validatePositiveIntegerField(issues, "SESSION_TIMEOUT_MS", env.SESSION_TIMEOUT_MS);
  }
  if (
    isNonEmptyString(env.DISCUSS_CHAT_IDS)
    && !String(env.DISCUSS_CHAT_IDS)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .every(looksLikeTelegramChatId)
  ) {
    pushIssue(issues, "DISCUSS_CHAT_IDS", "must contain only numeric Telegram chat IDs.");
  }

  if (
    selectedBackend === "claude"
    && isNonEmptyString(env.CC_PERMISSION_MODE)
    && !CLAUDE_PERMISSION_MODES.includes(String(env.CC_PERMISSION_MODE).trim())
  ) {
    pushIssue(issues, "CC_PERMISSION_MODE", `must be one of: ${CLAUDE_PERMISSION_MODES.join(", ")}.`);
  }

  if (selectedBackend === "gemini") {
    if (!isNonEmptyString(env.GEMINI_OAUTH_CLIENT_ID)) {
      pushIssue(issues, "GEMINI_OAUTH_CLIENT_ID", "must be set when Gemini is enabled.");
    }
    if (!isNonEmptyString(env.GEMINI_OAUTH_CLIENT_SECRET)) {
      pushIssue(issues, "GEMINI_OAUTH_CLIENT_SECRET", "must be set when Gemini is enabled.");
    }
  }

  return issues;
}

export function formatValidationIssues(issues, heading = "Invalid configuration") {
  if (!issues.length) return heading;
  return [
    heading,
    ...issues.map((issue, index) => `${index + 1}. ${issue.path}: ${issue.message}`),
  ].join("\n");
}

export function inspectRuntime(runtime, options = {}) {
  const warnings = [];
  const errors = validateResolvedEnv(runtime.env, { backend: runtime.backend });
  const cwd = isNonEmptyString(runtime.env.CC_CWD) ? runtime.env.CC_CWD : homeDir();
  const sessionsDb = isNonEmptyString(runtime.env.SESSIONS_DB)
    ? runtime.env.SESSIONS_DB
    : join(REPO_DIR, "sessions.db");
  const tasksDb = isNonEmptyString(runtime.env.TASKS_DB)
    ? runtime.env.TASKS_DB
    : join(REPO_DIR, "tasks.db");

  const credentialCheck = getBackendCredentialWarning(runtime.backend);
  if (!existsSync(credentialCheck.path)) {
    warnings.push({
      path: credentialCheck.path,
      message: credentialCheck.message,
    });
  }

  // 后端 CLI 探活：CLI 缺失时 check 给明确 warning，否则配置过了 check、运行时才炸 + KeepAlive 静默崩溃循环
  const cli = checkBackendCliAvailable(runtime.backend, options);
  if (!cli.ok) {
    warnings.push({
      path: `cli:${cli.name}`,
      message: `${cli.name} CLI not found (${cli.probe}). The ${runtime.backend} backend invokes it under the hood — check validates config shape only, it cannot confirm the backend will actually start.`,
    });
  }

  return {
    backend: runtime.backend,
    source: runtime.source,
    configPath: runtime.configPath,
    cwd,
    sessionsDb,
    tasksDb,
    errors,
    warnings,
  };
}

export function bootstrapWorkspace(options = {}) {
  const selectedBackend = normalizeBackendName(options.backend || "claude");
  if (!AVAILABLE_BACKENDS.includes(selectedBackend)) {
    throw new Error(`Unsupported backend: ${selectedBackend}`);
  }

  const configPath = options.configPath ? resolve(options.configPath) : DEFAULT_CONFIG_PATH;
  const filesDir = join(dirname(configPath), "files");
  const alreadyExists = existsSync(configPath);

  if (alreadyExists && !options.force) {
    mkdirSync(filesDir, { recursive: true });
    return {
      created: false,
      overwritten: false,
      configPath,
      filesDir,
      backend: selectedBackend,
    };
  }

  const config = createBootstrapConfig(selectedBackend);
  writePrivateConfig(configPath, config);
  mkdirSync(filesDir, { recursive: true });

  return {
    created: true,
    overwritten: alreadyExists,
    configPath,
    filesDir,
    backend: selectedBackend,
    config,
  };
}

export function resolveCliArgs(argv) {
  const args = argv.slice(2);
  let command = "start";
  let backend = "claude";
  let backendSpecified = false;
  let configPath = process.env.BRIDGE_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  let help = false;
  let force = false;

  if (args[0] && !args[0].startsWith("-")) {
    command = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--backend" || arg === "-b") {
      if (!args[index + 1]) {
        throw new Error(`${arg} requires a backend name.`);
      }
      backend = normalizeBackendName(args[index + 1]);
      backendSpecified = true;
      index += 1;
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      if (!args[index + 1]) {
        throw new Error(`${arg} requires a file path.`);
      }
      configPath = resolve(REPO_DIR, args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--force" || arg === "-f") {
      force = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    command,
    backend,
    backendSpecified,
    configPath: resolve(configPath),
    help,
    force,
  };
}

export function loadRuntimeConfig(options = {}) {
  const backend = normalizeBackendName(options.backend);
  const configPath = options.configPath ? resolve(options.configPath) : DEFAULT_CONFIG_PATH;

  if (!existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}. Run \`bun run bootstrap --backend ${backend}\` or \`bun run setup --backend ${backend}\`.`);
  }

  const config = parseJsonConfig(configPath);
  const configIssues = validateConfig(config, { backend, configPath });
  if (configIssues.length) {
    throw new Error(formatValidationIssues(configIssues, `Invalid config file: ${configPath}`));
  }

  const runtime = {
    backend,
    configPath,
    source: configPath.split("/").pop(),
    env: buildEnvFromConfig(config, backend, configPath),
    config,
  };
  const runtimeIssues = validateResolvedEnv(runtime.env, { backend });
  if (runtimeIssues.length) {
    throw new Error(formatValidationIssues(runtimeIssues, `Invalid runtime configuration for backend "${backend}"`));
  }
  return runtime;
}

export function applyRuntimeEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (value != null) {
      process.env[key] = String(value);
    }
  }
}

function redactValue(key, value) {
  if (!value) return value;
  const secretLike = /(TOKEN|SECRET|PASSWORD)/i.test(key);
  if (!secretLike) return value;
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function summarizeRuntime(runtime) {
  const profile = getBackendProfile(runtime.backend);
  return {
    source: runtime.source,
    backend: runtime.backend,
    backendProfile: {
      label: profile.label,
      maturity: profile.maturity,
      summary: profile.summary,
    },
    configPath: runtime.configPath,
    env: Object.fromEntries(
      Object.entries(runtime.env).map(([key, value]) => [key, redactValue(key, value)]),
    ),
  };
}

function inferEnabled(config, backend) {
  const backendConfig = config.backends?.[backend];
  if (!backendConfig) return false;
  return Boolean(backendConfig.enabled || backendConfig.telegramBotToken);
}

async function askText(rl, label, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const value = (await rl.question(`${label}${suffix}: `)).trim();
  return value || defaultValue;
}

async function askBoolean(rl, label, defaultValue) {
  const suffix = defaultValue ? " [Y/n]" : " [y/N]";
  while (true) {
    const value = (await rl.question(`${label}${suffix}: `)).trim().toLowerCase();
    if (!value) return defaultValue;
    if (["y", "yes"].includes(value)) return true;
    if (["n", "no"].includes(value)) return false;
  }
}

export async function runSetupWizard(options = {}) {
  const configPath = options.configPath ? resolve(options.configPath) : DEFAULT_CONFIG_PATH;
  const backendOnly = options.backend ? normalizeBackendName(options.backend) : null;
  const existing = existsSync(configPath) ? parseJsonConfig(configPath) : createDefaultConfig();
  const config = mergeConfig(createDefaultConfig(), existing);
  const rl = createInterface({ input, output });

  try {
    console.log("Telegram AI Bridge setup wizard\n");
    console.log(`Config file: ${configPath}`);
    console.log("Press Enter to keep the current value.\n");

    config.shared.ownerTelegramId = await askText(
      rl,
      "Owner Telegram user ID",
      String(config.shared.ownerTelegramId || ""),
    );
    config.shared.cwd = await askText(rl, "Working directory", config.shared.cwd || process.env.HOME || REPO_DIR);
    config.shared.httpProxy = await askText(rl, "HTTPS proxy (optional)", config.shared.httpProxy || "");
    config.shared.defaultVerboseLevel = Number(
      await askText(rl, "Default verbose level", String(config.shared.defaultVerboseLevel ?? 1)),
    );
    config.shared.executor = await askText(
      rl,
      "Executor mode (direct/local-agent)",
      config.shared.executor || "direct",
    );
    config.shared.tasksDb = await askText(
      rl,
      "Tasks SQLite path",
      config.shared.tasksDb || "tasks.db",
    );

    const targets = backendOnly ? [backendOnly] : AVAILABLE_BACKENDS;
    for (const backend of targets) {
      const profile = getBackendProfile(backend);
      console.log(`\n[${backend}]`);
      if (profile.summary) {
        console.log(`${profile.label}: ${profile.summary}`);
      }
      const current = config.backends[backend] || {};
      const enabledDefault = inferEnabled(config, backend);
      const enableLabel = profile.maturity === "experimental"
        ? `Enable ${backend} bot (experimental compatibility)`
        : `Enable ${backend} bot`;
      current.enabled = await askBoolean(rl, enableLabel, enabledDefault);
      config.backends[backend] = current;

      if (!current.enabled) continue;

      current.telegramBotToken = await askText(rl, `${backend} Telegram bot token`, current.telegramBotToken || "");
      current.sessionsDb = await askText(
        rl,
        `${backend} SQLite path`,
        current.sessionsDb || `${backend === "claude" ? "sessions" : `sessions-${backend}`}.db`,
      );

      if (backend === "claude") {
        current.model = await askText(rl, "Claude model", current.model || "opus");
        current.defaultEffort = await askText(rl, "Default effort (low/medium/high/xhigh/max, empty=high)", current.defaultEffort || "");
        current.permissionMode = await askText(rl, "Claude permission mode", current.permissionMode || "default");
      }

      if (backend === "codex") {
        current.model = await askText(rl, "Codex model (optional)", current.model || "");
        current.transport = await askText(rl, "Codex transport (sdk/app-server)", current.transport || "sdk");
      }

      if (backend === "gemini") {
        console.log("Gemini stays available, but this repo now treats it as a compatibility backend instead of a primary path.");
        current.model = await askText(rl, "Gemini model", current.model || "gemini-2.5-pro");
        current.oauthClientId = await askText(rl, "Gemini OAuth client ID", current.oauthClientId || "");
        current.oauthClientSecret = await askText(rl, "Gemini OAuth client secret", current.oauthClientSecret || "");
        current.googleCloudProject = await askText(rl, "Google Cloud project (optional)", current.googleCloudProject || "");
      }
    }
  } finally {
    rl.close();
  }

  const issues = validateConfig(config, { backend: backendOnly, configPath });
  if (issues.length) {
    throw new Error(formatValidationIssues(issues, "Setup aborted because the config is still incomplete"));
  }

  writePrivateConfig(configPath, config);
  return { configPath, config };
}
