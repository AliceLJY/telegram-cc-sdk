import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// 2026-09-06 巡检：运行时文案与源码注释里曾出现作者自己的 bot 实例名与本机路径。
// 这里把「不该出现在公开仓里的东西」写成回归测试，随 bun test 在 CI 自动拦。
// 正则全部用字符串拼接写，避免本文件自己被匹配到。
const ROOT = fileURLToPath(new URL("./", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SCAN_DIRS = ["commands", "adapters", "executor", "agent", "a2a", "shared-context", "scripts", "launchd", "docs"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

const FORBIDDEN_PATTERNS = [
  // 作者部署里的实例名 / bot 用户名
  "mc" + "code",
  "mc" + "odex",
  "ma" + "gy",
  "ClCO" + "best",
  // 作者本机的 launchd label 前缀
  "com\\." + "anxianjingya",
  // 真实 home 路径；放过通用占位符 /Users/you、/Users/user、/Users/x(xx)、/Users/<name>
  "/Users" + "/(?!you\\b|user\\b|x{1,3}\\b|<)",
];
const FORBIDDEN = new RegExp(FORBIDDEN_PATTERNS.join("|"));

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function collectPublicSources() {
  const files = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".js") || /^README.*\.md$/.test(entry.name)) files.push(join(ROOT, entry.name));
  }
  for (const dir of SCAN_DIRS) {
    const full = join(ROOT, dir);
    if (existsSync(full)) walk(full, files);
  }
  return files.filter((file) => file !== SELF);
}

describe("privacy contract", () => {
  test("public sources carry no deployment-specific instance names or private paths", () => {
    const files = collectPublicSources();
    expect(files.length).toBeGreaterThan(0);
    const offenders = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (FORBIDDEN.test(line)) offenders.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
