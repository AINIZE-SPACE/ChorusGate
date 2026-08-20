import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatAvailableAgents,
  initializeAgentProfile,
  missingProfileKeys,
} from "../src/config-init.js";

describe("agent profile initialization", () => {
  it("creates missing directories and a starter config", () => {
    const root = mkdtempSync(join(tmpdir(), "chorusgate-init-"));
    try {
      const cwd = join(root, "project");
      const profileRoot = join(root, "profiles");
      // cwd must exist; use the temporary root as a real project directory.
      const result = initializeAgentProfile({
        agentId: "codex",
        cwd: root,
        profileRoot,
      });

      assert.equal(result.ready, false);
      assert.ok(existsSync(result.targetPath));
      const content = readFileSync(result.targetPath, "utf8");
      assert.match(content, /GATEWAY_PROVIDER=codex/);
      assert.match(content, /SLACK_BOT_TOKEN=\n/);
      assert.ok(!content.includes("undefined"));
      assert.ok(!existsSync(cwd));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("migrates an existing project env and creates parent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "chorusgate-init-"));
    try {
      const source = join(root, "legacy.env");
      const profileRoot = join(root, "missing", "profiles");
      writeFileSync(
        source,
        "SLACK_BOT_TOKEN=xoxb-test\nSLACK_APP_TOKEN=xapp-test\nGATEWAY_PROVIDER=claude-stream\n",
        "utf8",
      );

      const result = initializeAgentProfile({
        agentId: "claude",
        from: source,
        cwd: root,
        profileRoot,
      });

      assert.equal(result.ready, true);
      const content = readFileSync(result.targetPath, "utf8");
      assert.match(content, /GATEWAY_PROVIDER=claude-stream/);
      assert.match(content, /GATEWAY_CLAUDE_CWD=/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("formats known agents for spelling guidance", () => {
    assert.equal(formatAvailableAgents(["claude", "codex"]), "claude, codex");
    assert.equal(formatAvailableAgents([]), "(none)");
  });

  it("reports missing token names from an incomplete starter", () => {
    const root = mkdtempSync(join(tmpdir(), "chorusgate-init-"));
    const oldBotToken = process.env.SLACK_BOT_TOKEN;
    try {
      delete process.env.SLACK_BOT_TOKEN;
      const target = join(root, ".env");
      writeFileSync(target, "SLACK_BOT_TOKEN=\nSLACK_APP_TOKEN=xapp-test\n", "utf8");
      assert.deepEqual(missingProfileKeys(target), ["SLACK_BOT_TOKEN"]);
    } finally {
      if (oldBotToken === undefined) delete process.env.SLACK_BOT_TOKEN;
      else process.env.SLACK_BOT_TOKEN = oldBotToken;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
