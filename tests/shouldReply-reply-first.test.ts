// ============================================================
// #133 C3 验收语料 — reply_to_mode=first（分段消息仅首段落频道顶层，
// 其余段进首段 thread）
//
// 契约（行为级，不锁实现路径）：
//   R1. 频道顶层回复被分段（>limit）时：
//       - 第 1 段 → 频道顶层（无 thread_ts）
//       - 第 2..N 段 → 挂在第 1 段消息下的同一 thread（thread_ts = 首段返回的 ts）
//   R2. 已在 thread 内的回复被分段时：所有段保持在该 thread（现行为不变）
//   R3. DM（无 replyThreadTs）：所有段仍为顶层消息（现行为不变）
//   R4. 短消息（≤limit，单段）不建 thread，行为不变
//   R5. mention 校验拦截（findMentionIssues）不受 C3 路由影响
//
// 语料模式：黑盒验收，mock WebClient 断言 postMessage 调用序列的
// thread_ts 路由。与 C1/C2 语料同模式：先于实现预置，RED 基线证明
// 缺口真实存在；实现落地后同套语料转 GREEN。
//
// 跟踪: [#133](https://github.com/AINIZE-SPACE/ChorusGate/issues/133)
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import {
  postSlackMessageChunks,
  SLACK_MESSAGE_CHUNK_LIMIT,
  splitSlackMessage,
} from "../src/slack-message.js";
import type { WebClient } from "@slack/web-api";

type PostMessageCall = {
  channel: string;
  text: string;
  thread_ts?: string;
};

/** mock WebClient：记录 postMessage 调用序列，ts 单调递增 */
function mockWeb(): { web: WebClient; calls: PostMessageCall[] } {
  const calls: PostMessageCall[] = [];
  let tsCounter = 1000;
  const web = {
    chat: {
      postMessage: async (args: PostMessageCall) => {
        calls.push(args);
        tsCounter += 1;
        return { ok: true, ts: `${tsCounter}.000`, channel: args.channel };
      },
    },
  } as unknown as WebClient;
  return { web, calls };
}

/** 生成 >minLen 的可分段长文本（多行，便于在换行处切分） */
function longText(minLen: number): string {
  const lines: string[] = [];
  let len = 0;
  let i = 0;
  while (len < minLen) {
    const line = `报告段 ${i}: ${"x".repeat(40)}`;
    lines.push(line);
    len += line.length + 1;
    i += 1;
  }
  return lines.join("\n");
}

/** mockWeb 首次 postMessage 返回的 ts（tsCounter 从 1001 起） */
const FIRST_TS = "1001.000";

// ------------------------------------------------------------
// R1 — 频道顶层回复分段：首段顶层，续段挂首段 thread（C3 本体）
// ------------------------------------------------------------

test("ST-C3-001: 顶层长回复 → 第1段落频道顶层，第2..N段挂首段thread", async () => {
  const { web, calls } = mockWeb();
  const text = longText(SLACK_MESSAGE_CHUNK_LIMIT * 2 + 100); // ≥3 段

  const chunks = splitSlackMessage(text);
  assert.ok(chunks.length >= 3, `expected ≥3 chunks, got ${chunks.length}`);

  await postSlackMessageChunks(web, { channel: "C123", text });

  assert.equal(calls.length, chunks.length);
  // 第 1 段：顶层（无 thread_ts）— reply_to_mode=first 本体
  assert.equal(
    calls[0].thread_ts,
    undefined,
    "首段必须落频道顶层（reply_to_mode=first）",
  );
  // 第 2..N 段：thread_ts = 首段返回的 ts
  for (let i = 1; i < calls.length; i++) {
    assert.equal(
      calls[i].thread_ts,
      FIRST_TS,
      `第${i + 1}段必须挂首段 thread（ts=${FIRST_TS}）`,
    );
  }
  // 内容完整性（splitSlackMessage 保证 join 后无损，这里核对逐段送达）
  assert.equal(calls.map((c) => c.text).join("\n"), text);
});

test("ST-C3-002: 两段场景 → 首段顶层 + 第2段挂首段thread", async () => {
  const { web, calls } = mockWeb();
  const text = longText(SLACK_MESSAGE_CHUNK_LIMIT + 100); // 恰 2 段

  await postSlackMessageChunks(web, { channel: "C456", text });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].thread_ts, undefined);
  assert.equal(calls[1].thread_ts, FIRST_TS);
});

// ------------------------------------------------------------
// R2 — thread 内回复分段：所有段保持在原 thread（零回归红线）
// ------------------------------------------------------------

test("ST-C3-003: thread内长回复 → 所有段保持在原thread（零回归）", async () => {
  const { web, calls } = mockWeb();
  const text = longText(SLACK_MESSAGE_CHUNK_LIMIT * 2 + 100);

  await postSlackMessageChunks(web, {
    channel: "C123",
    thread_ts: "123.456",
    text,
  });

  assert.ok(calls.length >= 3);
  for (const call of calls) {
    assert.equal(
      call.thread_ts,
      "123.456",
      "thread 内分段回复必须全部留在原 thread（零回归）",
    );
  }
});

// ------------------------------------------------------------
// R3 — DM：无 thread_ts 语义，所有段仍顶层（零回归红线）
// ------------------------------------------------------------

test("ST-C3-004: DM长回复 → 所有段均为顶层消息（不建thread）", async () => {
  const { web, calls } = mockWeb();
  const text = longText(SLACK_MESSAGE_CHUNK_LIMIT + 100);

  // DM 场景：调用方不传 thread_ts（gateway.ts 对 im 不设 replyThreadTs）
  await postSlackMessageChunks(web, { channel: "D123", text });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(
      call.thread_ts,
      undefined,
      "DM 分段消息必须全部保持顶层（不引入 thread 语义）",
    );
  }
});

// ------------------------------------------------------------
// R4 — 单段短消息：不建 thread，行为不变
// ------------------------------------------------------------

test("ST-C3-005: 短消息单段 → 顶层一条，无thread路由发生", async () => {
  const { web, calls } = mockWeb();

  await postSlackMessageChunks(web, { channel: "C123", text: "完成 ✅" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].thread_ts, undefined);
});

// ------------------------------------------------------------
// R5 — mention 校验拦截不受 C3 路由影响
// ------------------------------------------------------------

test("ST-C3-006: 含裸@的长消息 → mention拦截仍然生效（先于分段路由）", async () => {
  const { web, calls } = mockWeb();
  const badMention = `@小克 ${longText(SLACK_MESSAGE_CHUNK_LIMIT + 100)}`;

  await assert.rejects(
    () => postSlackMessageChunks(web, { channel: "C123", text: badMention }),
    /invalid Slack mention/,
    "裸 @ mention 必须在任何分段/路由发生前被拦截",
  );
  assert.equal(calls.length, 0, "拦截后不得有消息发出");
});
