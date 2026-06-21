// ============================================================
// DurableEventStore — unit tests
// Issue: [#1](https://github.com/AINIZE-SPACE/chorusgate/issues/1)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

test("DurableEventStore: state machine — pending → processing → replied", async () => {
  const { durableEventStore } = await import("../src/durable-event-store.js");

  const ts = "test-ts-" + Date.now();

  // Mark pending
  durableEventStore.markPending({
    ts,
    channel: "C01",
    user: "U01",
    type: "app_mention",
    text: "hello test",
  });

  const e1 = durableEventStore.getByTs(ts);
  assert.ok(e1, "event should exist after markPending");
  assert.equal(e1!.state, "pending");

  // Mark processing
  durableEventStore.markProcessing(ts);
  const e2 = durableEventStore.getByTs(ts);
  assert.equal(e2!.state, "processing");

  // Mark replied
  durableEventStore.markReplied(ts);
  const e3 = durableEventStore.getByTs(ts);
  assert.equal(e3!.state, "replied");

  // Dedup: should be true after replied
  assert.ok(durableEventStore.isDedup(ts), "replied events should be deduped");
});

test("DurableEventStore: state machine — fail and retry", async () => {
  const { durableEventStore } = await import("../src/durable-event-store.js");

  const ts = "test-fail-" + Date.now();

  durableEventStore.markPending({
    ts, channel: "C02", user: "U02", type: "message", text: "fail test",
  });

  durableEventStore.markProcessing(ts);
  durableEventStore.markFailed(ts, "timeout error");

  const e = durableEventStore.getByTs(ts);
  assert.equal(e!.state, "failed");
  assert.ok(e!.error?.includes("timeout"));

  // Retry: markPending on an already-failed event should reset to pending
  durableEventStore.markPending({
    ts, channel: "C02", user: "U02", type: "message", text: "fail test retry",
  });
  const e2 = durableEventStore.getByTs(ts);
  assert.equal(e2!.state, "pending", "failed events should reset to pending on retry");
  assert.equal(e2!.retries, 1);
});

test("DurableEventStore: replayable returns pending + stale processing events", async () => {
  const { durableEventStore } = await import("../src/durable-event-store.js");

  const tsP = "test-replay-pending-" + Date.now();
  const tsS = "test-replay-stale-" + Date.now();

  durableEventStore.markPending({
    ts: tsP, channel: "C03", type: "app_mention", text: "pending",
  });
  durableEventStore.markPending({
    ts: tsS, channel: "C04", type: "message", text: "stale",
  });

  // Simulate stale processing
  const staleEvent = durableEventStore.getByTs(tsS);
  if (staleEvent) {
    staleEvent.state = "processing";
    staleEvent.updated_at = Date.now() - 10 * 60 * 1000; // 10 min ago
  }

  const replayable = durableEventStore.getReplayable();
  const tsList = replayable.map((e) => e.ts);
  assert.ok(tsList.includes(tsP), "pending events should be replayable");
  assert.ok(tsList.includes(tsS), "stale processing events should be replayable");
});

test("DurableEventStore: dedup — fresh processing is not replayable", async () => {
  const { durableEventStore } = await import("../src/durable-event-store.js");

  const ts = "test-fresh-" + Date.now();

  durableEventStore.markPending({
    ts, channel: "C05", type: "message", text: "fresh",
  });
  durableEventStore.markProcessing(ts);

  // Fresh processing (< 5 min) should NOT be replayable
  const replayable = durableEventStore.getReplayable();
  const found = replayable.find((e) => e.ts === ts);
  assert.equal(found, undefined, "fresh processing events should not be replayable");

  // But isDedup should be true (prevents duplicate processing in current run)
  assert.ok(durableEventStore.isDedup(ts), "fresh processing should be deduped");
});

test("DurableEventStore: countByState — self-contained", async () => {
  const { durableEventStore } = await import("../src/durable-event-store.js");

  const tsF = "test-count-failed-" + Date.now();
  const tsR = "test-count-replied-" + Date.now();

  // Create one failed, one replied
  durableEventStore.markPending({ ts: tsF, channel: "C99", type: "message", text: "fail" });
  durableEventStore.markProcessing(tsF);
  durableEventStore.markFailed(tsF, "test error");

  durableEventStore.markPending({ ts: tsR, channel: "C99", type: "message", text: "ok" });
  durableEventStore.markProcessing(tsR);
  durableEventStore.markReplied(tsR);

  const counts = durableEventStore.countByState();
  assert.ok(counts.replied >= 1, `should have replied, got: ${JSON.stringify(counts)}`);
  assert.ok(counts.failed >= 1, `should have failed, got: ${JSON.stringify(counts)}`);
});
