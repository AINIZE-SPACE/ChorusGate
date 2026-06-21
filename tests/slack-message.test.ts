import assert from "node:assert/strict";
import test from "node:test";

import {
  postSlackMessageChunks,
  SLACK_MESSAGE_CHUNK_LIMIT,
  splitSlackMessage,
} from "../src/slack-message.js";
import type { WebClient } from "@slack/web-api";

test("short Slack messages remain unchanged", () => {
  assert.deepEqual(splitSlackMessage("iteration complete"), ["iteration complete"]);
});

test("long Slack messages split below the API-safe limit", () => {
  const text = Array.from({ length: 200 }, (_, index) =>
    `Report line ${index}: ${"x".repeat(40)}`
  ).join("\n");

  const chunks = splitSlackMessage(text);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= SLACK_MESSAGE_CHUNK_LIMIT));
  assert.equal(chunks.join("\n"), text);
});

test("a single oversized line is hard-split without data loss", () => {
  const text = "x".repeat(101);
  const chunks = splitSlackMessage(text, 25);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [25, 25, 25, 25, 1]);
  assert.equal(chunks.join(""), text);
});

test("chunk sender keeps every part in the requested thread", async () => {
  const calls: Array<{ channel: string; text: string; thread_ts?: string }> = [];
  const web = {
    chat: {
      postMessage: async (args: { channel: string; text: string; thread_ts?: string }) => {
        calls.push(args);
        return { ok: true, ts: String(calls.length), channel: args.channel };
      },
    },
  } as unknown as WebClient;

  const results = await postSlackMessageChunks(web, {
    channel: "C123",
    thread_ts: "123.456",
    text: "x".repeat(SLACK_MESSAGE_CHUNK_LIMIT + 1),
  });

  assert.equal(results.length, 2);
  assert.deepEqual(calls.map((call) => call.thread_ts), ["123.456", "123.456"]);
  assert.equal(calls.map((call) => call.text).join(""), "x".repeat(SLACK_MESSAGE_CHUNK_LIMIT + 1));
});
