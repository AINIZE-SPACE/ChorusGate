// ============================================================
// ClaudeStreamParser 测试 — 验证双向 stream-json 事件解析
//
// 使用固化 fixture 验证 parser 正确处理:
//   - system/init          → init 属性 + onSessionId 回调
//   - system/permission_request → onPermissionRequest 回调
//   - system/api_retry     → onApiRetry 回调
//   - user (isReplay)      → onUserReplay 回调
//   - assistant / result   → 继承自 ClaudeEventParser
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClaudeStreamParser,
  type PermissionRequest,
  type StreamInit,
} from "../src/providers/claude-stream-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

function readFixtureLines(name: string): string[] {
  const raw = readFileSync(resolve(fixturesDir, name), "utf-8");
  return raw.split("\n").filter((l) => l.trim());
}

// ---- init event parsing ---------------------------------------------------

test("ClaudeStreamParser parses system.init from fixture", () => {
  const parser = new ClaudeStreamParser();
  const inits: StreamInit[] = [];
  parser.onInit = (init) => inits.push(init);

  const lines = readFixtureLines("claude-stream-init.jsonl");
  for (const line of lines) parser.feed(line);

  assert.ok(parser.init !== null, "init should be set");
  assert.ok(parser.init!.sessionId.length > 0, "sessionId should not be empty");
  assert.equal(parser.init!.model, "deepseek-v4-pro[1m]");
  assert.ok(parser.init!.tools.includes("Read"), "tools should include Read");
  assert.equal(inits.length, 1, "onInit should fire once");
});

// ---- permission_request parsing -------------------------------------------

test("ClaudeStreamParser parses permission_request from fixture", () => {
  const parser = new ClaudeStreamParser();
  const requests: PermissionRequest[] = [];
  parser.onPermissionRequest = (req) => requests.push(req);

  const lines = readFixtureLines("claude-stream-permission-request.jsonl");
  for (const line of lines) parser.feed(line);

  assert.equal(requests.length, 1, "should have 1 permission_request");
  const req = requests[0];
  assert.equal(req.requestId, "req_abc123");
  assert.equal(req.toolName, "Write");
  assert.ok(req.toolInput.file_path, "tool_input should have file_path");
  assert.equal(req.sessionId, "permission-test-001");

  // permissionRequests list should match
  assert.equal(parser.permissionRequests.length, 1);
  assert.equal(parser.permissionRequests[0].requestId, "req_abc123");
});

// ---- api_retry parsing ----------------------------------------------------

test("ClaudeStreamParser parses api_retry events", () => {
  const parser = new ClaudeStreamParser();
  const retries: Array<{ attempt: number; max: number; delay: number }> = [];
  parser.onApiRetry = (attempt, max, delay) =>
    retries.push({ attempt, max, delay });

  // Feed inline api_retry events (not in main fixture as they're verbose)
  parser.feed(
    '{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":505.72}',
  );
  parser.feed(
    '{"type":"system","subtype":"api_retry","attempt":2,"max_retries":10,"retry_delay_ms":1124.02}',
  );

  assert.equal(retries.length, 2, "should have 2 api_retry events");
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[0].max, 10);
  assert.ok(retries[0].delay > 0, "delay should be positive");
  assert.equal(retries[1].attempt, 2);
});

// ---- assistant/result parsing (inherited) ----------------------------------

test("ClaudeStreamParser extracts assistant text and result", () => {
  const parser = new ClaudeStreamParser();

  const lines = readFixtureLines("claude-stream-init.jsonl");
  for (const line of lines) parser.feed(line);

  const text = parser.getResultText();
  assert.ok(text.length > 0, "should extract result text");
  assert.ok(
    text.includes("API Error") || text.includes("Unable to connect"),
    "should contain the error message",
  );
});

// ---- user replay parsing --------------------------------------------------

test("ClaudeStreamParser handles user replay (isReplay)", () => {
  const parser = new ClaudeStreamParser();
  const replays: unknown[] = [];
  parser.onUserReplay = (msg) => replays.push(msg);

  const lines = readFixtureLines("claude-stream-init.jsonl");
  for (const line of lines) parser.feed(line);

  assert.equal(replays.length, 1, "should have 1 user replay");
  const msg = replays[0] as Record<string, unknown>;
  assert.equal(msg.role, "user");
  const content = msg.content as Array<Record<string, unknown>>;
  assert.equal(content[0].text, "Say hello in exactly one sentence.");
});

// ---- onSessionId callback -------------------------------------------------

test("ClaudeStreamParser fires onSessionId from system.init", () => {
  const parser = new ClaudeStreamParser();
  let sessionId = "";
  parser.onSessionId = (id) => {
    sessionId = id;
  };

  const lines = readFixtureLines("claude-stream-init.jsonl");
  for (const line of lines) parser.feed(line);

  assert.ok(sessionId.length > 0, "onSessionId should fire with a valid ID");
  assert.equal(parser.sessionId, sessionId, "sessionId getter should match");
});

// ---- empty/invalid input --------------------------------------------------

test("ClaudeStreamParser ignores empty and invalid lines", () => {
  const parser = new ClaudeStreamParser();

  parser.feed("");
  parser.feed("   ");
  parser.feed("not json");
  parser.feed("{invalid json");

  // Should not throw, no state changes
  assert.equal(parser.init, null);
  assert.equal(parser.getResultText(), "");
});

// ---- M3: stream_event wrapped events (#85) ---------------------------------

test("ClaudeStreamParser: stream_event unwrapping", () => {
  const parser = new ClaudeStreamParser();
  const texts: string[] = [];
  const thinkings: string[] = [];
  const blocks: string[] = [];
  let metrics: Record<string, unknown> | null = null;

  parser.onTextDelta = (t) => texts.push(t);
  parser.onThinkingDelta = (t) => thinkings.push(t);
  parser.onBlockStart = (bt) => blocks.push("start:" + bt);
  parser.onBlockStop = (bt) => blocks.push("stop:" + bt);
  parser.onMetrics = (m) => { metrics = m as Record<string, unknown>; };

  const lines = readFixtureLines("claude-stream-partial-messages.jsonl");
  for (const line of lines) parser.feed(line);

  assert.ok(blocks.includes("start:thinking"));
  assert.ok(thinkings.join("").includes("Let me think"));
  assert.equal(texts.join(""), "Hello world");
  assert.ok(metrics);
  assert.equal(metrics.costUsd, 0.01);
});

test("ClaudeStreamParser: direct delta still works", () => {
  const parser = new ClaudeStreamParser();
  const texts: string[] = [];
  parser.onTextDelta = (t) => texts.push(t);
  parser.feed(JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }));
  assert.equal(texts[0], "x");
});
