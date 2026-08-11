// ============================================================
// CLI args parser tests (#134)
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../src/cli-args.js";

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
