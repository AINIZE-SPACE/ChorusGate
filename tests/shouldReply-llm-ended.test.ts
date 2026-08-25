// ============================================================
// shouldReply-llm-ended — 验收语料 for #133 C2
//
// 小马 · 工号002 · 2026-08-25 · 基点 main@77a7304
// 分支 v5/issue-133-c2-acceptance（预置验收弹药，RED→GREEN）
//
// 背景：#133 spec（2026-08-24 08:2x comment）C2 缺口——
// ALLOW_MENTION_REPLIED_USER=true + LLM 判对话结束：
// bot↔bot 对话"何时结束"由大模型判定，判定结束后 bot 不再
// 自动接话、除非再次被@。现状 shouldReply 的 3B/3C 命中即
// 短路 return true，L4 llmShouldReply（GATEWAY_LLM_REPLY_JUDGE
// 默认 off）对 thread 自动接话路径完全无话语权，也无 thread
// 级 conversation-ended 语义。
//
// 契约（对应 spec C2 + 小克实施注记 2026-08-24 08:13，行为级
// 断言、不锁实现路径——用状态钩子还是即时判定由实施定）：
//   1. JUDGE=1 时，thread 内自动接话路径（3B/3C）受 LLM 判定
//      门控：llmShouldReply 判 NO（含 ended 语义）→ 不回复。
//   2. 判 YES → 正常回复（门控不误伤正常 thread 对话）。
//   3. 显式触发优先于 ended 门控：<@ID> / mention_patterns
//      （3A）/ app_mention / DM / C1 特殊 mention 再@必回，
//      即"判定结束后不再自动接话，除非再次被@"。
//   4. JUDGE off（默认）时 3B/3C 行为不变——默认 off 无回归。
//   5. bot_message（#139 协作路径）同样受门控：显式@豁免，
//      无@的 thread 接话被 ended 拦截。
//
// 注：3B（thread parent 是自家消息）是否豁免门控属实施取舍，
// 本语料按 spec"不再自动接话"最小争议读法断言（ST-C2-007），
// 小克评审时可裁；若裁豁免，仅改该用例断言即可。
//
// RED 基线 @77a7304：ST-C2-002/004/007 RED（3 正向，证明语料
// 真的在测缺口），其余 6 条 GREEN（不变量保护）。C2 落地后全绿。
//
// 跟踪: #133 / C2
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { shouldReply } from "../src/shouldReply.js";
import type { StoredEvent } from "../src/types.js";

const MY = "U0B8VHLHJAX"; // 自家 bot（小克侧视角）
const HUMAN = "U0AHDRREVPD";
const OTHER_BOT = "U0BAGFVD8VB"; // 同事 bot（如小扣）

function judgeOn() {
  process.env.GATEWAY_LLM_REPLY_JUDGE = "1";
}
function judgeOff() {
  delete process.env.GATEWAY_LLM_REPLY_JUDGE;
}
// 每条用例自行声明 JUDGE 状态；THREAD_SMART_REPLY 保持默认 on
delete process.env.GATEWAY_THREAD_SMART_REPLY;

const baseCtx = (llmVerdict: boolean) => ({
  myBotUserId: MY,
  triggers: { botUserId: MY, displayName: "cc", aliases: ["小克"] },
  isThreadParentBot: async () => false,
  isActiveInThread: () => false,
  llmShouldReply: async () => llmVerdict,
});

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
    ts: "200",
    thread_ts: "100", // 默认 thread 内消息（≠ts → 3B/3C 分支可达）
    handled: false,
    received_at: 0,
    raw: { channel_type: channel_type ?? "channel" },
    ...rest,
  };
}

// ---- ST-C2-001: 门控不误伤 — LLM 判继续时 thread 自动接话照常 ----
test("ST-C2-001: thread 3C 活跃 + JUDGE=1 + llm=YES → shouldReply=true", async () => {
  judgeOn();
  const ctx = { ...baseCtx(true), isActiveInThread: () => true };
  const event = mkEvent({ subtype: undefined, text: "那这个方案就定了" });
  assert.equal(await shouldReply(event, ctx), true);
});

// ---- ST-C2-002: C2 主契约 — LLM 判 ended 后不再自动接话 ----
test("ST-C2-002: thread 3C 活跃 + JUDGE=1 + llm=NO(ended) → shouldReply=false", async () => {
  judgeOn();
  const ctx = { ...baseCtx(false), isActiveInThread: () => true };
  const event = mkEvent({ subtype: undefined, text: "好的收到" });
  assert.equal(await shouldReply(event, ctx), false);
});

// ---- ST-C2-003: 再@恢复 — 显式 <@ID> 优先于 ended 门控 ----
test("ST-C2-003: thread 内显式 <@ID> + llm=NO → shouldReply=true（再@必回）", async () => {
  judgeOn();
  const ctx = { ...baseCtx(false), isActiveInThread: () => true };
  const event = mkEvent({
    subtype: undefined,
    text: `<@${MY}> 补充一个问题`,
  });
  assert.equal(await shouldReply(event, ctx), true);
});

// ---- ST-C2-004: bot↔bot 无@接话被 ended 拦截（#139 协作收口）----
test("ST-C2-004: bot_message thread 3C + JUDGE=1 + llm=NO → shouldReply=false", async () => {
  judgeOn();
  const ctx = { ...baseCtx(false), isActiveInThread: () => true };
  const event = mkEvent({
    subtype: "bot_message",
    user: OTHER_BOT,
    text: "报告已提交，等待审核",
  });
  assert.equal(await shouldReply(event, ctx), false);
});

// ---- ST-C2-004b: bot 显式@豁免 ended（协作移交必达）----
test("ST-C2-004b: bot_message 显式 <@ID> + llm=NO → shouldReply=true", async () => {
  judgeOn();
  const ctx = { ...baseCtx(false), isActiveInThread: () => true };
  const event = mkEvent({
    subtype: "bot_message",
    user: OTHER_BOT,
    text: `<@${MY}> 请接手评审 PR#155`,
  });
  assert.equal(await shouldReply(event, ctx), true);
});

// ---- ST-C2-005: 默认 off 无回归 — JUDGE 关闭时 3C 行为不变 ----
test("ST-C2-005: thread 3C 活跃 + JUDGE off → shouldReply=true（默认语义保留）", async () => {
  judgeOff();
  const ctx = { ...baseCtx(false), isActiveInThread: () => true };
  const event = mkEvent({ subtype: undefined, text: "那这个方案就定了" });
  assert.equal(await shouldReply(event, ctx), true);
});

// ---- ST-C2-006: DM 不受 ended 门控（L2 im 直通）----
test("ST-C2-006: DM + JUDGE=1 + llm=NO → shouldReply=true（DM 必回）", async () => {
  judgeOn();
  const event = mkEvent({
    subtype: undefined,
    text: "在吗，帮我看个问题",
    channel_type: "im",
  });
  assert.equal(await shouldReply(event, baseCtx(false)), true);
});

// ---- ST-C2-006b: C1 特殊 mention 优先于 ended 门控（C1→C2 不回归）----
test("ST-C2-006b: 顶级 <!everyone> + JUDGE=1 + llm=NO → shouldReply=true", async () => {
  judgeOn();
  const event = mkEvent({
    subtype: undefined,
    text: "<!everyone> 站会开始",
    thread_ts: undefined,
    channel_type: "channel",
  });
  assert.equal(await shouldReply(event, baseCtx(false)), true);
});

// ---- ST-C2-007: 3B（thread parent 自家消息）同受 ended 门控 ----
// 注：3B 是否豁免属实施取舍，此处按 spec"不再自动接话"最小争议
// 读法断言；小克评审可裁，裁豁免则仅改本用例。
test("ST-C2-007: thread parent 自家消息(3B) + JUDGE=1 + llm=NO → shouldReply=false", async () => {
  judgeOn();
  const ctx = { ...baseCtx(false), isThreadParentBot: async () => true };
  const event = mkEvent({ subtype: undefined, text: "好的收到" });
  assert.equal(await shouldReply(event, ctx), false);
});
