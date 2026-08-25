// ============================================================
// shouldReply-bot-filter — ST for #79 (updated for bot-to-bot handoffs)
//
// Verify the extracted src/shouldReply.ts decision contract after the
// "bot 消息带显式 mention 即放行" change (global rule, mirrors Hermes
// `allow_bots=mentions`):
//   - messages from OUR OWN bot are filtered (self-reply loop prevention),
//     resolved from runtime auth — NOT a hardcoded teammate list
//   - bot_message from OTHER bots is allowed through only when it
//     explicitly mentions us; otherwise it falls through to false
//   - edit/delete subtypes stay filtered; DMs/mentions still always reply
//   - Level 3 thread logic (parent-is-bot / active-in-thread) via injected hooks
//
// Tests the REAL module (src/shouldReply.ts), not a recreation — gateway
// runtime hooks (web client, session store, LLM) are stubbed via
// ShouldReplyContext.
//
// 跟踪: #79 (REOPENED) / bot-to-bot handoff fix
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { shouldReply } from "../src/shouldReply.js";
import type { StoredEvent } from "../src/types.js";

// The module reads these env gates lazily at call time; clear them so the
// decision pipeline runs with defaults (Level 3 on, Level 4 off).
delete process.env.GATEWAY_THREAD_SMART_REPLY;
delete process.env.GATEWAY_LLM_REPLY_JUDGE;

const MY = "U0B8VHLHJAX"; // our own bot (小克)
const OTHER_BOT = "U0B91BVKTL2"; // a teammate bot (小马)
const HUMAN = "U0AHDRREVPD";

// Base decision context: a loaded profile (triggers) + inert thread hooks so
// only the cases that exercise 3B/3C override them.
const baseCtx = {
  myBotUserId: MY,
  triggers: { botUserId: MY, displayName: "cc", aliases: [] },
  isThreadParentBot: async () => false,
  isActiveInThread: () => false,
};

/** Build a StoredEvent; channel_type goes into raw (as the real gateway does). */
function mkEvent(
  over: Partial<StoredEvent> & { channel_type?: string },
): StoredEvent {
  const { channel_type, ...rest } = over;
  return {
    id: "test-id",
    type: "message",
    channel: "C0TEST",
    user: HUMAN,
    text: "",
    ts: "0",
    handled: false,
    received_at: 0,
    raw: { channel_type: channel_type ?? "channel" },
    ...rest,
  };
}

// ---- ST-SR-001: our own bot's message → false (self-loop) ----
test("ST-SR-001: our own bot's DM → shouldReply=false (self-reply loop)", async () => {
  const event = mkEvent({ subtype: undefined, user: MY, text: "进度更新", channel_type: "im" });
  assert.equal(await shouldReply(event, baseCtx), false);
});

// ---- ST-SR-002: another bot's message WITHOUT mention → false ----
test("ST-SR-002: other bot's bot_message without <@us> → shouldReply=false", async () => {
  const event = mkEvent({ subtype: "bot_message", user: OTHER_BOT, text: "任务路由更新，请查收", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), false);
});

// ---- ST-SR-003: another bot's message WITH explicit mention → true (FIX) ----
test("ST-SR-003: other bot's bot_message with <@us> → shouldReply=true (bot-to-bot handoff)", async () => {
  const event = mkEvent({ subtype: "bot_message", user: OTHER_BOT, text: `<@${MY}> 请在 v5/issue-134-agent-profile-config 发 Dev Ready`, channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

// ---- ST-SR-004: human DM → true ----
test("ST-SR-004: human DM → shouldReply=true", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "hello", channel_type: "im" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

// ---- ST-SR-005: app_mention → true (even from another bot) ----
test("ST-SR-005: app_mention of us → shouldReply=true", async () => {
  const event = mkEvent({ type: "app_mention", subtype: undefined, user: OTHER_BOT, text: `<@${MY}> help`, channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

// ---- ST-SR-006: message_changed subtype → false ----
test("ST-SR-006: subtype=message_changed → shouldReply=false (no re-trigger)", async () => {
  const event = mkEvent({ subtype: "message_changed", user: HUMAN, text: "edited message", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), false);
});

// ---- ST-SR-007: empty text → false ----
test("ST-SR-007: empty/whitespace text → shouldReply=false", async () => {
  assert.equal(
    await shouldReply(mkEvent({ user: HUMAN, text: "", channel_type: "im" }), baseCtx),
    false,
  );
  assert.equal(
    await shouldReply(mkEvent({ user: HUMAN, text: "   ", channel_type: "im" }), baseCtx),
    false,
  );
});

// ---- ST-SR-008: regular channel message (no mention, not in thread) → false ----
test("ST-SR-008: regular channel message (no mention) → shouldReply=false", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "just a regular message", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), false);
});

// ---- ST-SR-009: no botUserId resolved (profiles not started) → no self-filter ----
test("ST-SR-009: myBotUserId unknown → self-loop filter disabled, no false-negative", async () => {
  const event = mkEvent({ subtype: undefined, user: MY, text: "进度更新", channel_type: "im" });
  // Without resolved identity, DM still replies (old behavior preserved)
  assert.equal(await shouldReply(event, {}), true);
});

// ---- ST-SR-010: thread parent is our own bot → true (3B) ----
test("ST-SR-010: thread reply to our own parent message → shouldReply=true (3B)", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "回复一下", channel_type: "channel", thread_ts: "1.1", ts: "1.2" });
  assert.equal(
    await shouldReply(event, { ...baseCtx, isThreadParentBot: async () => true }),
    true,
  );
});

// ---- ST-SR-011: active-in-thread, no other mention → true (3C) ----
test("ST-SR-011: thread message, no other mention, we're active → shouldReply=true (3C)", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "这个方案可以", channel_type: "channel", thread_ts: "1.1", ts: "1.2" });
  assert.equal(
    await shouldReply(event, { ...baseCtx, isActiveInThread: () => true }),
    true,
  );
});

// ---- ST-SR-012: thread message addressing another bot → false (3C negative) ----
test("ST-SR-012: thread message mentioning another bot → shouldReply=false (3C)", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: `<@${OTHER_BOT}> 你来处理`, channel_type: "channel", thread_ts: "1.1", ts: "1.2" });
  assert.equal(
    await shouldReply(event, { ...baseCtx, isActiveInThread: () => true }),
    false,
  );
});

// ---- #133 C1: room-broadcast mentions (@everyone/@here/@channel) → true ----
test("#133 C1: @everyone channel message → shouldReply=true", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "<!everyone> 全体都有，晨会开始", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

test("#133 C1: @channel with |label suffix → shouldReply=true", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "<!channel|@channel> 请同步进度", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

test("#133 C1: @here → shouldReply=true", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "线上问题 <!here> 谁在", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

test("#133 C1: no special broadcast mention → shouldReply=false", async () => {
  const event = mkEvent({ subtype: undefined, user: HUMAN, text: "普通群消息", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), false);
});
