// ============================================================
// PermissionTracker 测试
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/34)
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
  });

  assert.equal(tracker.pendingCount, 1);

  // Simulate button click
  const handled = tracker.handleAction("approve:req_001");
  assert.equal(handled, true);
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
  });

  const handled = tracker.handleAction("deny:req_002");
  assert.equal(handled, true);

  const granted = await promise;
  assert.equal(granted, false);
});

// ---- explicit approve/deny -------------------------------------------------

test("PermissionTracker.approve / .deny work directly", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_a", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1",
  });
  const p2 = tracker.waitForApproval("req_b", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1",
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
  });

  const granted = await promise;
  assert.equal(granted, false);
  assert.equal(tracker.pendingCount, 0);
});

// ---- unknown action value --------------------------------------------------

test("PermissionTracker.handleAction ignores unknown format", () => {
  const tracker = new PermissionTracker();

  assert.equal(tracker.handleAction(""), false);
  assert.equal(tracker.handleAction("unknown"), false);
  assert.equal(tracker.handleAction("unknown:req_001"), false);
});

// ---- clear -----------------------------------------------------------------

test("PermissionTracker.clear resolves all pending as denied", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_1", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1",
  });
  const p2 = tracker.waitForApproval("req_2", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1",
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
  );

  assert.ok(Array.isArray(blocks));
  assert.ok(blocks.length >= 3, "should have at least 3 blocks");

  // Should contain action buttons
  const actionsBlock = blocks.find(
    (b: Record<string, unknown>) => b.type === "actions",
  );
  assert.ok(actionsBlock, "should have an actions block");

  const elements = actionsBlock.elements as Array<Record<string, unknown>>;
  assert.equal(elements.length, 2);

  // First button: Approve
  assert.equal(elements[0].action_id, "permission_approve");
  assert.equal(elements[0].value, "approve:req_test_blocks");

  // Second button: Deny
  assert.equal(elements[1].action_id, "permission_deny");
  assert.equal(elements[1].value, "deny:req_test_blocks");
});
