import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateConfig, detectAgentId } from "../src/config-migrate.js";

describe("config migrate cwd preservation", () => {
  it("adds an explicit cwd when migrating a project-local config", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorusgate-migrate-"));
    try {
      const source = join(dir, ".env");
      writeFileSync(
        source,
        "SLACK_BOT_TOKEN=xoxb-test\nSLACK_APP_TOKEN=xapp-test\n",
        "utf8",
      );

      const result = migrateConfig({
        agentId: "claude",
        from: source,
        cwd: dir,
      });

      assert.equal(result.mode, "dry-run");
      assert.ok(result.chorusgateKeys.includes("GATEWAY_CLAUDE_CWD"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a missing cwd before writing", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorusgate-migrate-"));
    try {
      const source = join(dir, ".env");
      writeFileSync(source, "SLACK_BOT_TOKEN=xoxb-test\n", "utf8");

      assert.throws(
        () => migrateConfig({
          agentId: "codex",
          from: source,
          cwd: join(dir, "missing"),
        }),
        /Working directory not found or not a directory/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// Auto-detect (acceptance review on #135):
//   - claude / codex / hermes / openclaw each detected
//   - conflicting markers → ambiguity error (fail-closed)
//   - no marker → migrateConfig errors, requires explicit --agent
//   - explicit --agent skips detection entirely
// ============================================================
describe("config migrate auto-detect agent", () => {
  it("detects claude from GATEWAY_PROVIDER", () => {
    assert.equal(detectAgentId({ GATEWAY_PROVIDER: "claude" }), "claude");
  });

  it("detects claude from claude-stream provider", () => {
    assert.equal(detectAgentId({ GATEWAY_PROVIDER: "claude-stream" }), "claude");
  });

  it("detects codex from GATEWAY_PROVIDER", () => {
    assert.equal(detectAgentId({ GATEWAY_PROVIDER: "codex" }), "codex");
  });

  it("detects hermes from GATEWAY_PROVIDER", () => {
    assert.equal(detectAgentId({ GATEWAY_PROVIDER: "hermes" }), "hermes");
  });

  it("detects openclaw from GATEWAY_PROVIDER", () => {
    assert.equal(detectAgentId({ GATEWAY_PROVIDER: "openclaw" }), "openclaw");
  });

  it("detects claude from CLAUDE_BIN marker", () => {
    assert.equal(detectAgentId({ CLAUDE_BIN: "claude" }), "claude");
  });

  it("detects codex from CODEX_BIN marker", () => {
    assert.equal(detectAgentId({ CODEX_BIN: "codex" }), "codex");
  });

  it("detects claude from Claude-specific env vars", () => {
    assert.equal(detectAgentId({ CLAUDE_STREAM_PARTIAL: "1" }), "claude");
    assert.equal(detectAgentId({ CLAUDE_PERMISSION_MODE: "acceptEdits" }), "claude");
  });

  it("returns null when no marker is present", () => {
    assert.equal(detectAgentId({ SLACK_BOT_TOKEN: "xoxb" }), null);
  });

  it("rejects claude+codex conflicting markers as ambiguous", () => {
    assert.throws(
      () => detectAgentId({ CLAUDE_BIN: "claude", CODEX_BIN: "codex" }),
      /Ambiguous agent auto-detection: markers for \[claude, codex\]/,
    );
  });

  it("rejects provider+bin conflicting markers as ambiguous", () => {
    assert.throws(
      () => detectAgentId({ GATEWAY_PROVIDER: "claude", CODEX_BIN: "codex" }),
      /Ambiguous agent auto-detection/,
    );
  });

  it("migrateConfig fails closed when no marker and no --agent", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorusgate-migrate-"));
    try {
      const source = join(dir, ".env");
      writeFileSync(source, "SLACK_BOT_TOKEN=xoxb-test\n", "utf8");
      assert.throws(
        () => migrateConfig({ from: source }),
        /Cannot auto-detect agent.*Pass --agent <id> explicitly/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrateConfig propagates ambiguity error to caller", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorusgate-migrate-"));
    try {
      const source = join(dir, ".env");
      writeFileSync(
        source,
        "CLAUDE_BIN=claude\nCODEX_BIN=codex\n",
        "utf8",
      );
      assert.throws(
        () => migrateConfig({ from: source }),
        /Ambiguous agent auto-detection/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explicit --agent skips auto-detection entirely", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorusgate-migrate-"));
    try {
      const source = join(dir, ".env");
      writeFileSync(source, "SLACK_BOT_TOKEN=xoxb-test\n", "utf8");
      const result = migrateConfig({ agentId: "hermes", from: source });
      assert.equal(result.agentId, "hermes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
