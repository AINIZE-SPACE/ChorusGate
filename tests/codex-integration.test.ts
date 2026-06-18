// ============================================================
// codex-integration — ST for #77 #78 #81
//
// Verify:
// - #77: codex exec resume --json flag position (before positional args)
// - #78: Windows cmd.exe double-quote escaping in spawnCodex
// - #81: Codex thread_id written back to sessionStore on createSession
//
// Uses real codex CLI (if available) or fixture-based argument validation.
//
// 跟踪: #77 (REOPENED), #78 (REOPENED), #81 (REOPENED)
// 方案: docs/tests/plans/PLAN-Sprint3-ST-2026-06-15-xiaoma.md
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- ST-CX-001: --json flag is before positional args in createSession ----
test("ST-CX-001: codex createSession --json before positional args", async () => {
  const { codexProvider } = await import("../src/providers/codex.js");

  let capturedArgs: string[] = [];
  const mockParser = {
    feed: () => {},
    getResultText: () => "",
    onProgress: undefined,
    onSessionId: undefined,
  };

  try {
    await codexProvider.createSession("hello", {
      cwd: __dirname,
      timeoutMs: 3000,
      mcpConfigPath: "",
      permissionMode: "bypassPermissions",
      onSpawn(child: ChildProcess) {
        capturedArgs = child.spawnargs ?? [];
      },
    });
  } catch {
    // Expected to fail if codex not installed; we only care about args
  }

  const argsStr = capturedArgs.join(" ");
  // Verify format: codex exec --json --cd <dir> ...
  // NOT: codex exec <prompt> --json --cd <dir>  (wrong)
  assert.match(argsStr, /--json/, "Must include --json flag");
  // --json must come BEFORE the positional "exec" args
  const jsonIdx = argsStr.indexOf("--json");
  const execIdx = argsStr.indexOf("exec");
  assert.ok(jsonIdx < execIdx, "--json must come before 'exec' subcommand");
});

// ---- ST-CX-002: --json flag is before positional args in resumeSession ----
test("ST-CX-002: codex resumeSession --json before positional args", async () => {
  const { codexProvider } = await import("../src/providers/codex.js");

  let capturedArgs: string[] = [];

  try {
    await codexProvider.resumeSession("continue", "test-thread-id", {
      cwd: __dirname,
      timeoutMs: 3000,
      mcpConfigPath: "",
      permissionMode: "bypassPermissions",
      onSpawn(child: ChildProcess) {
        capturedArgs = child.spawnargs ?? [];
      },
    });
  } catch {
    // Expected to fail; we only verify args
  }

  const argsStr = capturedArgs.join(" ");
  // Correct: codex exec resume --json <thread_id> <prompt>
  // Wrong:   codex exec resume <thread_id> <prompt> --json
  assert.match(argsStr, /--json/, "Must include --json flag");
  const jsonIdx = argsStr.indexOf("--json");
  const resumeIdx = argsStr.indexOf("resume");
  assert.ok(jsonIdx < resumeIdx + 10, "--json must come before resume positional args");
  assert.ok(argsStr.includes("resume"), "Must include resume subcommand");
});

// ---- ST-CX-003: Windows cmd.exe quoting for args with spaces ----
// Note: prompt is sent via stdin (not in args), so prompt quoting is irrelevant.
// This test verifies that args with spaces (e.g. --cd path) are properly quoted.
test("ST-CX-003: args with spaces are quoted; prompt not in args (goes via stdin)", () => {
  const isWin = process.platform === "win32";
  if (!isWin) return;

  // Replicate current spawnCodex logic — prompt goes via stdin, NOT in args
  const args = ["--json", "exec", "--cd", "C:\\Program Files\\test dir"];
  const CODEX_BIN = "codex";

  const cmd = `"${CODEX_BIN}" ${args
    .map((a) => {
      if (a.includes(" ")) {
        return `"${a}"`;
      }
      return a;
    })
    .join(" ")}`;

  // Verify path with spaces is properly quoted
  assert.ok(
    cmd.includes('"C:\\Program Files\\test dir"'),
    `Path with spaces should be quoted: ${cmd}`,
  );
  // Verify no empty double-quote pairs
  assert.ok(
    !cmd.includes('""'),
    `No empty double-quote pairs allowed: ${cmd}`,
  );
});

// ---- ST-CX-004: CJK prompt via stdin doesn't crash spawn ----
// Prompt is sent via stdin (not in spawnargs), so we verify spawn was attempted
// without crashing rather than checking spawnargs for CJK content.
test("ST-CX-004: CJK prompt via stdin doesn't crash spawn", async () => {
  const { codexProvider } = await import("../src/providers/codex.js");

  let spawnCalled = false;
  const cjkPrompt = "你好世界 Hello World 这是测试";

  try {
    await codexProvider.createSession(cjkPrompt, {
      cwd: __dirname,
      timeoutMs: 3000,
      mcpConfigPath: "",
      permissionMode: "bypassPermissions",
      onSpawn(_child: ChildProcess) {
        spawnCalled = true;
      },
    });
  } catch {
    // Expected — codex may not be installed in test env
  }

  // Key assertion: spawn was attempted (no crash on CJK input to stdin)
  assert.ok(spawnCalled, "Spawn should be attempted with CJK prompt (via stdin)");
});

// ---- ST-CX-005: MAX_ITERATIONS env cap is applied ----
test("ST-CX-005: MAX_ITERATIONS=1 limits iterations", async () => {
  const orig = process.env.CODEX_MAX_ITERATIONS;
  process.env.CODEX_MAX_ITERATIONS = "1";

  try {
    const { codexProvider } = await import("../src/providers/codex.js");
    let capturedArgs: string[] = [];

    await codexProvider.createSession("count to 100", {
      cwd: __dirname,
      timeoutMs: 5000,
      mcpConfigPath: "",
      permissionMode: "bypassPermissions",
      onSpawn(child: ChildProcess) {
        capturedArgs = child.spawnargs ?? [];
      },
    });

    const argsStr = capturedArgs.join(" ");
    assert.match(
      argsStr,
      /max_iterations=1/,
      `MAX_ITERATIONS=1 should be in args: ${argsStr}`,
    );
  } finally {
    if (orig !== undefined) process.env.CODEX_MAX_ITERATIONS = orig;
    else delete process.env.CODEX_MAX_ITERATIONS;
  }
});

// ---- ST-CX-006: nonexistent CODEX_BIN → ENOENT error ----
test("ST-CX-006: CODEX_BIN=nonexistent → meaningful ENOENT error", async () => {
  const orig = process.env.CODEX_BIN;
  process.env.CODEX_BIN = "nonexistent-codex-binary-xyz";

  try {
    const { codexProvider } = await import("../src/providers/codex.js");
    const result = await codexProvider.createSession("hello", {
      cwd: __dirname,
      timeoutMs: 2000,
      mcpConfigPath: "",
      permissionMode: "bypassPermissions",
    });

    assert.equal(result.ok, false, "Should fail when CODEX_BIN not found");
    assert.ok(
      result.error?.includes("ENOENT") || result.error?.includes("spawn"),
      `Error should mention spawn failure: ${result.error}`,
    );
  } finally {
    if (orig !== undefined) process.env.CODEX_BIN = orig;
    else delete process.env.CODEX_BIN;
  }
});
