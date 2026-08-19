// ============================================================
// CLI args parser tests (#134)
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, validateAgentId, validateEnvFilePath } from "../src/cli-args.js";

describe("parseCliArgs", () => {
  it("parses --init for automatic profile initialization", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--agent", "claude", "--init"]);
    assert.equal(result.agentId, "claude");
    assert.equal(result.initialize, true);
  });
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

  it("parses --env-file with space separator (absolute path)", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--env-file", "/tmp/test.env"]);
    assert.equal(result.envFile, "/tmp/test.env");
  });

  it("parses --env-file with equals separator (absolute path)", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--env-file=/tmp/test.env"]);
    assert.equal(result.envFile, "/tmp/test.env");
  });

  it("throws when --agent and --env-file are both specified (mutual exclusion)", () => {
    assert.throws(
      () => parseCliArgs([
        "node", "chorusgate", "start",
        "--agent", "claude",
        "--env-file", "/tmp/override.env",
      ]),
      /mutually exclusive/,
    );
  });

  it("parses flags before the command (e.g. chorusgate --agent claude run)", () => {
    const result = parseCliArgs(["node", "chorusgate", "--agent", "hermes", "run"]);
    assert.equal(result.agentId, "hermes");
  });

  it("ignores unknown flags", () => {
    const result = parseCliArgs(["node", "chorusgate", "run", "--verbose", "--agent", "claude"]);
    assert.equal(result.agentId, "claude");
  });

  it("rejects relative --env-file paths", () => {
    assert.throws(
      () => parseCliArgs(["node", "chorusgate", "run", "--env-file", "./.env"]),
      /relative path/,
    );
  });

  it("rejects relative --env-file with equals form", () => {
    assert.throws(
      () => parseCliArgs(["node", "chorusgate", "run", "--env-file=chorusgate.env"]),
      /relative path/,
    );
  });

  it("accepts Windows absolute paths for --env-file", () => {
    // isAbsolute on POSIX: "C:\\tmp\\.env" is relative (it's not a /-prefixed path)
    // but on Windows it's absolute. We test with a /-prefixed path which is
    // absolute on both platforms.
    const result = parseCliArgs(["node", "chorusgate", "run", "--env-file", "/home/user/.env"]);
    assert.equal(result.envFile, "/home/user/.env");
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

describe("validateEnvFilePath", () => {
  it("accepts absolute POSIX paths", () => {
    assert.doesNotThrow(() => validateEnvFilePath("/home/user/.env"));
    assert.doesNotThrow(() => validateEnvFilePath("/tmp/chorusgate.env"));
  });

  it("rejects relative paths", () => {
    assert.throws(() => validateEnvFilePath(".env"), /relative path/);
    assert.throws(() => validateEnvFilePath("./.env"), /relative path/);
    assert.throws(() => validateEnvFilePath("../config.env"), /relative path/);
    assert.throws(() => validateEnvFilePath("chorusgate.env"), /relative path/);
  });

  it("rejects empty paths", () => {
    assert.throws(() => validateEnvFilePath(""), /relative path/);
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

  it("throws on relative --env-file", () => {
    assert.throws(
      () => parseCliArgs(["node", "chorusgate", "run", "--env-file", ".env"]),
      /relative path/,
    );
  });

  it("throws on mutual exclusion", () => {
    assert.throws(
      () => parseCliArgs(["node", "chorusgate", "run", "--agent", "claude", "--env-file", "/tmp/x.env"]),
      /mutually exclusive/,
    );
  });
});

describe("parseCliArgs log command flags (#141)", () => {
  it("parses --lines with space and equals separators", () => {
    assert.equal(parseCliArgs(["node", "chorusgate", "log", "--lines", "100"]).lines, 100);
    assert.equal(parseCliArgs(["node", "chorusgate", "log", "--lines=25"]).lines, 25);
  });

  it("parses -n short form", () => {
    assert.equal(parseCliArgs(["node", "chorusgate", "log", "-n", "10"]).lines, 10);
  });

  it("defaults lines to undefined (command applies default 50)", () => {
    assert.equal(parseCliArgs(["node", "chorusgate", "log"]).lines, undefined);
  });

  it("parses --follow and -f", () => {
    assert.equal(parseCliArgs(["node", "chorusgate", "log", "--follow"]).follow, true);
    assert.equal(parseCliArgs(["node", "chorusgate", "log", "-f"]).follow, true);
  });

  it("combines --agent + --lines + --follow", () => {
    const r = parseCliArgs(["node", "chorusgate", "log", "--agent", "codex", "--lines", "5", "--follow"]);
    assert.equal(r.agentId, "codex");
    assert.equal(r.lines, 5);
    assert.equal(r.follow, true);
  });

  it("does not affect start/stop flag parsing", () => {
    const r = parseCliArgs(["node", "chorusgate", "start", "--agent", "claude"]);
    assert.equal(r.agentId, "claude");
    assert.equal(r.lines, undefined);
    assert.equal(r.follow, false);
  });

  it("ignores a trailing --lines with no value", () => {
    const r = parseCliArgs(["node", "chorusgate", "log", "--lines"]);
    assert.equal(r.lines, undefined);
  });

  it("parses a non-numeric --lines as NaN (the command clamps it)", () => {
    const r = parseCliArgs(["node", "chorusgate", "log", "--lines=abc"]);
    assert.equal(Number.isNaN(r.lines), true);
  });

  it("ignores a trailing -n with no value", () => {
    const r = parseCliArgs(["node", "chorusgate", "log", "-n"]);
    assert.equal(r.lines, undefined);
  });
});
