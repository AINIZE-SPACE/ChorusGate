import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "../src/session-store.ts";

const withTempSessionsFile = (): { dir: string; file: string } => {
  const dir = mkdtempSync(join(tmpdir(), "chorusgate-sessions-"));
  return { dir, file: join(dir, "sessions.md") };
};

test("SessionStore persists and reloads markdown mappings", () => {
  const { dir, file } = withTempSessionsFile();
  try {
    const store = new SessionStore({ sessionsFile: file, persistDebounceMs: 1 });
    store.setSession("channel:C123", "11111111-1111-4111-8111-111111111111");
    store.persist();

    const text = readFileSync(file, "utf8");
    assert.match(text, /channel:C123/);

    const reloaded = new SessionStore({ sessionsFile: file, persistDebounceMs: 1 });
    const entries = reloaded.entries();

    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "channel:C123");
    assert.equal(entries[0].sessionId, "11111111-1111-4111-8111-111111111111");
    assert.equal(entries[0].started, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SessionStore evicts idle mappings", () => {
  const { dir, file } = withTempSessionsFile();
  try {
    const store = new SessionStore({ sessionsFile: file, persistDebounceMs: 1 });
    store.setSession("channel:C123", "22222222-2222-4222-8222-222222222222");

    const entry = store.entries()[0];
    entry.lastUsed = Date.now() - 60_000;

    // Mutate through the loaded markdown path so the test exercises public API
    // only after reload with an old timestamp.
    store.persist();
    const oldIso = new Date(Date.now() - 60_000).toISOString();
    const markdown = readFileSync(file, "utf8").replace(
      /\d{4}-\d{2}-\d{2}T[^|]+/,
      oldIso
    );
    writeFileSync(file, markdown);

    const reloaded = new SessionStore({ sessionsFile: file, persistDebounceMs: 1 });
    assert.equal(reloaded.evictIdle(1_000), 1);
    assert.equal(reloaded.size(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
