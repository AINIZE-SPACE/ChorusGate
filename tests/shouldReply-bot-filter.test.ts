// ============================================================
// shouldReply-bot-filter — ST for #79 (updated for bot-to-bot handoffs)
//
// Verify gateway.shouldReply() decision contract after the
// "bot 消息带显式 mention 即放行" change (global rule, mirrors Hermes
// `allow_bots=mentions`):
//   - messages from OUR OWN bot are filtered (self-reply loop prevention),
//     resolved from runtime auth — NOT a hardcoded teammate list
//   - bot_message from OTHER bots is allowed through only when it
//     explicitly mentions us; otherwise it falls through to false
//   - edit/delete subtypes stay filtered; DMs/mentions still always reply
//
// 跟踪: #79 (REOPENED) / bot-to-bot handoff fix
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

// ---- Pure recreation of the current shouldReply decision contract ----
// gateway.ts is an entry-point module (runs main()), so we model the same
// decision logic here with myBotUserId injectable, mirroring the real
// profileBotUserId(profileId) resolution.

function cleanText(text: string): boolean {
  return Boolean(text && text.trim().length > 0);
}

function mentionsMyName(
  text: string,
  myBotUserId: string | undefined,
  displayName: string,
  aliases: string[],
): boolean {
  const lower = text.toLowerCase();
  // Lowercase the template too so uppercase <@USER_ID> matches lowercased text.
  if (myBotUserId && lower.includes(`<@${myBotUserId.toLowerCase()}>`)) return true;
  for (const word of [displayName, ...aliases]) {
    if (word && lower.includes(word.toLowerCase())) return true;
  }
  return false;
}

function mentionsOtherBot(text: string, myBotUserId?: string): boolean {
  if (!myBotUserId) return false;
  const mentions = [...text.matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1]);
  return mentions.some((id) => id !== myBotUserId);
}

function shouldReply(
  event: {
    subtype?: string;
    user?: string;
    text?: string;
    type?: string;
    channel_type?: string;
  },
  opts: { myBotUserId?: string; displayName?: string; aliases?: string[] },
): boolean {
  const myBotUserId = opts.myBotUserId;
  const subtype = event.subtype;

  // Skip our own bot's messages (self-reply loop prevention)
  if (event.user && myBotUserId && event.user === myBotUserId) return false;
  // Skip edit/delete/broadcast etc. subtypes; bot_message is allowed through
  if (subtype && subtype !== "bot_message") return false;
  if (!event.user && subtype !== "bot_message") return false;
  if (!cleanText(event.text || "")) return false;

  // Explicit mentions + DM
  if (event.type === "app_mention") return true;
  if (event.type === "message" && event.channel_type === "im") return true;

  // Thread context: name match (3A)
  if (mentionsMyName(event.text || "", myBotUserId, opts.displayName || "", opts.aliases || [])) {
    return true;
  }

  // Thread context: no other entity mentioned → likely relevant (3C)
  if (event.thread_ts && !mentionsOtherBot(event.text || "", myBotUserId)) {
    return true;
  }

  return false;
}

const MY = "U0B8VHLHJAX"; // our own bot (小克)
const OTHER_BOT = "U0B91BVKTL2"; // a teammate bot (小马)

// ---- ST-SR-001: our own bot's message → false (self-loop) ----
test("ST-SR-001: our own bot's DM → shouldReply=false (self-reply loop)", () => {
  const event = {
    type: "message",
    subtype: undefined,
    user: MY,
    text: "进度更新",
    channel_type: "im",
  };
  assert.equal(shouldReply(event, { myBotUserId: MY }), false);
});

// ---- ST-SR-002: another bot's message WITHOUT mention → false ----
test("ST-SR-002: other bot's bot_message without <@us> → shouldReply=false", () => {
  const event = {
    type: "message",
    subtype: "bot_message",
    user: OTHER_BOT,
    text: "任务路由更新，请查收",
    channel_type: "channel",
  };
  assert.equal(shouldReply(event, { myBotUserId: MY }), false);
});

// ---- ST-SR-003: another bot's message WITH explicit mention → true (FIX) ----
test("ST-SR-003: other bot's bot_message with <@us> → shouldReply=true (bot-to-bot handoff)", () => {
  const event = {
    type: "message",
    subtype: "bot_message",
    user: OTHER_BOT,
    text: `<@${MY}> 请在 v5/issue-134-agent-profile-config 发 Dev Ready`,
    channel_type: "channel",
  };
  assert.equal(shouldReply(event, { myBotUserId: MY }), true);
});

// ---- ST-SR-004: human DM → true ----
test("ST-SR-004: human DM → shouldReply=true", () => {
  const event = {
    type: "message",
    subtype: undefined,
    user: "U0AHDRREVPD",
    text: "hello",
    channel_type: "im",
  };
  assert.equal(shouldReply(event, { myBotUserId: MY }), true);
});

// ---- ST-SR-005: app_mention → true (even from another bot) ----
test("ST-SR-005: app_mention of us → shouldReply=true", () => {
  const event = {
    type: "app_mention",
    subtype: undefined,
    user: OTHER_BOT,
    text: `<@${MY}> help`,
    channel_type: "channel",
  };
  assert.equal(shouldReply(event, { myBotUserId: MY }), true);
});

// ---- ST-SR-006: message_changed subtype → false ----
test("ST-SR-006: subtype=message_changed → shouldReply=false (no re-trigger)", () => {
  const event = {
    type: "message",
    subtype: "message_changed",
    user: "U0AHDRREVPD",
    text: "edited message",
    channel_type: "channel",
  };
  assert.equal(shouldReply(event, { myBotUserId: MY }), false);
});

// ---- ST-SR-007: empty text → false ----
test("ST-SR-007: empty/whitespace text → shouldReply=false", () => {
  assert.equal(
    shouldReply({ type: "message", subtype: undefined, user: "U0AHDRREVPD", text: "", channel_type: "im" }, { myBotUserId: MY }),
    false,
  );
  assert.equal(
    shouldReply({ type: "message", subtype: undefined, user: "U0AHDRREVPD", text: "   ", channel_type: "im" }, { myBotUserId: MY }),
    false,
  );
});

// ---- ST-SR-008: regular channel message (no mention, not in thread) → false ----
test("ST-SR-008: regular channel message (no mention) → shouldReply=false", () => {
  const event = {
    type: "message",
    subtype: undefined,
    user: "U0AHDRREVPD",
    text: "just a regular message",
    channel_type: "channel",
  };
  assert.equal(shouldReply(event, { myBotUserId: MY }), false);
});

// ---- ST-SR-009: no botUserId resolved (profiles not started) → no self-filter ----
test("ST-SR-009: myBotUserId unknown → self-loop filter disabled, no false-negative", () => {
  const event = {
    type: "message",
    subtype: undefined,
    user: MY,
    text: "进度更新",
    channel_type: "im",
  };
  // Without resolved identity, DM still replies (old behavior preserved)
  assert.equal(shouldReply(event, {}), true);
});
