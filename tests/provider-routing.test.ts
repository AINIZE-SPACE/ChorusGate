// ============================================================
// provider-routing — ST for #76
//
// Verify generateReply() correctly routes to the provider specified
// by opts.providerId. On Windows, spawnfile=cmd.exe (shell:true) so we
// assert on spawnargs which contains the actual binary+flags.
//
// 跟踪: #76 (REOPENED)
// 方案: docs/tests/plans/PLAN-Sprint3-ST-2026-06-15-xiaoma.md
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- ST-PROV-001: claude provider ----
// Windows: spawnfile=cmd.exe (shell), check spawnargs for actual binary
test("ST-PROV-001: generateReply({providerId:claude}) spawns claude", async () => {
  const { generateReply } = await import("../src/reply-engine.js");

  let capturedArgs: string[] = [];

  await generateReply("hello", {
    providerId: "claude",
    cwd: __dirname,
    timeoutMs: 5000,
    onSpawn(child: ChildProcess) {
      capturedArgs = child.spawnargs ?? [];
    },
  });

  // Check actual args: should include "claude" and "-p" prompt
  const argsStr = capturedArgs.join(" ");
  assert.match(argsStr, /claude/i, "spawnargs should contain claude binary");
  assert.ok(argsStr.includes("-p") || capturedArgs.includes("-p"),
    "spawnargs should contain -p flag for claude prompt mode");
});

// ---- ST-PROV-002: claude-stream provider ----
test("ST-PROV-002: generateReply({providerId:claude-stream}) spawns stream-json", async () => {
  const { generateReply } = await import("../src/reply-engine.js");

  let capturedArgs: string[] = [];

  await generateReply("hello", {
    providerId: "claude-stream",
    cwd: __dirname,
    timeoutMs: 5000,
    onSpawn(child: ChildProcess) {
      capturedArgs = child.spawnargs ?? [];
    },
  });

  const argsStr = capturedArgs.join(" ");
  assert.match(argsStr, /--input-format/, "claude-stream should pass --input-format");
  assert.match(argsStr, /--output-format/, "claude-stream should pass --output-format");
  assert.match(argsStr, /stream-json/, "claude-stream should specify stream-json format");
});

// ---- ST-PROV-003: codex provider ----
test("ST-PROV-003: generateReply({providerId:codex}) spawns codex", async () => {
  const { generateReply } = await import("../src/reply-engine.js");

  let capturedArgs: string[] = [];

  await generateReply("hello", {
    providerId: "codex",
    cwd: __dirname,
    timeoutMs: 5000,
    onSpawn(child: ChildProcess) {
      capturedArgs = child.spawnargs ?? [];
    },
  });

  const argsStr = capturedArgs.join(" ");
  assert.match(argsStr, /codex/i, "spawnargs should contain codex binary");
  assert.match(argsStr, /--json/, "codex should be called with --json flag");
});

// ---- ST-PROV-004: default + legacy mode ----
test("ST-PROV-004: no providerId + GATEWAY_CLAUDE_MODE=legacy → claude legacy", async () => {
  const orig = process.env.GATEWAY_CLAUDE_MODE;
  process.env.GATEWAY_CLAUDE_MODE = "legacy";

  try {
    const { generateReply } = await import("../src/reply-engine.js");
    let capturedArgs: string[] = [];

    await generateReply("hello", {
      cwd: __dirname,
      timeoutMs: 5000,
      onSpawn(child: ChildProcess) {
        capturedArgs = child.spawnargs ?? [];
      },
    });

    const argsStr = capturedArgs.join(" ");
    assert.match(argsStr, /claude/i, "legacy mode should spawn claude");
    // Legacy: no --input-format/--output-format
    assert.ok(!argsStr.includes("--input-format"),
      "legacy mode should NOT have stream-json flags");
  } finally {
    if (orig !== undefined) process.env.GATEWAY_CLAUDE_MODE = orig;
    else delete process.env.GATEWAY_CLAUDE_MODE;
  }
});

// ---- ST-PROV-005: default + stream mode ----
test("ST-PROV-005: no providerId + GATEWAY_CLAUDE_MODE=stream → stream-json", async () => {
  const orig = process.env.GATEWAY_CLAUDE_MODE;
  process.env.GATEWAY_CLAUDE_MODE = "stream";

  try {
    const { generateReply } = await import("../src/reply-engine.js");
    let capturedArgs: string[] = [];

    await generateReply("hello", {
      cwd: __dirname,
      timeoutMs: 5000,
      onSpawn(child: ChildProcess) {
        capturedArgs = child.spawnargs ?? [];
      },
    });

    const argsStr = capturedArgs.join(" ");
    assert.match(argsStr, /--input-format/, "stream mode should use --input-format");
  } finally {
    if (orig !== undefined) process.env.GATEWAY_CLAUDE_MODE = orig;
    else delete process.env.GATEWAY_CLAUDE_MODE;
  }
});

// ---- ST-PROV-006: backward compat — no mode env → claude legacy ----
test("ST-PROV-006: no providerId + no GATEWAY_CLAUDE_MODE → claude legacy", async () => {
  const orig = process.env.GATEWAY_CLAUDE_MODE;
  delete process.env.GATEWAY_CLAUDE_MODE;

  try {
    const { generateReply } = await import("../src/reply-engine.js");
    let capturedArgs: string[] = [];

    await generateReply("hello", {
      cwd: __dirname,
      timeoutMs: 5000,
      onSpawn(child: ChildProcess) {
        capturedArgs = child.spawnargs ?? [];
      },
    });

    const argsStr = capturedArgs.join(" ");
    assert.match(argsStr, /claude/i, "default should spawn claude, not codex");
    assert.ok(!argsStr.includes("--input-format"),
      "default (no mode) should NOT use stream-json");
  } finally {
    if (orig !== undefined) process.env.GATEWAY_CLAUDE_MODE = orig;
  }
});
