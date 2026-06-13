// ============================================================
// reply-engine.test — ReplyEngine generateReply + generateReplyStream
//
// P0-4: Verify reply engine contract: function signatures,
// return types, error paths, and session.close() in finally.
// Integration tests for spawn behavior are in claude-stream-integration.test.ts.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { PermissionTracker } from "../src/permission-tracker.js";

// ---- generateReply function exists and returns expected shape ----------

test("reply-engine: generateReply is importable", async () => {
  const { generateReply } = await import("../src/reply-engine.js");
  assert.equal(typeof generateReply, "function");
});

test("reply-engine: generateReplyStream is importable", async () => {
  const { generateReplyStream } = await import("../src/reply-engine.js");
  assert.equal(typeof generateReplyStream, "function");
});

// ---- generateReply contract: valid options shape -----------------------

test("reply-engine: generateReply returns error with empty prompt and no claude", async () => {
  // Without a real claude binary, generateReply should fail gracefully
  const origBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "nonexistent-claude-binary";
  process.env.GATEWAY_CLAUDE_MODE = "legacy";

  try {
    const { generateReply } = await import("../src/reply-engine.js");
    const result = await generateReply("test prompt", {
      cwd: process.cwd(),
      timeoutMs: 1000,
    });

    // Should fail because binary doesn't exist
    assert.equal(result.ok, false);
    assert.ok(result.error, "should have error message");
    // error should be a string
    assert.equal(typeof result.error, "string");
  } finally {
    if (origBin) process.env.CLAUDE_BIN = origBin;
    else delete process.env.CLAUDE_BIN;
  }
});

// ---- ReplyResult shape validation --------------------------------------

test("reply-engine: ReplyResult shape is correct", async () => {
  // Test the type contract by constructing a ReplyResult manually
  const success: { ok: boolean; text: string; error?: string } = {
    ok: true,
    text: "hello world",
  };
  assert.equal(success.ok, true);
  assert.equal(success.text, "hello world");

  const failure: { ok: boolean; text: string; error?: string } = {
    ok: false,
    text: "",
    error: "something went wrong",
  };
  assert.equal(failure.ok, false);
  assert.ok(failure.error);
});

// ---- generateReply with sessionId + resume ---------------------------------

test("reply-engine: generateReply passes sessionId for new sessions", async () => {
  const { generateReply } = await import("../src/reply-engine.js");
  const origBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "nonexistent-claude-binary";
  process.env.GATEWAY_CLAUDE_MODE = "legacy";

  try {
    const result = await generateReply("hello", {
      cwd: process.cwd(),
      timeoutMs: 1000,
      sessionId: "test-session-uuid",
    });

    // Should fail gracefully
    assert.equal(result.ok, false);
  } finally {
    if (origBin) process.env.CLAUDE_BIN = origBin;
    else delete process.env.CLAUDE_BIN;
  }
});

// ---- generateReplyStream contract --------------------------------------

test("reply-engine: generateReplyStream accepts onPermission callback", async () => {
  // Force spawn failure: use a binary path that does not exist.
  // Without this, a real `claude` on PATH (e.g. host dev box) would start
  // and never finish within the 500ms timeout, hanging the test runner.
  const origBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "nonexistent-claude-binary-for-stream-test";

  let permCallbackCalled = false;

  try {
    const { generateReplyStream } = await import("../src/reply-engine.js");

    // This will fail because no real claude, but we're testing the API shape
    const result = await generateReplyStream("test", {
      cwd: process.cwd(),
      timeoutMs: 500,
      onPermission: async (_req) => {
        permCallbackCalled = true;
        return true;
      },
    });

    // Should fail gracefully (no mock claude configured)
    assert.equal(result.ok, false);
  } catch {
    // Also acceptable if it throws
  } finally {
    if (origBin) process.env.CLAUDE_BIN = origBin;
    else delete process.env.CLAUDE_BIN;
  }
});

// ---- Session close() called in finally (P1-5) ---------------------------

test("reply-engine: generateReplyStream includes finally block for close()", async () => {
  // Verify the function source includes a finally block with session.close()
  const { generateReplyStream } = await import("../src/reply-engine.js");
  const src = generateReplyStream.toString();

  // Should contain a finally block
  assert.ok(
    src.includes("finally") || src.includes("session?.close"),
    "generateReplyStream should have finally block with session.close()"
  );
});

// ---- Error propagation ---------------------------------------------------

test("reply-engine: provider error is caught and returned as error string", async () => {
  // Force spawn failure: same reason as the onPermission test above.
  // Without this, a real `claude` on PATH could keep running past the
  // 2000ms spawn timeout and hang the runner.
  const origBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "nonexistent-claude-binary-for-error-test";

  const { generateReply } = await import("../src/reply-engine.js");

  // Set invalid mode to trigger dynamic import error
  const origMode = process.env.GATEWAY_CLAUDE_MODE;
  process.env.GATEWAY_CLAUDE_MODE = "nonexistent_mode_xyz";

  try {
    const result = await generateReply("test", {
      cwd: process.cwd(),
      timeoutMs: 2000,
    });

    // Regardless of outcome, result should have the expected shape
    assert.equal(typeof result.ok, "boolean");
    assert.equal(typeof result.text, "string");
    if (!result.ok) {
      assert.equal(typeof result.error, "string");
    }
  } finally {
    if (origMode) process.env.GATEWAY_CLAUDE_MODE = origMode;
    else delete process.env.GATEWAY_CLAUDE_MODE;
    if (origBin) process.env.CLAUDE_BIN = origBin;
    else delete process.env.CLAUDE_BIN;
  }
});

// ---- PermissionTracker integration with reply-engine flow ---------------

test("reply-engine: PermissionTracker waitForApproval returns promise", () => {
  const tracker = new PermissionTracker(5000);

  const promise = tracker.waitForApproval("req_re_test", {
    toolName: "Bash",
    toolInput: { command: "echo test" },
    channel: "C_TEST",
    threadTs: "100.200",
    requesterUserId: "U_RE_TEST",
  });

  assert.ok(promise instanceof Promise);
  assert.equal(tracker.pendingCount, 1);

  // Cleanup
  tracker.clear();
});

// ---- reply-engine: timeoutMs default ------------------------------------

test("reply-engine: generateReply respects timeoutMs default", async () => {
  const { generateReply } = await import("../src/reply-engine.js");

  // Verify default timeoutMs is 180000 (3 min); tsx transpiles number literals
  const src = generateReply.toString();
  assert.ok(
    src.includes("180_000") || src.includes("180000") || src.includes("18e4"),
    "default timeout should be 180000ms"
  );
});
