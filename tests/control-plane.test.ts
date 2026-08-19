// ============================================================
// Control-plane per-agent isolation — regression for the Zederer
// report: `status --agent codex` and `status --agent claude`
// printed identical output because pid/status lived in a shared
// cwd/.gateway/. After the fix they resolve under
// ~/.chorusgate/<agent>/ and each agent (default included) has
// an independent view.
//
// These tests drive the real control functions with a seeded
// temp home: one agent's pid/status are seeded with the test
// process's own pid, the others are empty. status() must report
// running for the seeded agent and stopped for every other.
// ============================================================

import { describe, it, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Redirect HOME/USERPROFILE before the FIRST import so CHORUSGATE_HOME in
// load-env/gateway-paths is captured under the temp dir. tsx strips import
// query strings, so a per-test re-import (import('...?t=N')) returns the SAME
// cached module bound to the FIRST temp home — we therefore import exactly
// once and share one temp home for the whole file (same technique as
// gateway-paths.test.ts).
const tempHome = mkdtempSync(join(tmpdir(), "cg-ctl-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const ctl = await import("../src/gateway-control.js");

const SAVED_HOME = process.env.HOME;
const SAVED_USERPROFILE = process.env.USERPROFILE;
const SAVED_ARGV = process.argv;
const SAVED_EXIT_CODE = process.exitCode;

function restoreHomedirEnv(): void {
  if (SAVED_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = SAVED_HOME;
  if (SAVED_USERPROFILE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = SAVED_USERPROFILE;
}

/** Seed a running agent's control-plane files under the temp home. */
function seedAgent(
  agent: string,
  home: string,
  pid: number,
  updatedAt: number = Date.now(),
): void {
  const dir = resolve(home, ".chorusgate", agent);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "gateway.pid"), String(pid), "utf8");
  writeFileSync(
    join(dir, "status.json"),
    JSON.stringify({
      pid,
      startedAt: Date.now(),
      updatedAt,
      activeSlots: 0,
      maxConcurrent: 2,
      sessions: [],
    }),
    "utf8",
  );
}

/** Run a control command with fake argv; returns captured stderr. */
async function runStatus(...argv: string[]): Promise<string> {
  process.argv = [process.execPath, "chorusgate", ...argv];
  const chunks: string[] = [];
  const orig = console.error;
  console.error = (msg?: unknown) => chunks.push(String(msg));
  try {
    await ctl.status();
  } finally {
    console.error = orig;
  }
  return chunks.join("\n");
}

afterEach(() => {
  process.argv = SAVED_ARGV;
  process.exitCode = SAVED_EXIT_CODE;
  // The stale threshold is read from ambient env; pin it per test so the
  // heartbeat assertions are hermetic (see the liveness AC3 tests below).
  delete process.env.GATEWAY_HEARTBEAT_STALE_MS;
  // Fresh control-plane state per test (all under the single shared home).
  const cg = join(tempHome, ".chorusgate");
  if (existsSync(cg)) rmSync(cg, { recursive: true, force: true });
});

after(() => {
  restoreHomedirEnv();
  if (tempHome && existsSync(tempHome)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe("control-plane: per-agent status isolation", () => {
  it("reports running only for the agent whose home is seeded", async () => {
    seedAgent("codex", tempHome, process.pid);

    const running = await runStatus("status", "--agent", "codex");
    assert.match(running, /\(codex\): running/);

    const other = await runStatus("status", "--agent", "claude");
    assert.match(other, /\(claude\): stopped/);
  });

  it("omitting --agent targets 'default', not another running agent", async () => {
    seedAgent("codex", tempHome, process.pid);

    const def = await runStatus("status");
    assert.match(def, /\(default\): stopped/);
  });

  it("uses exit code 3 for stopped and 0 for running", async () => {
    process.exitCode = 0;
    await runStatus("status", "--agent", "missing");
    assert.equal(process.exitCode, 3);

    seedAgent("codex", tempHome, process.pid);
    process.exitCode = 99; // prove status() sets it, not leftover
    await runStatus("status", "--agent", "codex");
    assert.equal(process.exitCode, 0);
  });

  it("seeds/reads control-plane files under the agent home, not cwd", async () => {
    seedAgent("codex", tempHome, process.pid);
    const pidFile = resolve(tempHome, ".chorusgate", "codex", "gateway.pid");
    assert.equal(existsSync(pidFile), true);
    assert.ok(!pidFile.startsWith(process.cwd()));
    assert.ok(!resolve(tempHome, ".chorusgate", "claude", "gateway.pid").startsWith(process.cwd()));
  });

  it("prints heartbeat age in status output (liveness AC3)", async () => {
    process.env.GATEWAY_HEARTBEAT_STALE_MS = "180000"; // pin: no stale at this age
    seedAgent("codex", tempHome, process.pid);
    const out = await runStatus("status", "--agent", "codex");
    assert.match(out, /heartbeat:/);
    assert.match(out, / ago/);
    assert.ok(!out.includes("heartbeat stale"));
  });

  it("warns heartbeat stale beyond GATEWAY_HEARTBEAT_STALE_MS (liveness AC3)", async () => {
    // updatedAt 5 minutes old > pinned 180s threshold.
    process.env.GATEWAY_HEARTBEAT_STALE_MS = "180000";
    seedAgent("codex", tempHome, process.pid, Date.now() - 300_000);
    const out = await runStatus("status", "--agent", "codex");
    assert.match(out, /⚠️ heartbeat stale/);
    assert.match(out, /watchdog will restart/);
  });

  it("honors a custom GATEWAY_HEARTBEAT_STALE_MS override (liveness AC3)", async () => {
    // 60s-old heartbeat is NOT stale under the default 180s, but IS stale
    // under a custom 30s threshold — proves the env override is wired, not
    // just the default. (Without this, the env branch is never exercised.)
    process.env.GATEWAY_HEARTBEAT_STALE_MS = "30000";
    seedAgent("codex", tempHome, process.pid, Date.now() - 60_000);
    const out = await runStatus("status", "--agent", "codex");
    assert.match(out, /⚠️ heartbeat stale/);
    assert.match(out, /watchdog will restart/);
  });

  it("keeps the busy hint for a mid-aged snapshot, no stale warning", async () => {
    // 60s old: past the 20s busy hint, below the pinned 180s stale threshold.
    process.env.GATEWAY_HEARTBEAT_STALE_MS = "180000";
    seedAgent("codex", tempHome, process.pid, Date.now() - 60_000);
    const out = await runStatus("status", "--agent", "codex");
    assert.match(out, /daemon may be busy/);
    assert.ok(!out.includes("heartbeat stale"));
  });
});
