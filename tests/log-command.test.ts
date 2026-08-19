// ============================================================
// log-command.test — Issue #141 `chorusgate log --agent`
//
// Drives the real gateway-control.log() against a temp CHORUSGATE_HOME
// with a seeded gateway.log. Covers: default tail 50 (AC4),
// --lines N / -n N (AC5), --agent scoping + default-agent fallback
// (AC7), and the missing-log error path.
//
// --follow (AC6) blocks by design (live tail), so it is exercised by
// 小马's SIT rather than this unit test.
// ============================================================

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Bind CHORUSGATE_HOME to a temp dir BEFORE importing gateway-control
// (load-env captures it at module load; each test file runs in its own
// worker process, so the import is fresh).
const tempHome = mkdtempSync(join(tmpdir(), "cg-logcmd-"));
process.env.CHORUSGATE_HOME = tempHome;

const ctl = await import("../src/gateway-control.js");

const SAVED_ARGV = process.argv;

/** Run `chorusgate log ...` against the temp home, returning captured stdout. */
async function runWithArgs(args: string[]): Promise<{ stdout: string; code: number }> {
  const chunks: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (s: string) => chunks.push(String(s));
  console.error = () => {}; // silence the error-path output
  try {
    process.argv = ["node", "chorusgate", ...args];
    await ctl.log();
    const code = process.exitCode ?? 0;
    process.exitCode = undefined;
    return { stdout: chunks.join("\n"), code };
  } finally {
    console.log = origLog;
    console.error = origError;
    process.argv = SAVED_ARGV;
  }
}

after(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

/** Seed a gateway.log under the temp home for the given agent. */
function seedLog(agent: string, lines: string[]): void {
  const dir = resolve(tempHome, agent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "gateway.log"), lines.join("\n") + "\n", "utf8");
}

describe("chorusgate log", () => {
  beforeEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    mkdirSync(tempHome, { recursive: true });
  });

  it("prints the last 50 lines by default (AC4)", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    seedLog("default", lines);
    const { stdout } = await runWithArgs(["log"]);
    const out = stdout.split("\n").filter(Boolean);
    assert.equal(out.length, 50);
    assert.equal(out[0], "line 10");
    assert.equal(out[out.length - 1], "line 59");
  });

  it("honors --lines N (AC5)", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    seedLog("default", lines);
    const { stdout } = await runWithArgs(["log", "--lines", "3"]);
    const out = stdout.split("\n").filter(Boolean);
    assert.deepEqual(out, ["line 17", "line 18", "line 19"]);
  });

  it("accepts the -n short form (AC5)", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    seedLog("default", lines);
    const { stdout } = await runWithArgs(["log", "-n", "2"]);
    assert.deepEqual(stdout.split("\n").filter(Boolean), ["line 8", "line 9"]);
  });

  it("reads the --agent scoped log and falls back to default (AC7)", async () => {
    seedLog("claude", ["claude-only"]);
    seedLog("default", ["default-only"]);
    const scoped = await runWithArgs(["log", "--agent", "claude"]);
    assert.match(scoped.stdout, /claude-only/);
    assert.doesNotMatch(scoped.stdout, /default-only/);
    // No --agent → default agent's log.
    const fallback = await runWithArgs(["log"]);
    assert.match(fallback.stdout, /default-only/);
  });

  it("reports a missing log file with non-zero exit (no daemon running)", async () => {
    // Nothing seeded for "hermes".
    const { stdout, code } = await runWithArgs(["log", "--agent", "hermes"]);
    assert.equal(code, 1);
    assert.equal(stdout, "");
  });
});

describe("chorusgate log — edge cases", () => {
  beforeEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    mkdirSync(tempHome, { recursive: true });
  });

  it("clamps --lines 0 / negative / NaN to the default 50", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    seedLog("default", lines);
    for (const args of [
      ["log", "--lines", "0"],
      ["log", "--lines", "-5"],
      ["log", "--lines", "abc"],
    ]) {
      const { stdout } = await runWithArgs(args);
      const out = stdout.split("\n").filter(Boolean);
      assert.equal(out.length, 50, `${args.join(" ")} must fall back to default 50`);
      assert.equal(out[0], "line 10");
      assert.equal(out[out.length - 1], "line 59");
    }
  });

  it("floors fractional --lines values", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    seedLog("default", lines);
    const { stdout } = await runWithArgs(["log", "--lines", "3.9"]);
    assert.deepEqual(stdout.split("\n").filter(Boolean), ["line 7", "line 8", "line 9"]);
  });

  it("keeps the last real line when the file has no trailing newline", async () => {
    const dir = resolve(tempHome, "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gateway.log"), "one\ntwo\nthree", "utf8");
    const { stdout } = await runWithArgs(["log", "--lines", "2"]);
    assert.deepEqual(stdout.split("\n").filter(Boolean), ["two", "three"]);
  });

  it("returns all lines when the file has fewer than requested", async () => {
    seedLog("default", ["only", "two"]);
    const { stdout } = await runWithArgs(["log", "--lines", "100"]);
    assert.deepEqual(stdout.split("\n").filter(Boolean), ["only", "two"]);
  });

  it("prints nothing and exits 0 for an empty existing log file", async () => {
    const dir = resolve(tempHome, "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gateway.log"), "", "utf8");
    const { stdout, code } = await runWithArgs(["log"]);
    assert.equal(stdout, "");
    assert.equal(code, 0);
  });
});
