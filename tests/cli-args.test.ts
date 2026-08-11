// ============================================================
// CLI args parser tests (#134)
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, validateAgentId } from "../src/cli-args.js";

describe("parseCliArgs", () => {
  it("returns undefined for both when no flags present", () => {
    const result = parseCliArgs(["node", "chorusgate", "run"]);
    assert.equal(result.agentId, undefined);
    assert.equal(result.envFile, undefined);
  });

  it("parses --agent with space separator", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--agent", "claude"]);
    assert.equal(result.agentId, "claude");
  });

  it("parses --agent with equals separator", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--agent=codex"]);
    assert.equal(result.agentId, "codex");
  });

  it("parses --env-file with space separator", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--env-file", "/tmp/test.env"]);
    assert.equal(result.envFile, "/tmp/test.env");
  });

  it("parses --env-file with equals separator", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--env-file=/tmp/test.env"]);
    assert.equal(result.envFile, "/tmp/test.env");
  });

  it("parses both --agent and --env-file together", () => {
    const result = parseCliArgs([
      "node", "chorusgate", "start",
      "--agent", "claude",
      "--env-file", "/tmp/override.env",
    ]);
    assert.equal(result.agentId, "claude");
    assert.equal(result.envFile, "/tmp/override.env");
  });

  it("parses flags before the command (e.g. chorusgate --agent claude run)", () => {
    const result = parseCliArgs(["node", "chorusgate", "--agent", "hermes", "run"]);
    assert.equal(result.agentId, "hermes");
  });

  it("ignores unknown flags", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--verbose", "--agent", "claude"]);
    assert.equal(result.agentId, "claude");
  });
});

describe("validateAgentId", () => {
  it("accepts valid lowercase ids", () => {
    assert.doesNotThrow(() => validateAgentId("claude"));
    assert.doesNotThrow(() => validateAgentId("codex"));
    assert.doesNotThrow(() => validateAgentId("hermes"));
    assert.doesNotThrow(() => validateAgentId("openclaw"));
    assert.doesNotThrow(() => validateAgentId("default"));
  });

  it("accepts ids with dashes and underscores", () => {
    assert.doesNotThrow(() => validateAgentId("my-agent"));
    assert.doesNotThrow(() => validateAgentId("agent_2"));
    assert.doesNotThrow(() => validateAgentId("a-1_b"));
  });

  it("rejects ids with uppercase letters", () => {
    assert.throws(() => validateAgentId("Claude"), /Invalid --agent value/);
    assert.throws(() => validateAgentId("CODEX"), /Invalid --agent value/);
  });

  it("rejects ids with special characters", () => {
    assert.throws(() => validateAgentId("Invalid_ID!"), /Invalid --agent value/);
    assert.throws(() => validateAgentId("agent@test"), /Invalid --agent value/);
    assert.throws(() => validateAgentId("agent test"), /Invalid --agent value/);
  });

  it("rejects empty or whitespace-only ids", () => {
    assert.throws(() => validateAgentId(""), /empty string/);
    assert.throws(() => validateAgentId("   "), /Invalid --agent value/);
  });

  it("rejects path traversal via slashes", () => {
    assert.throws(() => validateAgentId("../../../etc/passwd"), /path traversal/);
    assert.throws(() => validateAgentId("claude/../secret"), /path traversal/);
    assert.throws(() => validateAgentId("a\\b"), /path traversal/);
  });

  it("rejects path traversal via double dots alone", () => {
    assert.throws(() => validateAgentId("claude..secret"), /"\.\."/);
  });

  it("rejects ids over 64 characters", () => {
    const long = "a".repeat(65);
    assert.throws(() => validateAgentId(long), /Invalid --agent value/);
  });

  it("accepts ids at exactly 64 characters", () => {
    const max = "a".repeat(64);
    assert.doesNotThrow(() => validateAgentId(max));
  });
});

describe("parseCliArgs validation integration", () => {
  it("throws on invalid agent-id via --agent flag", () => {
    assert.throws(
      () => parseCliArgs(["node", "chorusgate", "run", "--agent", "Invalid_ID!"]),
      /Invalid --agent value/,
    );
  });

  it("throws on path traversal in --agent", () => {
    assert.throws(
      () => parseCliArgs(["node", "chorusgate", "run", "--agent", "../../../etc/passwd"]),
      /path traversal/,
    );
  });
});
