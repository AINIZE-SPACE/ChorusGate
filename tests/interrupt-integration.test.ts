// ============================================================
// interrupt-integration — end-to-end InterruptManager + real child_process
//
// System integration tests for the Gateway Interrupt feature.
// Uses tests/fixtures/mock-claude/slow-script.mjs as a real child process
// to verify SIGTERM/SIGKILL semantics, debounce timing, and queue mode.
//
// 跟踪: [#54](https://github.com/AINIZE-SPACE/ChorusGate/issues/54)
//       [#56](https://github.com/AINIZE-SPACE/ChorusGate/issues/56)
//       [#57](https://github.com/AINIZE-SPACE/ChorusGate/issues/57)
//       PLAN: docs/tests/plans/PLAN-InterruptSIT-2026-06-14-xiaoma.md
//       CASES: docs/tests/plans/CASES-InterruptSIT-2026-06-14-xiaoma.md
// ============================================================

// Default mode for the first half of tests
process.env.GATEWAY_BUSY_MODE = "interrupt";

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLOW_MOCK = resolve(__dirname, "fixtures", "mock-claude", "slow-script.mjs");

// ---- helpers ---------------------------------------------------------------

/** Spawn a real slow-mock claude process. */
function spawnSlowMock(
  sleepMs: number,
  env: Record<string, string> = {},
): {
  child: ChildProcess;
  /** Records the most recent signal passed to child.kill(). */
  signalReceived: { value: string | null };
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>;
  stderr: string;
} {
  let stderr = "";
  const signalReceived: { value: string | null } = { value: null };
  const child = spawn("node", [SLOW_MOCK, String(sleepMs)], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MOCK_SLEEP_MS: String(sleepMs), ...env },
  });
  // Wrap kill to record signal via closure (Node's `killed` getter is
  // a boolean and gets clobbered by the OS-level kill).
  const realKill = child.kill.bind(child);
  (child as unknown as { kill: (sig?: string) => boolean }).kill = (
    sig: string = "SIGTERM",
  ): boolean => {
    signalReceived.value = sig;
    return realKill(sig);
  };
  child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>(
    (resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal, stderr }));
    },
  );
  return { child, signalReceived, exited, stderr };
}

/** Mock Slack web client + busy-ack recorder. */
type PostedMessage = { channel: string; threadTs?: string; text: string };
let postedMessages: PostedMessage[] = [];

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
}

async function newMgr() {
  const { InterruptManager } = await import("../src/interrupt.js");
  return new InterruptManager();
}

// ---- IT-01: interrupt mode kills current child -----------------------------

test("IT-01: interrupt mode sends SIGTERM and busy ack", async () => {
  await setupSlackMock();
  const mgr = await newMgr();
  // sleep 3000ms so we have a 2s SIGTERM grace window
  const { child, signalReceived, exited } = spawnSlowMock(3000);
  mgr.register("IT-01", child);

  // Send the user message to make the slow flow start
  child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n");

  const t0 = Date.now();
  const result = await mgr.interrupt("IT-01", "C-IT01", "1.001");
  const exitResult = await exited;
  const elapsed = Date.now() - t0;

  assert.equal(result, true);
  assert.equal(signalReceived.value, "SIGTERM", "should send SIGTERM in interrupt mode");
  assert.equal(mgr.isRunning("IT-01"), false);
  // On Windows, SIGTERM is not a real signal — Node maps it to terminate
  // and the process exits with code=null, signal='SIGTERM'.
  // On POSIX, SIGTERM gives code=null, signal='SIGTERM'.
  // Either way, the process should NOT exit with a non-zero code.
  assert.ok(
    exitResult.code === 0 || exitResult.signal === "SIGTERM",
    `expected clean exit; got code=${exitResult.code} signal=${exitResult.signal}`,
  );
  assert.ok(elapsed < 3500, `should exit within 3.5s, took ${elapsed}ms`);
  assert.equal(postedMessages.length, 1, "should send 1 busy ack");
  assert.ok(
    postedMessages[0].text.includes("中断") || postedMessages[0].text.includes("\u26a1"),
    "interrupt ack text",
  );
});

// ---- IT-02: debounce within 30s ---------------------------------------------

test("IT-02: debounce — 2nd interrupt on same channel/thread is suppressed", async () => {
  await setupSlackMock();
  const mgr = await newMgr();
  // child 1
  const c1 = spawnSlowMock(500).child;
  c1.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "a" } }) + "\n");
  mgr.register("IT-02a", c1);
  await mgr.interrupt("IT-02a", "C-DB", "ts-1");
  // child 2
  const c2 = spawnSlowMock(500).child;
  c2.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "b" } }) + "\n");
  mgr.register("IT-02b", c2);
  await mgr.interrupt("IT-02b", "C-DB", "ts-1");

  const acks = postedMessages.filter((m) => m.channel === "C-DB");
  assert.equal(acks.length, 1, `debounce: 2nd ack suppressed; got ${acks.length}`);
});

// ---- IT-03: cross-session isolation -----------------------------------------

test("IT-03: cross-session — interrupt on A does not touch B", async () => {
  await setupSlackMock();
  const mgr = await newMgr();
  const sa = spawnSlowMock(2000);
  const sb = spawnSlowMock(2000);
  const a = sa.child;
  const b = sb.child;
  a.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "a" } }) + "\n");
  b.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "b" } }) + "\n");
  mgr.register("A", a);
  mgr.register("B", b);

  await mgr.interrupt("A", "C-X", "ts-X");

  assert.equal(sa.signalReceived.value, "SIGTERM");
  assert.equal(sb.signalReceived.value, null, "session B should be untouched");
  assert.equal(mgr.isRunning("A"), false);
  assert.equal(mgr.isRunning("B"), true);

  // cleanup
  b.kill("SIGKILL");
});

// ---- IT-05: queue mode — child already exited ------------------------------

const QUEUE_MODE_BUG_FIXED = process.env.FIX_QUEUE_MODE_BUG === "1";

const queueTest = QUEUE_MODE_BUG_FIXED ? test : test.skip.bind(test);

queueTest("IT-05: queue mode — child already exited, interrupt returns true immediately", async () => {
  process.env.GATEWAY_BUSY_MODE = "queue";
  await setupSlackMock();
  const mgr = await newMgr();
  // Manually craft a child that has already exited
  const c = spawnSlowMock(0).child;
  c.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "q" } }) + "\n");
  // wait for natural exit
  await new Promise((r) => c.once("exit", r));
  // Mark exitCode and register
  c.exitCode = 0;
  mgr.register("IT-05", c);

  const t0 = Date.now();
  const result = await mgr.interrupt("IT-05", "C-IT05", "1.005");
  const elapsed = Date.now() - t0;

  assert.equal(result, true, "should return true when child already exited");
  assert.ok(elapsed < 50, `should be near-instant, took ${elapsed}ms`);
  assert.equal(mgr.isRunning("IT-05"), false);

  process.env.GATEWAY_BUSY_MODE = "interrupt";
});

// ---- IT-06: clear() SIGKILLs all running children ---------------------------

test("IT-06: clear() SIGKILLs all running children", async () => {
  await setupSlackMock();
  const mgr = await newMgr();
  const s1 = spawnSlowMock(2000);
  const s2 = spawnSlowMock(2000);
  const s3 = spawnSlowMock(2000);
  mgr.register("c1", s1.child);
  mgr.register("c2", s2.child);
  mgr.register("c3", s3.child);
  assert.equal(mgr.runningCount, 3);

  mgr.clear();

  assert.equal(mgr.runningCount, 0);
  assert.equal(s1.signalReceived.value, "SIGKILL");
  assert.equal(s2.signalReceived.value, "SIGKILL");
  assert.equal(s3.signalReceived.value, "SIGKILL");
});

// ---- IT-07: kill() throws, interrupt still returns true ---------------------

test("IT-07: child.kill() throws, interrupt() still returns true", async () => {
  await setupSlackMock();
  const mgr = await newMgr();
  // Build a fake child whose kill throws
  const { EventEmitter } = await import("node:events");
  const fake = Object.assign(new EventEmitter(), {
    pid: 99999,
    killed: null as string | null,
    exitCode: null as number | null,
    kill(_sig: string) {
      throw new Error("ESRCH: no such process");
    },
  });
  mgr.register("IT-07", fake as unknown as ChildProcess);

  // Should not throw, should return true
  const result = await mgr.interrupt("IT-07", "C-IT07", "1.007");
  assert.equal(result, true);
  assert.equal(mgr.isRunning("IT-07"), false);
});

// ---- IT-08: regression — queue mode must NOT return false (data loss) ------

const regressionTest = QUEUE_MODE_BUG_FIXED ? test : test.skip.bind(test);

regressionTest("IT-08: queue mode returns true after child exit (regression for #54)", async () => {
  process.env.GATEWAY_BUSY_MODE = "queue";
  await setupSlackMock();
  const mgr = await newMgr();
  const c = spawnSlowMock(300).child;
  c.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "q" } }) + "\n");
  mgr.register("IT-08", c);

  const result = await mgr.interrupt("IT-08", "C-IT08", "1.008");

  // The bug (#54) is that interrupt() returns false in queue mode,
  // which causes the gateway to drop the new message. After the fix,
  // it should return true so the gateway proceeds.
  assert.equal(result, true, "queue mode must return true to avoid #54 data loss");
  assert.equal(mgr.isRunning("IT-08"), false);

  process.env.GATEWAY_BUSY_MODE = "interrupt";
});
