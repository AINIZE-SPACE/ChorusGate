// ============================================================
// InterruptManager queue mode test
// 跟踪: [#54](https://github.com/AINIZE-SPACE/ChorusGate/issues/54)
//
// This file is run with GATEWAY_BUSY_MODE=queue so the module-level
// BUSY_MODE constant is set correctly on import. Cannot be combined
// with interrupt-mode tests in the same file because module imports
// are cached for the test runner lifetime.
// ============================================================

process.env.GATEWAY_BUSY_MODE = "queue";

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

function makeFakeChild() {
  const ee = new EventEmitter();
  const child = Object.assign(ee, {
    pid: Math.floor(Math.random() * 100000),
    killed: null as string | null,
    exitCode: null as number | null,
    kill(sig: string = "SIGTERM") {
      this.killed = sig;
      this.exitCode = 0;
      setImmediate(() => this.emit("exit", 0, sig));
      return true;
    },
  });
  return child;
}

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

// #54: queue mode now awaits child exit before returning true.
// The gateway proceeds normally after the current task finishes.
test("InterruptManager queue mode: sends queue ack, awaits child exit, returns true", async () => {
  await setupSlackMock();
  const { InterruptManager } = await import("../src/interrupt.js");
  const mgr = new InterruptManager();
  const child = makeFakeChild();
  mgr.register("kq1", child);

  // Start the interrupt; it should await the child exit
  const interruptPromise = mgr.interrupt("kq1", "C-QUEUE", "1.500");

  // Verify busy ack was sent immediately (queue mode text)
  await new Promise((r) => setImmediate(r));
  assert.equal(postedMessages.length, 1, "queue ack sent before await");
  assert.ok(
    postedMessages[0].text.includes("排队") || postedMessages[0].text.includes("\u23f3"),
    `queue ack text should contain 排队 or \u23f3, got: ${postedMessages[0].text}`,
  );

  // Simulate child exit (this is what the OS would do when claude -p finishes)
  child.exitCode = 0;
  child.emit("exit", 0, null);
  const result = await interruptPromise;
  assert.equal(result, true, "queue mode should return true after child exits (NOT drop the message)");
  assert.equal(mgr.isRunning("kq1"), false, "should be unregistered after exit");
});
