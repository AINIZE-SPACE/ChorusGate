#!/usr/bin/env node
// ============================================================
// smoke.mjs — ChorusGate CLI smoke check (L3 harness)
//
// Usage: node tests/scripts/smoke.mjs
//
// Sanity-checks the `chorusgate` CLI end-to-end against an
// isolated temp CHORUSGATE_HOME so it never touches real config:
//
//   1. help          — CLI loads, lists `log` command
//   2. status        — clean "stopped" output (exit 3)
//   3. log           — default tail (last 50) + format check
//   4. log --lines N — exact tail count
//   5. log (missing) — missing-agent error path (exit 1)
//   6. daemon boot   — `chorusgate run` writes `[ts ...]` lines
//
// Windows: the CLI hard-requires an elevated process. When the
// harness itself is NOT elevated it asserts the admin-guard fires
// with a clear message instead of running functional checks.
//
// Exit 0 = all checks pass, 1 = failure (gate for liveness SIT).
// ============================================================

import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(ROOT, "bin", "chorusgate.mjs");
const NODE = process.execPath;

const isWin = process.platform === "win32";
const results = [];
const SIT_HOME = mkdtempSync(join(tmpdir(), "cg-smoke-"));

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Windows elevation probe (mirrors src/require-admin.ts). */
function isElevated() {
  if (!isWin) return true;
  const out = spawnSync(
    "powershell.exe",
    [
      "-NoProfile", "-NonInteractive", "-Command",
      "([Security.Principal.WindowsPrincipal]" +
      "[Security.Principal.WindowsIdentity]::GetCurrent())." +
      "IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  return /^\s*true\s*$/i.test((out.stdout || "").trim());
}

/** Run `chorusgate <args>` with an isolated home; return {code, stdout, stderr}. */
function cg(...args) {
  const r = spawnSync(NODE, [BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CHORUSGATE_HOME: SIT_HOME },
    windowsHide: true,
  });
  return {
    code: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

/** Seed a realistic timestamped gateway.log for tail tests. */
function seedLog(agentId, count = 60) {
  const dir = join(SIT_HOME, agentId);
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const ts = `2026-08-19 08:${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}`;
    lines.push(`[ts ${ts}] [INFO] [daemon] [smoke] seed line ${i}`);
  }
  writeFileSync(join(dir, "gateway.log"), lines.join("\n") + "\n", "utf8");
}

/** Boot the daemon in the foreground, wait for `[ts ...]` log lines, then stop it. */
function daemonBootCheck() {
  return new Promise((resolveResult) => {
    const dir = join(SIT_HOME, "default");
    mkdirSync(dir, { recursive: true });
    // bootstrap() requires a .env for the "default" agent; seed one with dummy
    // tokens (plan §4.3) so the daemon gets past config loading to the logger.
    const envPath = join(dir, ".env");
    if (!existsSync(envPath)) {
      writeFileSync(
        envPath,
        [
          "# smoke harness — dummy tokens, never connects",
          "SLACK_BOT_TOKEN=xoxb-smoke-0000000000000",
          "SLACK_APP_TOKEN=xapp-smoke-0000000000000",
          "GATEWAY_PROVIDER=claude",
          "",
        ].join("\n"),
        "utf8",
      );
    }
    const logFile = join(dir, "gateway.log");
    rmSync(logFile, { force: true });

    const child = spawn(NODE, [BIN, "run"], {
      cwd: ROOT,
      stdio: "ignore",
      env: { ...process.env, CHORUSGATE_HOME: SIT_HOME },
      windowsHide: true,
    });

    const deadline = Date.now() + 12000;
    const poll = setInterval(() => {
      let ok = false;
      let sample = "";
      if (existsSync(logFile)) {
        const content = readFileSync(logFile, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        if (lines.length > 0) {
          sample = lines[0];
          ok = /^\[ts \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|WARN|ERROR|DEBUG)\] \[[a-z-]+\]/.test(sample);
        }
      }
      if (ok || Date.now() > deadline) {
        clearInterval(poll);
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        resolveResult(ok ? sample : "");
      }
    }, 300);
  });
}

async function main() {
  console.log(`ChorusGate CLI smoke — ${isWin ? "Windows" : process.platform}`);
  console.log(`Repo root: ${ROOT}`);
  console.log(`Isolated home: ${SIT_HOME}`);
  const elevated = isElevated();
  console.log(`Elevated (Windows): ${isWin ? (elevated ? "yes" : "NO") : "n/a"}`);
  console.log("");

  // ---- Windows, not elevated: the admin guard is the expected behavior -----
  if (isWin && !elevated) {
    const r = cg("help");
    const guard = /administrator privileges/.test(r.stderr);
    guard
      ? pass("admin guard (non-elevated CLI blocked with clear message)", `exit ${r.code}`)
      : fail("admin guard", `exit ${r.code}, stderr: ${r.stderr.slice(0, 120)}`);
    console.log("\nSkipping functional checks (CLI requires elevation on Windows).");
    return finish();
  }

  // ---- help ----------------------------------------------------------------
  const help = cg("help");
  const helpLog = /^\s*log\s+print the daemon log/m.test(help.stderr);
  help.code === 0
    ? pass("chorusgate help", `exit 0${helpLog ? "" : " (log NOT listed!)"}`)
    : fail("chorusgate help", `exit ${help.code}`);
  if (help.code === 0 && !helpLog) fail("help lists log command");

  // ---- status (no daemon) --------------------------------------------------
  const status = cg("status");
  status.code === 3 && /stopped/.test(status.stderr)
    ? pass("chorusgate status (stopped)", "exit 3")
    : fail("chorusgate status", `exit ${status.code}`);

  // ---- log tail on a seeded file -------------------------------------------
  seedLog("default", 60);
  const tail = cg("log");
  const tailLines = tail.stdout.trim().split("\n").filter(Boolean);
  tail.code === 0 && tailLines.length === 50
    ? pass("chorusgate log (default 50-line tail)", `${tailLines.length} lines`)
    : fail("chorusgate log", `exit ${tail.code}, ${tailLines.length} lines`);

  const lines3 = cg("log", "--lines", "3");
  const lines3Lines = lines3.stdout.trim().split("\n").filter(Boolean);
  lines3.code === 0 && lines3Lines.length === 3
    ? pass("chorusgate log --lines 3", "exactly 3 lines")
    : fail("chorusgate log --lines 3", `exit ${lines3.code}, ${lines3Lines.length} lines`);

  // ---- missing agent error path --------------------------------------------
  const missing = cg("log", "--agent", "nonexistent");
  missing.code === 1 && /start the gateway first/.test(missing.stderr)
    ? pass("chorusgate log --agent <missing>", "exit 1 + guidance")
    : fail("chorusgate log --agent <missing>", `exit ${missing.code}`);

  // ---- daemon boot + log format (the harness for liveness SIT) -------------
  console.log("  … booting daemon (isolated home, dummy tokens)…");
  const bootLine = await daemonBootCheck();
  bootLine
    ? pass("daemon boot writes [ts] log lines", bootLine.slice(0, 80))
    : fail("daemon boot", "no matching [ts ...] log line within 12s");

  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`Smoke: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    failed.forEach((f) => console.log(`  FAILED: ${f.name} — ${f.detail}`));
  }
  // Leave the temp home in place on failure for diagnosis.
  if (failed.length === 0) {
    try { rmSync(SIT_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
  } else {
    console.log(`Temp home kept for diagnosis: ${SIT_HOME}`);
  }
  console.log(failed.length === 0 ? "OVERALL: PASS ✅" : "OVERALL: FAIL ❌");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke script error:", err);
  process.exit(1);
});
