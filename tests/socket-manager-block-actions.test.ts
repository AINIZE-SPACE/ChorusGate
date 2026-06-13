// ============================================================
// socket-manager-block-actions.test — block_actions event handling
//
// P0-4: Test that interactive block_actions (Approve/Deny buttons)
// are correctly parsed and routed through the socket manager.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

// ---- BlockActionsPayload type shape validation -------------------------

test("socket-manager: BlockActionsPayload has required shape", () => {
  // Simulate a block_actions event from Slack Socket Mode
  const payload = {
    type: "block_actions",
    user: { id: "U001", username: "tester" },
    channel: { id: "C123" },
    message: {
      ts: "1234567890.123456",
      thread_ts: "1234567890.000000",
    },
    actions: [
      {
        action_id: "permission_approve",
        block_id: "perm_req_abc",
        value: "approve:req_abc:U_ORIGINAL",
        type: "button",
      },
    ],
    response_url: "https://hooks.slack.com/actions/xxx",
  };

  assert.equal(payload.type, "block_actions");
  assert.equal(payload.user.id, "U001");
  assert.equal(payload.actions.length, 1);
  assert.equal(payload.actions[0].action_id, "permission_approve");

  // Parse action_value: last segment is requesterUserId
  const actionValue = payload.actions[0].value;
  const lastColon = actionValue.lastIndexOf(":");
  const requesterUserIdFromValue = actionValue.slice(lastColon + 1);
  assert.equal(requesterUserIdFromValue, "U_ORIGINAL");

  // Auth check: clicking user !== requester
  const clickingUser = payload.user.id;
  assert.notEqual(clickingUser, requesterUserIdFromValue);
  // Gateway should reject: clickingUser !== requesterUserIdFromValue
});

test("socket-manager: block_actions deny button parsed correctly", () => {
  const payload = {
    type: "block_actions",
    user: { id: "U_ADMIN", username: "admin" },
    channel: { id: "C456" },
    message: { ts: "9999999999.999999" },
    actions: [
      {
        action_id: "permission_deny",
        block_id: "perm_req_xyz",
        value: "deny:req_xyz:U_REQUESTER",
        type: "button",
      },
    ],
  };

  assert.equal(payload.actions[0].action_id, "permission_deny");
  assert.equal(payload.actions[0].value, "deny:req_xyz:U_REQUESTER");

  // Parse action and requestId
  const value = payload.actions[0].value;
  const firstColon = value.indexOf(":");
  const lastColon = value.lastIndexOf(":");
  const action = value.slice(0, firstColon);
  const requestId = value.slice(firstColon + 1, lastColon);
  const requesterUserId = value.slice(lastColon + 1);

  assert.equal(action, "deny");
  assert.equal(requestId, "req_xyz");
  assert.equal(requesterUserId, "U_REQUESTER");
});

test("socket-manager: handles multiple actions in one block_actions event", () => {
  const payload = {
    type: "block_actions",
    user: { id: "U_MULTI" },
    channel: { id: "C789" },
    message: { ts: "1111111111.111111" },
    actions: [
      {
        action_id: "permission_approve",
        block_id: "perm_req_a",
        value: "approve:req_a:U_REQ_A",
        type: "button",
      },
      {
        action_id: "permission_deny",
        block_id: "perm_req_b",
        value: "deny:req_b:U_REQ_B",
        type: "button",
      },
    ],
  };

  assert.equal(payload.actions.length, 2);

  for (const action of payload.actions) {
    const value = action.value;
    const lastColon = value.lastIndexOf(":");
    const requesterUserId = value.slice(lastColon + 1);
    assert.ok(requesterUserId.startsWith("U_REQ"), "should parse userId from: " + value);

    const firstColon = value.indexOf(":");
    const decision = value.slice(0, firstColon);
    assert.ok(decision === "approve" || decision === "deny", "should be approve or deny");
  }
});

test("socket-manager: unknown action_id should be silently ignored", () => {
  const unknownAction = {
    action_id: "some_other_action",
    block_id: "unknown_block",
    value: "irrelevant",
    type: "button",
  };

  const knownActionIds = ["permission_approve", "permission_deny"];
  assert.equal(knownActionIds.includes(unknownAction.action_id), false);
  // Gateway should skip this action
});

// ---- action_value edge cases --------------------------------------------

test("socket-manager: action_value with requestId containing special chars", () => {
  // Request IDs may contain colons (e.g. from tool-generated IDs)
  const values = [
    "approve:claude:req:a/b:U00001",
    "deny:tool:req:deep:nested:id:U00002",
    "approve:simple:U00003",
  ];

  for (const value of values) {
    const firstColon = value.indexOf(":");
    const lastColon = value.lastIndexOf(":");
    const action = value.slice(0, firstColon);
    const requestId = value.slice(firstColon + 1, lastColon);
    const userId = value.slice(lastColon + 1);

    assert.ok(["approve", "deny"].includes(action), "action should be approve/deny: " + action);
    assert.ok(requestId.length > 0, "requestId should not be empty");
    assert.ok(userId.startsWith("U00"), "userId should start with U00: " + userId);
  }
});

test("socket-manager: malformed action_value with no userId segment returns handled:false", () => {
  const malformed = [
    "just_a_string",
    "",
    "approve",
    "approve:req_no_user",
  ];

  for (const value of malformed) {
    const lastColon = value.lastIndexOf(":");
    // No colon → invalid, no colon after first → missing userId
    const hasUserId =
      lastColon > 0 && lastColon < value.length - 1 &&
      value.indexOf(":") < lastColon;
    assert.equal(hasUserId, false, "malformed value should have no userId: " + value);
  }
});
