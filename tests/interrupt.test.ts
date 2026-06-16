// ============================================================
// InterruptManager — busy-ack + kill + queue mode tests
// 跟踪: [#54](https://github.com/AINIZE-SPACE/ChorusGate/issues/54)
//       [#56](https://github.com/AINIZE-SPACE/ChorusGate/issues/56)
//
// Note: BUSY_MODE is read at module-import time in src/interrupt.ts.
// These tests are organized into two halves: interrupt mode (default)
// and queue mode (set GATEWAY_BUSY_MODE=queue before this file imports).
// Each half runs its own InterruptManager instance via dynamic import.
// ============================================================

// Default mode for the first half of tests
process.env.GATEWAY_BUSY_MODE = "interrupt";

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

// ---- minimal ChildProcess stub ---------------------------------------------

/** Minimal stand-in for ChildProcess: emits events, records kill() calls. */
function makeFakeChild() {
  const ee = new EventEmitter();
  const child = Object.assign(ee, {
    pid: Math.floor(Math.random() * 100000),
    killed: null as string | null,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill(sig: string = "SIGTERM") {
      this.killed = sig;
      this.exitCode = 0;
      this.signalCode = sig;
      // emit exit asynchronously to mimic real OS behavior
      setImmediate(() => this.emit("exit", 0, sig));
      return true;
    },
  });
  return child;
}

// ---- Slack mock (uses _setWebClientForTests seam in src/interrupt.ts) ------

let postedMessages: Array<{ channel: string; threadTs?: string; text: string }> = [];

async function setupSlackMock() {
  postedMessages = [];
  const interrupt = (await import("../src/interrupt.js")) as unknown as {
    _setWebClientForTests: (getter: (() => unknown) | null) => void;
  };
  interrupt._setWebClientForTests(() => ({
    chat: {
      postMessage: async (opts: { channel: string; thread_ts?: string; text: string }) => {
        postedMessages.push({
          channel: opts.channel,
          threadTs: opts.thread_ts,
          text: opts.text,
        });
        return { ok: true, ts: "123.456" };
      },
    },
  }));
  return () => interrupt._setWebClientForTests(null);
}

// ---- interrupt mode tests (default) -----------------------------------------

test("InterruptManager: register + unregister lifecycle", async () => {
  await setupSlackMock();
  const { InterruptManager } = await import("../src/interrupt.js");
  const mgr = new InterruptManager();
  const child = makeFakeChild();

  assert.equal(mgr.isRunning("k1"), false);
  mgr.register("k1", child);
  assert.equal(mgr.isRunning("k1"), true);
  mgr.unregister("k1");
  assert.equal(mgr.isRunning("k1"), false);
});

test("InterruptManager: interrupt returns true when no process is running", async () => {
  await setupSlackMock();
  const { InterruptManager } = await import("../src/interrupt.js");
  const mgr = new InterruptManager();

  const result = await mgr.interrupt("nokey", "C123", "1.001");
  assert.equal(result, true);
  assert.equal(postedMessages.length, 0, "no busy ack when no process is running");
});

test("InterruptManager: interrupt mode calls child.kill(SIGTERM)", async () => {
  await setupSlackMock();
  const { InterruptManager } = await import("../src/interrupt.js");
  const mgr = new InterruptManager();
  const child = makeFakeChild();
  mgr.register("k2", child);

  const result = await mgr.interrupt("k2", "C123", "1.002");
  // give setImmediate a tick to fire the exit event so unregister happens
  await new Promise((r) => setImmediate(r));

  assert.equal(result, true);
  assert.equal(child.killed, "SIGTERM", "should send SIGTERM in interrupt mode");
  assert.equal(mgr.isRunning("k2"), false, "should be unregistered after exit");
  assert.equal(postedMessages.length, 1, "should send busy ack");
  assert.ok(
    postedMessages[0].text.includes("中断") || postedMessages[0].text.includes("\u26a1"),
    `interrupt ack text should contain 中断 or \u26a1, got: ${postedMessages[0].text}`,
  );
});

test("InterruptManager: sendBusyAck debounce \u2014 second call within 30s is suppressed", async () => {
  await setupSlackMock();
  const { InterruptManager } = await import("../src/interrupt.js");
  const mgr = new InterruptManager();
  const c1 = makeFakeChild();
  mgr.register("k4a", c1);
  await mgr.interrupt("k4a", "C-CONS", "ts-1");
  await new Promise((r) => setImmediate(r));

  const c2 = makeFakeChild();
  mgr.register("k4b", c2);
  await mgr.interrupt("k4b", "C-CONS", "ts-1");
  await new Promise((r) => setImmediate(r));

  const acks = postedMessages.filter((m) => m.channel === "C-CONS");
  assert.equal(acks.length, 1, `debounce should suppress 2nd ack; got ${acks.length}`);
});

test("InterruptManager: clear() SIGKILLs all running children and resets state", async () => {
  await setupSlackMock();
  const { InterruptManager } = await import("../src/interrupt.js");
  const mgr = new InterruptManager();
  const c1 = makeFakeChild();
  const c2 = makeFakeChild();
  mgr.register("k5a", c1);
  mgr.register("k5b", c2);
  assert.equal(mgr.runningCount, 2);

  mgr.clear();

  assert.equal(mgr.runningCount, 0);
  assert.equal(c1.killed, "SIGKILL", "should SIGKILL child 1 on clear");
  assert.equal(c2.killed, "SIGKILL", "should SIGKILL child 2 on clear");
});

test("InterruptManager: unregister is a no-op for unknown key", async () => {
  await setupSlackMock();
  const { InterruptManager } = await import("../src/interrupt.js");
  const mgr = new InterruptManager();
  mgr.unregister("never-registered");
  assert.equal(mgr.isRunning("never-registered"), false);
});
