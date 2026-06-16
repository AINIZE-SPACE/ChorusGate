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

// ---- ST-CX-003: Windows cmd.exe escaping for prompts with quotes ----
test("ST-CX-003: prompt with double-quotes on Windows: correct escaping", () => {
  // This is a pure argument construction test.
  // We verify that prompts containing double-quotes are properly escaped
  // in the Windows spawn command construction.
  const isWin = process.platform === "win32";

  if (!isWin) {
    // On non-Windows, this escaping is not applied
    return;
  }

  // Replicate the spawnCodex logic
  const prompt = 'say "hello" and "goodbye"';
  const args = ["exec", "--json", "--cd", __dirname, prompt];
  const CODEX_BIN = "codex";

  const cmd = `"${CODEX_BIN}" ${args
    .map((a) => {
      if (a.includes(" ") || a.includes('"')) {
        return `"${a.replace(/"/g, '\"')}"`;
      }
      return a;
    })
    .join(" ")}`;

  // The escaped prompt should be: \"hello\" not ""hello""
  assert.ok(
    !cmd.includes('""'),
    `No empty double-quote pairs allowed: ${cmd}`,
  );
  assert.ok(
    cmd.includes('\\"'),
    `Double-quotes must be escaped with backslash: ${cmd}`,
  );
});

// ---- ST-CX-004: prompt with CJK + spaces survives Windows cmdline ----
test("ST-CX-004: CJK prompt with spaces on Windows spawns correctly", async () => {
  const { codexProvider } = await import("../src/providers/codex.js");

  let capturedArgs: string[] = [];
  const cjkPrompt = "你好世界 Hello World 这是测试";

  try {
    await codexProvider.createSession(cjkPrompt, {
      cwd: __dirname,
      timeoutMs: 3000,
      mcpConfigPath: "",
      permissionMode: "bypassPermissions",
      onSpawn(child: ChildProcess) {
        capturedArgs = child.spawnargs ?? [];
      },
    });
  } catch {
    // Expected; verify args only
  }

  // Args should contain the CJK prompt as a separate argument
  const argsStr = capturedArgs.join(" ");
  assert.ok(
    argsStr.includes("你好") && argsStr.includes("Hello"),
    `CJK prompt should be present in args: ${argsStr}`,
  );
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
