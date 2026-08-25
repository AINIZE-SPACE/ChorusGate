// ============================================================
// shouldReply-special-mention — 验收语料 for #133 C1
//
// 小马 · 工号002 · 2026-08-24 · 基点 main@caf3505
// 分支 v5/issue-133-c1-acceptance（预置验收弹药，RED→GREEN）
//
// 背景：#133 spec（2026-08-24 08:2x comment）C1 缺口——接收侧不识别
// Slack 特殊 mention（<!everyone> / <!here> / <!channel>），shouldReply
// L2-L4 均无分支。本文件在实现落地前预置黑盒验收语料：
//   - 当前基点 caf3505 上 ST-SM-001~005 为 RED（证明语料真的在测缺口）
//   - C1 落地（L2 增加特殊 mention 识别，写死非配置）后转 GREEN
//
// 契约（对应 spec C1 + 小克实施注记 2026-08-24 08:13）：
//   1. 频道顶级人类消息含 <!everyone>/< !here>/< !channel> → shouldReply=true
//      （等价于"被@"，进 L2 显式 mention 分支，写死非配置）
//   2. 含 |label 后缀的规范形态（<!everyone|team>）同样命中
//   3. 边界：仅当消息来自人类（bot_message 仍走 bot gate）；self-loop
//      过滤优先于特殊 mention（自家 bot 发的 @everyone 不自触发）；
//      纯字面词 "everyone"（无 <!...> 语法）不触发——Slack 语法即契约。
//   4. 不变量回归：特殊 mention 命中不影响 L1 硬过滤（subtype/空文本）。
//
// 与 shouldReply-bot-filter.test.ts 的关系：ST-SR-003 已覆盖 bot 显式
// <@ID> 放行；本文件专注 C1 新契约，不重复 #79 用例。
//
// 跟踪: #133 / C1
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { shouldReply } from "../src/shouldReply.js";
import type { StoredEvent } from "../src/types.js";

// 与 bot-filter ST 一致：清掉 env 门，让管线跑默认值（L3 on, L4 off）
delete process.env.GATEWAY_THREAD_SMART_REPLY;
delete process.env.GATEWAY_LLM_REPLY_JUDGE;

const MY = "U0B8VHLHJAX"; // 自家 bot（小克侧视角）
const HUMAN = "U0AHDRREVPD";

const baseCtx = {
  myBotUserId: MY,
  triggers: { botUserId: MY, displayName: "cc", aliases: [] },
  isThreadParentBot: async () => false,
  isActiveInThread: () => false,
};

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

// ---- ST-SM-001: 三种特殊 mention 顶级消息均应回复 ----
test("ST-SM-001: channel 顶级消息含 <!everyone> → shouldReply=true（C1 主契约）", async () => {
  const event = mkEvent({ subtype: undefined, text: "<!everyone> 站会开始，请各自同步", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

test("ST-SM-001b: channel 顶级消息含 <!here> → shouldReply=true", async () => {
  const event = mkEvent({ subtype: undefined, text: "<!here> 谁在看 ChorusGate 的日志", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

test("ST-SM-001c: channel 顶级消息含 <!channel> → shouldReply=true", async () => {
  const event = mkEvent({ subtype: undefined, text: "<!channel> 发布窗口在今晚", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

// ---- ST-SM-002: |label 后缀规范形态 ----
test("ST-SM-002: <!everyone|team> 带 label 后缀 → shouldReply=true（Slack RTM 规范形态）", async () => {
  const event = mkEvent({ subtype: undefined, text: "<!everyone|team> sync time", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});

// ---- ST-SM-003: 边界 — 自家 bot 发的特殊 mention 不自触发 ----
test("ST-SM-003: 自家 bot 的 <!everyone> → shouldReply=false（self-loop 优先）", async () => {
  const event = mkEvent({ subtype: undefined, user: MY, text: "<!everyone> 我已发布周报", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), false);
});

// ---- ST-SM-004: 边界 — 纯字面词不误触 ----
test("ST-SM-004: 纯文本 \"everyone\"（无 Slack 语法）→ shouldReply=false（语法即契约）", async () => {
  const event = mkEvent({ subtype: undefined, text: "everyone 请注意分工", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), false);
});

// ---- ST-SM-005: 不变量 — L1 硬过滤仍在特殊 mention 之前 ----
test("ST-SM-005: subtype=message_changed + <!everyone> → shouldReply=false（L1 优先）", async () => {
  const event = mkEvent({ subtype: "message_changed", text: "<!everyone> 编辑后的广播", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), false);
});

test("ST-SM-005b: 文本仅含特殊 mention → shouldReply=true（mention 本身即内容）", async () => {
  // cleanText 只剥 <@ID>，特殊 mention 留存 → 非空，L1 放行；C1 后 L2 命中
  const event = mkEvent({ subtype: undefined, text: "<!here>", channel_type: "channel" });
  assert.equal(await shouldReply(event, baseCtx), true);
});
