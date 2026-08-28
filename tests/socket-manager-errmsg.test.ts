// ============================================================
// socket-manager-errmsg.test — #157 重连异常安全格式化 + 退避续连
//
// 2026-08-27 事故：Slack Socket Mode pong 超时后 forceReconnect 的 catch
// 里直接 `(err as Error).message`，而 Socket Mode 的 rejection 可能是
// `undefined` 或非 Error 值——读取 `.message` 再次抛 TypeError，变成新的
// unhandledRejection 把 daemon 打崩……正是我们要活下来的缺陷本身。
//
// 回归断言：
//   1) errMsg 对 undefined / null / 裸字符串 / 非 Error 对象 / 空信息
//      一律安全返回可打印字符串，绝不抛错。
//   2) errMsg 对真实 Error 保留其 message。
//   3) 断线后退避重连持续进行：连续失败 N 次仍给出非负延迟（循环不因
//      异常停滞），成功复位后重新开始。
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errMsg } from "../src/socket-manager.js";
import { ReconnectPolicy } from "../src/reconnect-policy.js";

describe("errMsg — #157 安全格式化任意 rejection 值", () => {
  it("never throws and returns a fallback for `undefined` (事故输入)", () => {
    // 这正是 2026-08-27 的崩溃输入：catch (err) 中 err === undefined。
    assert.equal(errMsg(undefined), "unknown error");
  });

  it("handles null", () => {
    assert.equal(errMsg(null), "unknown error");
  });

  it("returns a bare string rejection verbatim", () => {
    assert.equal(errMsg("pong not received"), "pong not received");
  });

  it("preserves a real Error's message", () => {
    assert.equal(errMsg(new Error("WebSocket was closed")), "WebSocket was closed");
  });

  it("falls back for a non-Error object without a usable message", () => {
    assert.equal(errMsg({ code: 1006 }), "unknown error");
  });

  it("returns a custom fallback instead of crashing when no message exists", () => {
    assert.equal(errMsg(undefined, "(no detail)"), "(no detail)");
  });

  it("stringifies primitive/non-Error values safely (never throws)", () => {
    // 数字/布尔走 String() 分支；空串无 message 走 fallback——都不抛。
    assert.equal(errMsg(0), "0");
    assert.equal(errMsg(1006), "1006");
    assert.equal(errMsg(""), "unknown error");
  });
});

describe("reconnect continuation — 断线后退避重连持续（#157）", () => {
  /** 固定抖动为 0 的假时钟 policy。 */
  function makePolicy() {
    let nowMs = 0;
    const policy = new ReconnectPolicy({
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
      multiplier: 2,
      jitterRatio: 0,
      circuitOpenAfter: 5,
      circuitCooldownMs: 0,
      now: () => nowMs,
      random: () => 0.5,
    });
    return { policy, advance: (ms: number) => (nowMs += ms) };
  }

  it("keeps producing backoff delays across many failures (loop never stalls)", () => {
    const { policy } = makePolicy();
    let prev = 0;
    for (let i = 1; i <= 8; i++) {
      policy.recordFailure();
      const next = policy.nextDelayMs();
      assert.ok(
        next >= prev,
        `delay at failure #${i} (${next}) should not regress from ${prev}`,
      );
      prev = next;
    }
    assert.ok(prev >= 8000, "backoff should have grown exponentially");
  });

  it("continues to schedule after the failure that would have crashed", () => {
    // 模拟 reconnect 失败（连 failure #4-#5 仍返回非负延迟，驱动下一次尝试）。
    const { policy } = makePolicy();
    for (let i = 0; i < 4; i++) policy.recordFailure();
    const d5 = policy.nextDelayMs();
    policy.recordFailure();
    const d6 = policy.nextDelayMs();
    assert.ok(Number.isFinite(d5) && d5 > 0, `#4 delay ${d5} should be positive`);
    assert.ok(Number.isFinite(d6) && d6 > 0, `#5 delay ${d6} should be positive`);
  });

  it("recordSuccess resets so a later disconnect restarts from base delay", () => {
    const { policy } = makePolicy();
    for (let i = 0; i < 4; i++) policy.recordFailure();
    policy.recordSuccess();
    policy.recordFailure();
    // 复位后首失败回到 base delay，而非延续之前的大延迟。
    assert.equal(policy.nextDelayMs(), 1000);
  });
});