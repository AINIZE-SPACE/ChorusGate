import test from "node:test";
import assert from "node:assert/strict";

import { EventStore } from "../src/event-store.ts";

const makeEvent = (ts: string) => ({
  type: "message" as const,
  channel: "C123",
  user: "U123",
  text: `message ${ts}`,
  ts,
});

test("EventStore keeps newest events when capacity is exceeded", () => {
  const store = new EventStore(2);

  const first = store.push(makeEvent("1"));
  const second = store.push(makeEvent("2"));
  const third = store.push(makeEvent("3"));

  assert.equal(store.countTotal(), 2);
  assert.equal(store.getById(first.id), undefined);
  assert.equal(store.getById(second.id)?.ts, "2");
  assert.equal(store.getById(third.id)?.ts, "3");
});

test("EventStore filters pending events and marks handled", () => {
  const store = new EventStore();

  const channelMessage = store.push(makeEvent("1"));
  store.push({ ...makeEvent("2"), channel: "C999" });

  assert.equal(store.countPending(), 2);
  assert.equal(store.markHandled(channelMessage.id), true);
  assert.equal(store.markHandled("missing"), false);

  const pendingForChannel = store.getPending(10, "message", "C123");
  assert.deepEqual(pendingForChannel, []);
  assert.equal(store.countPending(), 1);
});
