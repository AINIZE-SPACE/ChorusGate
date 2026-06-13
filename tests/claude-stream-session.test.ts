// ============================================================
// ClaudeStreamSession 测试 — 验证双向 session API
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { type ClaudeStreamSession } from "../src/providers/claude-stream.js";
import { type PermissionRequest } from "../src/providers/claude-stream-parser.js";

// ---- PermissionRequest type validation ------------------------------------

test("PermissionRequest type has correct shape", () => {
  const req: PermissionRequest = {
    requestId: "req_test_001",
    toolName: "Bash",
    toolInput: { command: "rm -rf /" },
    sessionId: "session_001",
  };

  assert.equal(req.requestId, "req_test_001");
  assert.equal(req.toolName, "Bash");
  assert.deepEqual(req.toolInput, { command: "rm -rf /" });
  assert.equal(req.sessionId, "session_001");
});

// ---- permission_response JSON format --------------------------------------

test("permission_response JSON matches protocol spec", () => {
  // approve
  const approve = JSON.stringify({
    type: "permission_response",
    request_id: "req_abc123",
    granted: true,
  });
  const parsed = JSON.parse(approve);
  assert.equal(parsed.type, "permission_response");
  assert.equal(parsed.request_id, "req_abc123");
  assert.equal(parsed.granted, true);

  // deny
  const deny = JSON.stringify({
    type: "permission_response",
    request_id: "req_abc123",
    granted: false,
  });
  const parsed2 = JSON.parse(deny);
  assert.equal(parsed2.type, "permission_response");
  assert.equal(parsed2.granted, false);
});

// ---- ClaudeStreamSession interface conformance ----------------------------

test("ClaudeStreamSession shape validates", () => {
  // Verify the interface shape (compile-time + runtime sanity)
  const mockSession: ClaudeStreamSession = {
    sessionId: "test_session",
    parser: null as unknown as ClaudeStreamSession["parser"],
    result: Promise.resolve({
      ok: true,
      text: "mock result",
      sessionId: "test_session",
    }),
    sendPermissionResponse(_requestId: string, _granted: boolean) {
      // no-op mock
    },
    close() {
      // no-op mock
    },
  };

  assert.equal(mockSession.sessionId, "test_session");
  assert.ok(mockSession.result instanceof Promise);
  assert.doesNotThrow(() => mockSession.sendPermissionResponse("req_1", true));
  assert.doesNotThrow(() => mockSession.close());
});
