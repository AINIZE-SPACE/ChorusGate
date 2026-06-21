// ============================================================
// _spawn-helpers unit tests (P1 #64)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpawnCommand,
  buildSpawnOptions,
  buildSpawnEnv,
  createLineBuffer,
  flushBuffer,
} from "../src/providers/_spawn-helpers.js";

// ---- buildSpawnCommand -----------------------------------------------------

test("buildSpawnCommand — non-Windows returns bin + args unchanged", () => {
  const origPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux" });
  try {
    const { cmd, spawnArgs } = buildSpawnCommand("claude", ["-p", "--json"]);
    assert.equal(cmd, "claude");
    assert.deepEqual(spawnArgs, ["-p", "--json"]);
  } finally {
    Object.defineProperty(process, "platform", { value: origPlatform });
  }
});

test("buildSpawnCommand — Windows wraps in quoted shell command", () => {
  const origPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const { cmd, spawnArgs } = buildSpawnCommand("claude", ["-p"]);
    assert.ok(cmd.includes('"claude"'), `expected quoted claude, got: ${cmd}`);
    assert.deepEqual(spawnArgs, []);
  } finally {
    Object.defineProperty(process, "platform", { value: origPlatform });
  }
});

// ---- buildSpawnOptions ------------------------------------------------------

test("buildSpawnOptions — default options with pipe stdio", () => {
  const opts = buildSpawnOptions("/tmp/test");
  assert.equal(opts.cwd, "/tmp/test");
  assert.deepEqual(opts.stdio, ["pipe", "pipe", "pipe"]);
});

test("buildSpawnOptions — passes through env when provided", () => {
  const env = { SLACK_BOT_TOKEN: "xoxb-test" };
  const opts = buildSpawnOptions("/tmp/test", env);
  assert.equal(opts.env, env);
});

// ---- buildSpawnEnv ----------------------------------------------------------

function hasPathVariable(env: Record<string, string | undefined>): boolean {
  return Object.keys(env).some((key) => key.toLowerCase() === "path");
}

test("buildSpawnEnv — injects Slack tokens into process env", () => {
  const env = buildSpawnEnv({ botToken: "xoxb-mybot", appToken: "xapp-myapp" });
  assert.equal(env.SLACK_BOT_TOKEN, "xoxb-mybot");
  assert.equal(env.SLACK_APP_TOKEN, "xapp-myapp");
  // Should still have existing env vars
  assert.ok(hasPathVariable(env), "should preserve existing env vars");
});

test("buildSpawnEnv — no tokens passed, still returns process env copy", () => {
  const env = buildSpawnEnv({});
  assert.ok(hasPathVariable(env), "should preserve existing env vars");
  assert.equal(env.SLACK_BOT_TOKEN, process.env.SLACK_BOT_TOKEN);
});

// ---- createLineBuffer -------------------------------------------------------

test("createLineBuffer — splits on newlines", () => {
  const lines: string[] = [];
  const feed = createLineBuffer((line) => lines.push(line));
  feed("hello\nworld\n");
  assert.deepEqual(lines, ["hello", "world"]);
});

test("createLineBuffer — accumulates partial trailing line", () => {
  const lines: string[] = [];
  const feed = createLineBuffer((line) => lines.push(line));
  feed("hello\nwor");
  assert.deepEqual(lines, ["hello"]);
  feed("ld\nfoo\n");
  assert.deepEqual(lines, ["hello", "world", "foo"]);
});

test("createLineBuffer — handles Buffer input", () => {
  const lines: string[] = [];
  const feed = createLineBuffer((line) => lines.push(line));
  feed(Buffer.from("a\nb\n"));
  assert.deepEqual(lines, ["a", "b"]);
});

// ---- flushBuffer ------------------------------------------------------------

test("flushBuffer — flushes remaining partial line", () => {
  const lines: string[] = [];
  const feed = createLineBuffer((line) => lines.push(line));
  feed("partial_line_without_newline");
  assert.deepEqual(lines, []);

  flushBuffer(feed);
  assert.deepEqual(lines, ["partial_line_without_newline"]);
});

test("flushBuffer — no-op when buffer empty", () => {
  const lines: string[] = [];
  const feed = createLineBuffer((line) => lines.push(line));
  feed("done\n");
  assert.deepEqual(lines, ["done"]);

  flushBuffer(feed);
  // flushBuffer appends "\n", so an empty trailing line is emitted
  assert.deepEqual(lines, ["done", ""]);
});
