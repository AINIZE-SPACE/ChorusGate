// ============================================================
// Gateway control plane — start / stop / restart / status / list
//
// Manages the gateway daemon as a background process via a PID file and a
// status.json snapshot the daemon writes. No external deps; cross-platform
// (uses process.kill(pid, 0) for liveness, SIGTERM for graceful stop).
// ============================================================

import { spawn } from "node:child_process";
import { openSync, readFileSync, rmSync } from "node:fs";
import {
  ensureGatewayDir,
  PID_FILE,
  LOG_FILE,
  STATUS_FILE,
  BIN_FILE,
  type GatewayStatus,
} from "./gateway-paths.js";

// ---- helpers ---------------------------------------------------------------

function readPid(): number | null {
  try {
    const raw = readFileSync(PID_FILE, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** True if a process with this PID is alive (signal 0 = existence probe). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readStatus(): GatewayStatus | null {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, "utf8")) as GatewayStatus;
  } catch {
    return null;
  }
}

/** Returns the live daemon PID, or null. Cleans up a stale PID file. */
function livePid(): number | null {
  const pid = readPid();
  if (pid === null) return null;
  if (isAlive(pid)) return pid;
  // Stale PID file — process is gone.
  try {
    rmSync(PID_FILE, { force: true });
    rmSync(STATUS_FILE, { force: true });
  } catch {
    // ignore
  }
  return null;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${m}m${sec}s`;
  if (m > 0) return `${m}m${sec}s`;
  return `${sec}s`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ---- commands --------------------------------------------------------------

/** Start the daemon in the background. */
export async function start(): Promise<void> {
  const existing = livePid();
  if (existing !== null) {
    console.error(
      `gateway already running (pid ${existing}). Use 'restart' to restart.`
    );
    process.exitCode = 0;
    return;
  }

  ensureGatewayDir();
  const out = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [BIN_FILE, "run"], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();

  // Poll for the daemon to come up (writes PID + status).
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(300);
    const pid = livePid();
    if (pid !== null && readStatus()) {
      console.error(`gateway started (pid ${pid}). Logs: ${LOG_FILE}`);
      return;
    }
  }

  // Didn't come up — surface the tail of the log to explain why.
  let tail = "";
  try {
    tail = readFileSync(LOG_FILE, "utf8").split("\n").slice(-15).join("\n");
  } catch {
    // ignore
  }
  console.error(
    "gateway failed to start within 8s. Recent log:\n" + tail
  );
  process.exitCode = 1;
}

/** Stop the running daemon gracefully. */
export async function stop(): Promise<void> {
  const pid = livePid();
  if (pid === null) {
    console.error("gateway is not running.");
    process.exitCode = 0;
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    console.error(`failed to signal pid ${pid}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // Wait for it to exit.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(300);
    if (!isAlive(pid)) {
      try {
        rmSync(PID_FILE, { force: true });
        rmSync(STATUS_FILE, { force: true });
      } catch {
        // ignore
      }
      console.error(`gateway stopped (pid ${pid}).`);
      return;
    }
  }
  console.error(
    `gateway (pid ${pid}) did not exit within 10s; it may still be shutting down.`
  );
  process.exitCode = 1;
}

/** Restart: stop if running, then start. */
export async function restart(): Promise<void> {
  if (livePid() !== null) {
    await stop();
    await sleep(500);
  }
  await start();
}

/** Print whether the daemon is running and its runtime info. */
export async function status(): Promise<void> {
  const pid = livePid();
  if (pid === null) {
    console.error("● gateway: stopped");
    process.exitCode = 3;
    return;
  }
  const st = readStatus();
  console.error(`● gateway: running (pid ${pid})`);
  if (st) {
    const uptime = fmtDuration(Date.now() - st.startedAt);
    const staleMs = Date.now() - st.updatedAt;
    console.error(`  uptime:       ${uptime}`);
    console.error(`  slots:        ${st.activeSlots}/${st.maxConcurrent} active`);
    console.error(`  sessions:     ${st.sessions.length} thread(s)`);
    if (staleMs > 20000) {
      console.error(
        `  (status snapshot is ${fmtDuration(staleMs)} old — daemon may be busy)`
      );
    }
  }
  process.exitCode = 0;
}

/** List active thread→session mappings. */
export async function list(): Promise<void> {
  const pid = livePid();
  if (pid === null) {
    console.error("gateway is not running.");
    process.exitCode = 3;
    return;
  }
  const st = readStatus();
  if (!st || st.sessions.length === 0) {
    console.error("no active thread sessions.");
    process.exitCode = 0;
    return;
  }
  console.error(`${st.sessions.length} active thread session(s):`);
  console.error("");
  console.error("  THREAD KEY                       SESSION    STARTED  IDLE");
  console.error("  -------------------------------- ---------- -------  --------");
  for (const s of st.sessions) {
    const key = s.key.padEnd(32).slice(0, 32);
    const sid = s.sessionId.slice(0, 8);
    const started = s.started ? "yes    " : "no     ";
    const idle = fmtDuration(Date.now() - s.lastUsed);
    console.error(`  ${key} ${sid}   ${started}  ${idle}`);
  }
  process.exitCode = 0;
}

/** Print usage for unknown commands. */
export function help(): void {
  console.error(
    [
      "Usage: slack-gateway <command>",
      "",
      "  run       run the gateway in the foreground (blocks)",
      "  start     start the gateway as a background daemon",
      "  stop      stop the running daemon",
      "  restart   restart the daemon",
      "  status    show whether the daemon is running + runtime info",
      "  list      list active thread→session mappings",
    ].join("\n")
  );
}
