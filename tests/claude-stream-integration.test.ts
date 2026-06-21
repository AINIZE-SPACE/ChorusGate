// ============================================================
// claude-stream-integration — spawn mock claude + full flow
//
// P0-4: Integration tests validating ClaudeStreamProvider +
// createStreamSession end-to-end stream-json bidirectional pipe.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeStreamParser } from "../src/providers/claude-stream-parser.js";
import { PermissionTracker, buildApprovalBlocks } from "../src/permission-tracker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_CLAUDE = resolve(__dirname, "fixtures", "mock-claude", "script.mjs");

// ---- spawn mock claude helper -------------------------------------------
interface MockResult {
  child: ChildProcess;
  parser: ClaudeStreamParser;
  stderr: string;
  done: Promise<{ text: string; exitCode: number | null; stderr: string }>;
}

function spawnMock(mode: string, env?: Record<string, string>): MockResult {
  const parser = new ClaudeStreamParser();
  let stderr = "";

  const child = spawn("node", [MOCK_CLAUDE, mode], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  let stdoutBuf = "";
  let text = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line) parser.feed(line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const done = new Promise<{ text: string; exitCode: number | null; stderr: string }>(
    (resolve) => {
      child.on("close", (code) => {
        if (stdoutBuf) parser.feed(stdoutBuf);
        text = parser.getResultText();
        resolve({ text, exitCode: code, stderr });
      });
    }
  );

  return { child, parser, stderr, done };
}

// ---- integration tests --------------------------------------------------

test("claude-stream-integration: simple mode spawns mock and parses stream", async () => {
  const { child, parser, done } = spawnMock("simple");

  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "hello" },
    }) + "\n"
  );
  child.stdin.end();

  const result = await done;

  assert.ok(parser.init, "parser should have init data");
  assert.equal(parser.init.sessionId, "mock-session-001");
  assert.ok(parser.init.tools.includes("Bash"));
  assert.ok(
    result.text.includes("mock Claude"),
    "text should contain greeting: " + result.text
  );
  assert.equal(result.exitCode, 0);
});

test("claude-stream-integration: permission mode — request then response", async () => {
  const parser = new ClaudeStreamParser();

  const permRequests: Array<{ requestId: string; toolName: string }> = [];
  parser.onPermissionRequest = (req) => {
    permRequests.push({ requestId: req.requestId, toolName: req.toolName });
  };

  const child = spawn("node", [MOCK_CLAUDE, "permission"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MOCK_CLAUDE_MODE: "permission" },
  });

  // Wait for mock to signal ready on stderr before sending stdin
  await new Promise<void>((resolve) => {
    child.stderr!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("[mock-claude] ready")) resolve();
    });
    // Safety timeout — proceed after 500ms even if no ready signal
    setTimeout(resolve, 500);
  });

  let stdoutBuf = "";
  let resultText = "";
  let exitCode: number | null = null;

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line) parser.feed(line);
    }
  });

  const done = new Promise<void>((resolve) => {
    child.on("close", (code) => {
      exitCode = code;
      if (stdoutBuf) parser.feed(stdoutBuf);
      resultText = parser.getResultText();
      resolve();
    });
  });

  // Send user prompt
  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "write a file" },
    }) + "\n"
  );

  // Wait for stdout to emit permission_request (poll with timeout)
  const start = Date.now();
  while (permRequests.length === 0 && Date.now() - start < 2000) {
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.ok(permRequests.length >= 1, "should receive permission_request");
  assert.equal(permRequests[0].toolName, "Write");
  assert.equal(permRequests[0].requestId, "mock_req_001");

  // Send permission_response to continue
  child.stdin.write(
    JSON.stringify({
      type: "permission_response",
      request_id: "mock_req_001",
      granted: true,
    }) + "\n"
  );

  await done;

  assert.ok(resultText.includes("Done!"), "expected completion, got: " + resultText);
  assert.equal(exitCode, 0);
});

test("claude-stream-integration: error mode emits is_error result", async () => {
  const { child, parser, done } = spawnMock("error");

  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "cause error" },
    }) + "\n"
  );
  child.stdin.end();

  const result = await done;

  assert.ok(parser.init, "parser should have init data even on error");
  assert.ok(
    result.text.includes("Mock error"),
    "text should include error, got: " + result.text
  );
});

// ---- PermissionTracker + buildApprovalBlocks integration ----------------

test("PermissionTracker: full approve cycle via handleAction with userId", async () => {
  const tracker = new PermissionTracker(5000);

  const promise = tracker.waitForApproval("req_int_001", {
    toolName: "Bash",
    toolInput: { command: "npm test" },
    channel: "C_CHAN",
    threadTs: "123.456",
    requesterUserId: "U_USER1",
  });

  assert.equal(tracker.pendingCount, 1);

  const result = tracker.handleAction("allow_once:req_int_001:U_USER1");
  assert.equal(result.handled, true);
  assert.equal(result.scope, "once");
  assert.equal(result.granted, true);
  assert.equal(result.requesterUserId, "U_USER1");

  const scope = await promise;
  assert.equal(scope, "once");
  assert.equal(tracker.pendingCount, 0);
});

test("buildApprovalBlocks: timeout text is dynamic based on timeoutMs", () => {
  // 5 minutes
  const b5 = buildApprovalBlocks("Bash", { cmd: "ls" }, "req_t1", "U_T", 5 * 60 * 1000);
  const ctx5 = b5.find((b) => b.type === "context");
  assert.ok(ctx5, "should have context block");
  const t5 = (ctx5.elements?.[0] as { text: string })?.text || "";
  assert.ok(t5.includes("5"), "expected 5 min text, got: " + t5);

  // Default (no timeoutMs) — 2 minutes
  const bDef = buildApprovalBlocks("Bash", { cmd: "ls" }, "req_t2", "U_T");
  const ctxDef = bDef.find((b) => b.type === "context");
  const tDef = (ctxDef.elements?.[0] as { text: string })?.text || "";
  assert.ok(tDef.includes("2"), "expected 2 min default, got: " + tDef);
});

test("PermissionTracker: requesterUserId returned for gateway auth check", () => {
  const tracker = new PermissionTracker(5000);

  tracker.waitForApproval("req_auth", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "1",
    requesterUserId: "U_ALICE",
  });

  // BOB clicks ALICE's button
  const result = tracker.handleAction("approve:req_auth:U_BOB");
  // Action is processed but requesterUserId reveals original owner
  assert.equal(result.handled, true);
  assert.equal(result.requesterUserId, "U_ALICE");
  // Gateway layer compares: action.userId (BOB) !== result.requesterUserId (ALICE) -> reject
});

test("PermissionTracker: handleAction parses requestId containing colons", () => {
  const tracker = new PermissionTracker(5000);

  tracker.waitForApproval("tool:req:abc:123", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "1",
    requesterUserId: "U_COLON",
  });

  const result = tracker.handleAction("approve:tool:req:abc:123:U_COLON");
  assert.equal(result.handled, true);
  assert.equal(result.granted, true);
});
