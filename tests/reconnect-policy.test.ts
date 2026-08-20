// ============================================================
// reconnect-policy.test — #148 指数退避 + 抖动 + 熔断
//
// 纯逻辑、假时钟驱动：验证退避序列指数增长、抖动落在 ±jitterRatio、
// 熔断在连续失败后打开、冷却后 half-open 自愈、recordSuccess 复位。
// ============================================================

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ReconnectPolicy } from "../src/reconnect-policy.js";

/** 可控时钟 + 可控随机源（random 固定 0.5 → 抖动 0，便于断言精确值）。 */
function makePolicy(overrides: Record<string, number> = {}) {
  let nowMs = 0;
  const policy = new ReconnectPolicy({
    baseDelayMs: 1000,
    maxDelayMs: 60_000,
    multiplier: 2,
    jitterRatio: 0.3,
    circuitOpenAfter: 5,
    circuitCooldownMs: 300_000,
    now: () => nowMs,
    random: () => 0.5,
    ...overrides,
  });
  return {
    policy,
    advance: (ms: number) => {
      nowMs += ms;
      return nowMs;
    },
    now: () => nowMs,
  };
}

describe("ReconnectPolicy — exponential backoff", () => {
  it("grows delays exponentially with consecutive failures", () => {
    const { policy } = makePolicy();
    // random()=0.5 → jitter = base * 0.3 * (0.5*2-1) = 0 → 精确指数值。
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      policy.recordFailure();
      delays.push(policy.nextDelayMs());
    }
    assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
  });

  it("caps the delay at maxDelayMs", () => {
    const { policy } = makePolicy({ maxDelayMs: 5000 });
    for (let i = 0; i < 6; i++) policy.recordFailure();
    assert.ok(policy.nextDelayMs() <= 5000);
    assert.ok(policy.nextDelayMs() >= 0);
  });

  it("jitters within ±jitterRatio", () => {
    let r = 0.0;
    const policy = new ReconnectPolicy({
      baseDelayMs: 1000,
      maxDelayMs: 10_000,
      multiplier: 2,
      jitterRatio: 0.3,
      circuitOpenAfter: 99,
      circuitCooldownMs: 1000,
      now: () => 0,
      random: () => {
        r += 0.2; // 0.2/0.4/0.6/0.8/1.0 → 抖动比例 -0.18/-0.06/0.06/0.18/0.30
        return r;
      },
    });
    policy.recordFailure();
    const d = policy.nextDelayMs();
    // base=1000，jitterRatio=0.3 → 允许 [700, 1300]
    assert.ok(d >= 700 && d <= 1300, `delay ${d} out of jitter band`);
  });
});

describe("ReconnectPolicy — circuit breaker", () => {
  it("opens after circuitOpenAfter consecutive failures", () => {
    const { policy } = makePolicy({ circuitOpenAfter: 3 });
    assert.equal(policy.recordFailure().opened, false);
    assert.equal(policy.recordFailure().opened, false);
    assert.equal(policy.canAttempt(), true);
    assert.equal(policy.recordFailure().opened, true);
    assert.equal(policy.canAttempt(), false);
    assert.equal(policy.consecutiveFailures(), 3);
  });

  it("reopens attempts after cooldown expires (half-open)", () => {
    const { policy, advance } = makePolicy({ circuitOpenAfter: 2, circuitCooldownMs: 100_000 });
    policy.recordFailure();
    policy.recordFailure(); // 熔断打开
    assert.equal(policy.canAttempt(), false);
    advance(99_999);
    assert.equal(policy.canAttempt(), false, "still inside cooldown");
    advance(2);
    assert.equal(policy.canAttempt(), true, "half-open after cooldown");
  });

  it("recordSuccess resets failures and closes the circuit", () => {
    const { policy, advance } = makePolicy({ circuitOpenAfter: 2, circuitCooldownMs: 100_000 });
    policy.recordFailure();
    policy.recordFailure();
    assert.equal(policy.canAttempt(), false);
    policy.recordSuccess();
    assert.equal(policy.canAttempt(), true);
    assert.equal(policy.consecutiveFailures(), 0);
    // firstFailureAt 复位 → shouldExitForWatchdog 依据归零。
    advance(50_000);
    assert.equal(policy.firstFailureAt(), 0);
  });

  it("tracks firstFailureAt for down-time accounting", () => {
    const { policy, advance, now } = makePolicy();
    assert.equal(policy.firstFailureAt(), 0);
    advance(10_000);
    policy.recordFailure();
    const first = policy.firstFailureAt();
    assert.equal(first, 10_000);
    advance(5_000);
    assert.equal(policy.firstFailureAt(), first, "firstFailureAt unchanged across failures");
    assert.equal(now() - first, 5_000);
  });

  it("circuitRemainingMs counts down to zero", () => {
    const { policy, advance } = makePolicy({ circuitOpenAfter: 1, circuitCooldownMs: 60_000 });
    policy.recordFailure();
    assert.equal(policy.circuitRemainingMs(), 60_000);
    advance(30_000);
    assert.equal(policy.circuitRemainingMs(), 30_000);
    advance(30_001);
    assert.equal(policy.circuitRemainingMs(), 0);
  });
});
