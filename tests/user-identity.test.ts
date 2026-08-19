// ============================================================
// user-identity — ST for #144 bot-to-bot message tracking
//
// Covers the 7 requirements:
//   1-2. parseUser distinguishes USER vs BOT in every code path
//   3.   rich ParsedUser object (user_id / user_type / bot_id / is_bot)
//   4.   isBotMessage helper
//   5-6. bot / human message handler dispatch (custom logic hooks)
//   7.   GATEWAY_BOT_MESSAGE_HANDLING config knob on/off
//
// Tests the REAL modules: src/user-identity.ts (pure parser) and
// src/message-handlers.ts (dispatch + knob). No gateway side effects.
//
// 跟踪: #144
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUser,
  isBotMessage,
  type ParsedUser,
} from "../src/user-identity.js";
import {
  defaultMessageHandlerHooks,
  dispatchMessageHandler,
  botMessageHandlingEnabled,
} from "../src/message-handlers.js";
import type { StoredEvent } from "../src/types.js";

// ---- requirement 1-3: parseUser produces a rich USER/BOT identity ---------

test("ST-UI-001: human message parses as USER with user_id, no bot fields", () => {
  const parsed = parseUser({
    type: "message",
    channel: "C123",
    user: "U0AHDRREVPD",
    text: "hello",
    ts: "1.0",
  });
  assert.deepEqual(parsed, {
    user_id: "U0AHDRREVPD",
    user_type: "USER",
    bot_id: undefined,
    is_bot: false,
  });
});

test("ST-UI-002: bot_message parses as BOT with bot_id (Slack bot_message shape)", () => {
  const parsed = parseUser({
    type: "message",
    subtype: "bot_message",
    channel: "C123",
    user: "U0B91BVKTL2", // bot's user id may be present
    bot_id: "B0BOT1",
    bot_profile: { id: "U0B91BVKTL2" },
    text: "任务路由更新，请查收",
    ts: "2.0",
  });
  assert.equal(parsed.user_type, "BOT");
  assert.equal(parsed.is_bot, true);
  assert.equal(parsed.bot_id, "B0BOT1");
  assert.equal(parsed.user_id, "U0B91BVKTL2");
});

test("ST-UI-003: bot message with only bot_id (no user) parses as BOT", () => {
  const parsed = parseUser({
    type: "message",
    subtype: "bot_message",
    bot_id: "B0LEGACY",
    username: "legacy-bot",
    text: "no user identity",
    ts: "3.0",
  });
  assert.equal(parsed.user_type, "BOT");
  assert.equal(parsed.is_bot, true);
  assert.equal(parsed.bot_id, "B0LEGACY");
  assert.equal(parsed.user_id, undefined);
});

test("ST-UI-004: bot_profile alone (no subtype) still parses as BOT", () => {
  const parsed = parseUser({
    type: "message",
    bot_profile: { id: "U0BOT" },
    bot_id: "B0X",
    text: "no subtype variant",
    ts: "4.0",
  });
  assert.equal(parsed.user_type, "BOT");
  assert.equal(parsed.is_bot, true);
  assert.equal(parsed.user_id, "U0BOT");
});

test("ST-UI-005: app_mention from a bot parses as BOT", () => {
  const parsed = parseUser({
    type: "app_mention",
    subtype: "bot_message",
    user: "U0B91BVKTL2",
    bot_id: "B0BOT1",
    text: "<@U0B8VHLHJAX> please review",
    ts: "5.0",
  });
  assert.equal(parsed.user_type, "BOT");
  assert.equal(parsed.is_bot, true);
});

test("ST-UI-006: app_mention from a human parses as USER", () => {
  const parsed = parseUser({
    type: "app_mention",
    user: "U0AHDRREVPD",
    text: "<@U0B8VHLHJAX> help",
    ts: "6.0",
  });
  assert.equal(parsed.user_type, "USER");
  assert.equal(parsed.is_bot, false);
});

test("ST-UI-007: null/undefined payload never throws", () => {
  assert.deepEqual(parseUser(null), { user_type: "USER", is_bot: false });
  assert.deepEqual(parseUser(undefined), { user_type: "USER", is_bot: false });
});

// ---- requirement 4: isBotMessage helper ------------------------------------

test("ST-UI-008: isBotMessage true for bot payloads, false for humans", () => {
  assert.equal(
    isBotMessage({ subtype: "bot_message", bot_id: "B0X", user: "U0B" }),
    true,
  );
  assert.equal(
    isBotMessage({ bot_profile: { id: "U0B" }, bot_id: "B0X" }),
    true,
  );
  assert.equal(isBotMessage({ user: "U0AHDRREVPD" }), false);
  // Already-parsed identity is not re-parsed.
  const parsed: ParsedUser = { user_type: "BOT", bot_id: "B0X", is_bot: true };
  assert.equal(isBotMessage(parsed), true);
  // A StoredEvent carrying bot fields is read directly.
  assert.equal(isBotMessage(mkEvent({ is_bot: true, user_type: "BOT" })), true);
  assert.equal(isBotMessage(mkEvent({ is_bot: false })), false);
});

// ---- requirement 5-6: bot/human handler dispatch ----------------------------

function mkEvent(over: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: "evt-1",
    type: "message",
    channel: "C123",
    user: "U0AHDRREVPD",
    text: "hello",
    ts: "1.0",
    handled: false,
    received_at: 0,
    ...over,
  };
}

test("ST-UI-009: bot message routes to onBotMessage with rich identity", async () => {
  const botCalls: Array<{ event: StoredEvent; user: ParsedUser; ctx: unknown }> = [];
  const humanCalls: Array<{ event: StoredEvent; user: ParsedUser; ctx: unknown }> = [];
  const hooks = {
    onBotMessage: (event: StoredEvent, user: ParsedUser, ctx: unknown) => {
      botCalls.push({ event, user, ctx });
    },
    onHumanMessage: (event: StoredEvent, user: ParsedUser, ctx: unknown) => {
      humanCalls.push({ event, user, ctx });
    },
  };
  const event = mkEvent({ user: "U0B91BVKTL2", is_bot: true, user_type: "BOT", bot_id: "B0BOT1" });

  await dispatchMessageHandler(
    hooks,
    event,
    { user_id: "U0B91BVKTL2", user_type: "BOT", bot_id: "B0BOT1", is_bot: true },
    "cc",
  );

  assert.equal(botCalls.length, 1);
  assert.equal(humanCalls.length, 0);
  assert.equal((botCalls[0].ctx as { profileId: string }).profileId, "cc");
  assert.equal(botCalls[0].user.is_bot, true);
  assert.equal(botCalls[0].user.bot_id, "B0BOT1");
  assert.equal(botCalls[0].event.channel, "C123");
});

test("ST-UI-010: human message routes to onHumanMessage, not onBotMessage", async () => {
  let botCalled = 0;
  let humanCalled = 0;
  const hooks = {
    onBotMessage: () => { botCalled += 1; },
    onHumanMessage: () => { humanCalled += 1; },
  };
  const event = mkEvent();

  await dispatchMessageHandler(
    hooks,
    event,
    { user_id: "U0AHDRREVPD", user_type: "USER", is_bot: false },
    "cc",
  );

  assert.equal(humanCalled, 1);
  assert.equal(botCalled, 0);
});

test("ST-UI-011: missing hook is a no-op (does not throw)", async () => {
  const event = mkEvent();
  // onBotMessage not provided; a bot event must not throw.
  await dispatchMessageHandler(
    { onHumanMessage: () => {} },
    event,
    { user_id: "U0B", user_type: "BOT", bot_id: "B0X", is_bot: true },
    "cc",
  );
  assert.ok(true);
});

test("ST-UI-012: default hooks log without throwing for both kinds", async () => {
  const botEvent = mkEvent({ user: "U0B", is_bot: true, user_type: "BOT", bot_id: "B0X" });
  const humanEvent = mkEvent();
  // defaultMessageHandlerHooks are sync console.error — just ensure no throw.
  await dispatchMessageHandler(
    defaultMessageHandlerHooks,
    botEvent,
    { user_id: "U0B", user_type: "BOT", bot_id: "B0X", is_bot: true },
    "cc",
  );
  await dispatchMessageHandler(
    defaultMessageHandlerHooks,
    humanEvent,
    { user_id: "U0AHDRREVPD", user_type: "USER", is_bot: false },
    "cc",
  );
  assert.ok(true);
});

// ---- requirement 7: config knob on/off -------------------------------------

test("ST-UI-013: feature enabled by default", () => {
  const prev = process.env.GATEWAY_BOT_MESSAGE_HANDLING;
  delete process.env.GATEWAY_BOT_MESSAGE_HANDLING;
  try {
    assert.equal(botMessageHandlingEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_BOT_MESSAGE_HANDLING;
    else process.env.GATEWAY_BOT_MESSAGE_HANDLING = prev;
  }
});

test("ST-UI-014: GATEWAY_BOT_MESSAGE_HANDLING=0 disables handler dispatch", async () => {
  const prev = process.env.GATEWAY_BOT_MESSAGE_HANDLING;
  process.env.GATEWAY_BOT_MESSAGE_HANDLING = "0";
  try {
    assert.equal(botMessageHandlingEnabled(), false);
    let botCalled = 0;
    await dispatchMessageHandler(
      { onBotMessage: () => { botCalled += 1; } },
      mkEvent(),
      { user_id: "U0B", user_type: "BOT", bot_id: "B0X", is_bot: true },
      "cc",
    );
    assert.equal(botCalled, 0, "handler must not fire when knob is off");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_BOT_MESSAGE_HANDLING;
    else process.env.GATEWAY_BOT_MESSAGE_HANDLING = prev;
  }
});
