// ============================================================
// PermissionTracker 测试
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { PermissionTracker, buildApprovalBlocks } from "../src/permission-tracker.js";

// ---- waitForApproval / approve / deny ------------------------------------

test("PermissionTracker resolves on approve via handleAction", async () => {
  const tracker = new PermissionTracker(5000);

  const promise = tracker.waitForApproval("req_001", {
    toolName: "Bash",
    toolInput: { command: "ls" },
    channel: "C123",
    threadTs: "123.456",
    requesterUserId: "U001",
  });

  assert.equal(tracker.pendingCount, 1);

  // Simulate button click (value format: approve:<requestId>:<userId>)
  const result = tracker.handleAction("approve:req_001:U001");
  assert.equal(result.handled, true);
  assert.equal(result.granted, true);
  assert.equal(result.requesterUserId, "U001");
  assert.equal(tracker.pendingCount, 0);

  const granted = await promise;
  assert.equal(granted, true);
});

// ---- deny via handleAction -------------------------------------------------

test("PermissionTracker resolves on deny via handleAction", async () => {
  const tracker = new PermissionTracker(5000);

  const promise = tracker.waitForApproval("req_002", {
    toolName: "Write",
    toolInput: { file_path: "/tmp/test" },
    channel: "C456",
    threadTs: "789.012",
    requesterUserId: "U002",
  });

  const result = tracker.handleAction("deny:req_002:U002");
  assert.equal(result.handled, true);
  assert.equal(result.granted, false);
  assert.equal(result.requesterUserId, "U002");

  const granted = await promise;
  assert.equal(granted, false);
});

// ---- explicit approve/deny -------------------------------------------------

test("PermissionTracker.approve / .deny work directly", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_a", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_A",
  });
  const p2 = tracker.waitForApproval("req_b", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_B",
  });

  tracker.approve("req_a");
  tracker.deny("req_b");

  assert.equal(await p1, true);
  assert.equal(await p2, false);
});

// ---- timeout auto-denies ---------------------------------------------------

test("PermissionTracker auto-denies on timeout", async () => {
  const tracker = new PermissionTracker(100); // 100ms timeout

  const promise = tracker.waitForApproval("req_timeout", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "1",
    requesterUserId: "U_TIMEOUT",
  });

  const granted = await promise;
  assert.equal(granted, false);
  assert.equal(tracker.pendingCount, 0);
});

// ---- unknown action value --------------------------------------------------

test("PermissionTracker.handleAction ignores unknown format", () => {
  const tracker = new PermissionTracker();

  assert.equal(tracker.handleAction("").handled, false);
  assert.equal(tracker.handleAction("unknown").handled, false);
  assert.equal(tracker.handleAction("unknown:req_001").handled, false);
  // Missing requesterUserId segment
  assert.equal(tracker.handleAction("approve:req_x").handled, false);
});

// ---- clear -----------------------------------------------------------------

test("PermissionTracker.clear resolves all pending as denied", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_1", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_1",
  });
  const p2 = tracker.waitForApproval("req_2", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_2",
  });

  tracker.clear();

  assert.equal(tracker.pendingCount, 0);
  assert.equal(await p1, false);
  assert.equal(await p2, false);
});

// ---- buildApprovalBlocks ---------------------------------------------------

test("buildApprovalBlocks returns valid Slack blocks", () => {
  const blocks = buildApprovalBlocks(
    "Bash",
    { command: "rm -rf dist/" },
    "req_test_blocks",
    "U_TEST",
  );

  assert.ok(Array.isArray(blocks));
  assert.ok(blocks.length >= 4, "should have at least 4 blocks");

  // Should contain action buttons
  const actionsBlock = blocks.find(
    (b: Record<string, unknown>) => b.type === "actions",
  );
  assert.ok(actionsBlock, "should have an actions block");

  const elements = actionsBlock.elements as Array<Record<string, unknown>>;
  assert.equal(elements.length, 2);

  // First button: Approve (value encodes requestId + requesterUserId for auth)
  assert.equal(elements[0].action_id, "permission_approve");
  assert.equal(elements[0].value, "approve:req_test_blocks:U_TEST");

  // Second button: Deny
  assert.equal(elements[1].action_id, "permission_deny");
  assert.equal(elements[1].value, "deny:req_test_blocks:U_TEST");

  // Should have timeout context with dynamic minutes
  const contextBlock = blocks.find(
    (b: Record<string, unknown>) => b.type === "context",
  );
  assert.ok(contextBlock, "should have a context block");
});
