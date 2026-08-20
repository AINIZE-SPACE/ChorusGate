// ============================================================
// liveness.test — Issue: 休眠唤醒后不恢复（挂起检测 + 假活检测）
//
// Drives LivenessMonitor directly with injected fake clocks/probes —
// no real timers. Covers spec AC1 (auto-reconnect escalation path),
// AC4 (zero noise on normal ticks), AC7 (suspend log includes the
// jump duration), and the Layer 2/3 escalation contract.
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LivenessMonitor } from "../src/liveness.js";

interface LogEntry {
  level: string;
  msg: string;
}

interface Harness {
  mon: LivenessMonitor;
  logs: LogEntry[];
  events: string[];
  setConnected: (v: boolean) => void;
  setProbe: (fn: () => boolean) => void;
}

/** Build a monitor with a controllable connection probe + log recorder. */
function makeHarness(
  config: Record<string, unknown> = {},
  hookOverrides: Record<string, unknown> = {},
): Harness {
  const logs: LogEntry[] = [];
  const events: string[] = [];
  let connected = true;
  let probeFn: () => boolean = () => connected;
  const mon = new LivenessMonitor(
    { ...config } as never,
    {
      isConnected: () => probeFn(),
      log: (level, _module, msg) => {
        logs.push({ level, msg });
      },
      onSuspendDetected: (sec) => events.push(`suspend:${sec}`),
      onZombieDetected: () => events.push("zombie"),
      onUnrecoverable: () => events.push("unrecoverable"),
      ...hookOverrides,
    } as never,
  );
  return {
    mon,
    logs,
    events,
    setConnected: (v) => {
      connected = v;
    },
    setProbe: (fn) => {
      probeFn = fn;
    },
  };
}

describe("liveness Layer 1: suspend detection (clock jump)", () => {
  it("anchors on the first tick and stays silent on normal ticks (AC4)", () => {
    const h = makeHarness();
    h.mon.tick(0);
    h.mon.tick(5000);
    h.mon.tick(10000);
    assert.deepEqual(h.events, []);
    assert.equal(h.logs.length, 0); // zero noise
  });

  it("fires onSuspendDetected with rounded jump seconds when a tick is late (AC7)", () => {
    const h = makeHarness();
    h.mon.tick(0);
    h.mon.tick(70_000);
    assert.deepEqual(h.events, ["suspend:70"]);
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].level, "warn");
    assert.match(h.logs[0].msg, /suspend detected: 70s jump/);
  });

  it("respects a custom suspendJumpMs threshold", () => {
    const h = makeHarness({ suspendJumpMs: 30_000 });
    h.mon.tick(0);
    h.mon.tick(35_000); // 35s > 30s → fires
    assert.deepEqual(h.events, ["suspend:35"]);
  });

  it("does not fire for a jump below the threshold", () => {
    const h = makeHarness({ suspendJumpMs: 60_000 });
    h.mon.tick(0);
    h.mon.tick(30_000);
    assert.deepEqual(h.events, []);
    assert.equal(h.logs.length, 0);
  });
});

describe("liveness Layer 2: zombie-socket detection", () => {
  it("does not fire below the failure limit", () => {
    const h = makeHarness();
    h.setConnected(false);
    h.mon.probe();
    h.mon.probe();
    assert.deepEqual(h.events, []);
    assert.equal(h.logs.length, 0);
  });

  it("fires onZombieDetected on the failureLimit-th consecutive failure", () => {
    const h = makeHarness();
    h.setConnected(false);
    h.mon.probe();
    h.mon.probe();
    h.mon.probe(); // 3rd = limit
    assert.deepEqual(h.events, ["zombie"]);
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].level, "warn");
    assert.match(h.logs[0].msg, /zombie socket detected: 3 consecutive probe failures/);
  });

  it("resets the counter on a successful probe and logs recovery", () => {
    const h = makeHarness();
    h.setConnected(false);
    h.mon.probe();
    h.mon.probe();
    h.setConnected(true);
    h.mon.probe();
    assert.deepEqual(h.events, []); // never reached the limit
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].level, "info");
    assert.match(h.logs[0].msg, /socket healthy again after 2 failed probe/);
  });

  it("re-escalates after a failed forced reconnect (counter resets per escalation)", () => {
    const h = makeHarness();
    h.setConnected(false);
    h.mon.probe();
    h.mon.probe();
    h.mon.probe(); // zombie #1
    h.mon.probe();
    h.mon.probe();
    h.mon.probe(); // zombie #2 again
    assert.deepEqual(h.events, ["zombie", "zombie"]);
  });

  it("respects a custom failureLimit", () => {
    const h = makeHarness({ failureLimit: 2 });
    h.setConnected(false);
    h.mon.probe();
    h.mon.probe();
    assert.deepEqual(h.events, ["zombie"]);
  });

  it("treats a throwing probe as a failure", () => {
    const h = makeHarness();
    h.setProbe(() => {
      throw new Error("probe exploded");
    });
    h.mon.probe();
    h.mon.probe();
    h.mon.probe();
    assert.deepEqual(h.events, ["zombie"]);
  });

  it("is silent while the socket stays healthy (AC4)", () => {
    const h = makeHarness();
    for (let i = 0; i < 10; i++) h.mon.probe();
    assert.deepEqual(h.events, []);
    assert.equal(h.logs.length, 0);
  });
});

describe("liveness Layer 3: unrecoverable escalation", () => {
  it("calls onUnrecoverable when the zombie handler throws", () => {
    const h = makeHarness(
      {},
      {
        onZombieDetected: () => {
          throw new Error("reconnect exploded");
        },
      },
    );
    h.setConnected(false);
    h.mon.probe();
    h.mon.probe();
    h.mon.probe();
    assert.ok(h.events.includes("unrecoverable"));
  });
});

describe("liveness lifecycle", () => {
  it("stop() makes tick and probe no-ops (monitor disabled)", () => {
    const h = makeHarness();
    h.mon.start();
    h.mon.stop();
    h.mon.tick(0);
    h.mon.tick(70_000); // would fire if active
    h.setConnected(false);
    h.mon.probe();
    h.mon.probe();
    h.mon.probe();
    assert.deepEqual(h.events, []);
    assert.equal(h.logs.length, 0);
  });

  it("start() then stop() is idempotent and restartable", () => {
    const h = makeHarness();
    h.mon.start();
    h.mon.start(); // no-op
    h.mon.stop();
    h.mon.start();
    h.mon.stop();
    h.mon.tick(0);
    h.mon.tick(70_000);
    assert.deepEqual(h.events, []);
  });
});
