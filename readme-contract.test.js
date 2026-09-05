import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const packageManifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const configExample = JSON.parse(readFileSync(new URL("./config.example.json", import.meta.url), "utf8"));
const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");
const readmeCn = readFileSync(new URL("./README_CN.md", import.meta.url), "utf8");
const codexAppServer = readFileSync(new URL("./adapters/codex-app-server.js", import.meta.url), "utf8");
const startCli = readFileSync(new URL("./start.js", import.meta.url), "utf8");
const launchAgentInstaller = readFileSync(new URL("./scripts/install-launch-agent.sh", import.meta.url), "utf8");

describe("public documentation contract", () => {
  test("release badge and install path match the repository", () => {
    expect(packageManifest.version).toBe("5.1.1");
    expect(packageManifest.private).toBe(true);
    expect(readme).toContain("version-5.1.1");
    expect(readmeCn).toContain("version-5.1.1");
    expect(readme).toContain("historical v3.1.0 snapshot");
    expect(readmeCn).toContain("历史 v3.1.0 快照");
    expect(readme).not.toContain("v4.1");
    expect(readmeCn).not.toContain("v4.1");
  });

  test("runtime metadata and the example backend surface match the release", () => {
    expect(codexAppServer).toContain(`version: "${packageManifest.version}"`);
    expect(configExample.backends.agy?.enabled).toBe(false);
    expect(configExample.backends.kimi?.enabled).toBe(false);
    expect(configExample.shared.a2aPorts.agy).toBeNumber();
    expect(configExample.shared.a2aPorts.kimi).toBeNumber();
    expect(readme).toContain("Claude Code, Codex, Agy, and Kimi");
    expect(readmeCn).toContain("Claude Code、Codex、Agy、Kimi");
    expect(startCli).toContain("claude | codex | agy | kimi   (gemini: disabled, see README)");
    expect(launchAgentInstaller).toContain("claude | codex | agy | kimi   (gemini: disabled)");
    expect(launchAgentInstaller).toContain("claude|codex|gemini|agy|kimi)");
  });

  test("data and competitor boundaries avoid absolute claims", () => {
    expect(readme).not.toContain("Code and credentials never leave your machine");
    expect(readmeCn).not.toContain("代码和凭证不出本机");
    expect(readme).not.toContain("Provider-locked");
    expect(readmeCn).not.toContain("绑定 Provider");
    expect(readme).toContain("https://code.claude.com/docs/en/remote-control");
    expect(readme).toContain("https://code.claude.com/docs/en/channels");
    expect(readme).toContain("https://docs.openclaw.ai/providers");
  });
});
