// ============================================================
// Gateway control plane — start / stop / restart / status / list
//
// Manages the gateway daemon as a background process via a PID file and a
// status.json snapshot the daemon writes. No external deps; cross-platform
// (uses process.kill(pid, 0) for liveness, SIGTERM for graceful stop).
// ============================================================

import { spawn } from "node:child_process";
import {
  openSync,
  readFileSync,
  readSync,
  closeSync,
  rmSync,
  existsSync,
  statSync,
  watch,
} from "node:fs";
import {
  ensureGatewayDir,
  getLogFile,
  getPidFile,
  getStatusFile,
  BIN_FILE,
  type GatewayStatus,
} from "./gateway-paths.js";
import { parseCliArgs } from "./cli-args.js";
import { prepareRunConfig } from "./config-init.js";

// ---- helpers ---------------------------------------------------------------

/**
 * Resolve the target agent for a control command.
 * Omitting --agent is equivalent to --agent default (cross-project home).
 */
function resolveAgentId(): string {
  return parseCliArgs().agentId ?? "default";
}

function readPid(agentId: string): number | null {
  try {
    const raw = readFileSync(getPidFile(agentId), "utf8").trim();
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

function readStatus(agentId: string): GatewayStatus | null {
  try {
    return JSON.parse(readFileSync(getStatusFile(agentId), "utf8")) as GatewayStatus;
  } catch {
    return null;
  }
}

/** Returns the live daemon PID for an agent, or null. Cleans up a stale PID file. */
function livePid(agentId: string): number | null {
  const pid = readPid(agentId);
  if (pid === null) return null;
  if (isAlive(pid)) return pid;
  // Stale PID file — process is gone.
  try {
    rmSync(getPidFile(agentId), { force: true });
    rmSync(getStatusFile(agentId), { force: true });
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
export async function start(skipConfigPreflight = false): Promise<void> {
  const agentId = resolveAgentId();
  const existing = livePid(agentId);
  if (existing !== null) {
    console.error(
      `gateway (${agentId}) already running (pid ${existing}). Use 'restart' to restart.`
    );
    process.exitCode = 0;
    return;
  }

  if (!skipConfigPreflight && !(await prepareRunConfig())) {
    process.exitCode = 0;
    return;
  }

  ensureGatewayDir(agentId);
  const logFile = getLogFile(agentId);

  // Forward --agent and --env-file to the daemon process (#134)
  const cliArgs = parseCliArgs();
  const forwardArgs: string[] = [];
  if (cliArgs.agentId) forwardArgs.push("--agent", cliArgs.agentId);
  if (cliArgs.envFile) forwardArgs.push("--env-file", cliArgs.envFile);
  if (cliArgs.initialize) forwardArgs.push("--init");

  // Issue #141: the daemon OWNS its log file via an internal rotating logger.
  // We no longer pass a stdio fd — an externally-held fd would keep writing
  // into a renamed file after rotation (the fd-rename trap on Windows).
  // Early daemon output is still recoverable: the daemon inits its logger at
  // module scope and `start()` surfaces the log tail on startup failure.
  const child = spawn(process.execPath, [BIN_FILE, "run", ...forwardArgs], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  child.unref();

  // Poll for the daemon to come up (writes PID + status).
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(300);
    const pid = livePid(agentId);
    if (pid !== null && readStatus(agentId)) {
      console.error(`gateway (${agentId}) started (pid ${pid}). Logs: ${logFile}`);
      return;
    }
  }

  // Didn't come up — surface the tail of the log to explain why.
  let tail = "";
  try {
    tail = readFileSync(logFile, "utf8").split("\n").slice(-15).join("\n");
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
  const agentId = resolveAgentId();
  const pid = livePid(agentId);
  if (pid === null) {
    console.error(`gateway (${agentId}) is not running.`);
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
        rmSync(getPidFile(agentId), { force: true });
        rmSync(getStatusFile(agentId), { force: true });
      } catch {
        // ignore
      }
      console.error(`gateway (${agentId}) stopped (pid ${pid}).`);
      return;
    }
  }
  console.error(
    `gateway (${agentId}, pid ${pid}) did not exit within 10s; it may still be shutting down.`
  );
  process.exitCode = 1;
}

/** Restart: stop if running, then start. */
export async function restart(): Promise<void> {
  const agentId = resolveAgentId();
  if (!(await prepareRunConfig())) {
    process.exitCode = 0;
    return;
  }
  if (livePid(agentId) !== null) {
    await stop();
    await sleep(500);
  }
  await start(true);
}

/** Print whether the daemon is running and its runtime info. */
export async function status(): Promise<void> {
  const agentId = resolveAgentId();
  const pid = livePid(agentId);
  if (pid === null) {
    console.error(`● gateway (${agentId}): stopped`);
    process.exitCode = 3;
    return;
  }
  const st = readStatus(agentId);
  console.error(`● gateway (${agentId}): running (pid ${pid})`);
  if (st) {
    const uptime = fmtDuration(Date.now() - st.startedAt);
    const staleMs = Date.now() - st.updatedAt;
    const staleThreshold = Number(
      process.env.GATEWAY_HEARTBEAT_STALE_MS || 180_000,
    );
    console.error(`  uptime:       ${uptime}`);
    console.error(`  heartbeat:    ${fmtDuration(staleMs)} ago`);
    console.error(`  slots:        ${st.activeSlots}/${st.maxConcurrent} active`);
    console.error(`  sessions:     ${st.sessions.length} thread(s)`);
    if (staleMs > staleThreshold) {
      console.error(
        `  ⚠️ heartbeat stale (${fmtDuration(staleMs)} old) — ` +
          `daemon may be hung; watchdog will restart it`,
      );
    } else if (staleMs > 20000) {
      console.error(
        `  (status snapshot is ${fmtDuration(staleMs)} old — daemon may be busy)`
      );
    }
  }
  process.exitCode = 0;
}

/** List active thread→session mappings. */
export async function list(): Promise<void> {
  const agentId = resolveAgentId();
  const pid = livePid(agentId);
  if (pid === null) {
    console.error(`gateway (${agentId}) is not running.`);
    process.exitCode = 3;
    return;
  }
  const st = readStatus(agentId);
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

/**
 * Print (and optionally follow) the daemon log for an agent.
 *
 * Issue #141: `chorusgate log [--agent <id>] [--lines N] [--follow]`.
 * Omitting --agent resolves to "default" (same semantics as #134).
 */
export async function log(): Promise<void> {
  const cliArgs = parseCliArgs();
  const agentId = cliArgs.agentId ?? "default";
  const lines =
    cliArgs.lines !== undefined && Number.isFinite(cliArgs.lines) && cliArgs.lines > 0
      ? Math.floor(cliArgs.lines)
      : 50;
  const follow = cliArgs.follow || false;
  const logFile = getLogFile(agentId);

  if (!existsSync(logFile)) {
    console.error(
      `no log file for agent '${agentId}' at ${logFile} — start the gateway first (chorusgate start --agent ${agentId})`
    );
    process.exitCode = 1;
    return;
  }

  // tail -n lines (cross-platform: read whole file, take last N lines).
  const content = readFileSync(logFile, "utf8");
  const linesArr = content.split("\n");
  // A trailing newline leaves an empty last element — drop it so the count is
  // exact (slice(-N) otherwise consumes one real line).
  if (linesArr.length > 0 && linesArr[linesArr.length - 1] === "") {
    linesArr.pop();
  }
  console.log(linesArr.slice(-lines).join("\n"));

  if (follow) {
    await followLog(logFile);
  }
}

/**
 * Follow a log file, printing appended bytes until interrupted.
 *
 * fs.watch is only a wake-up trigger; actual reads use a size-offset poll so
 * behavior stays correct on Windows (unstable watch events) and across log
 * rotation (a recreated/shrunken file re-anchors the offset from 0).
 */
async function followLog(logFile: string): Promise<void> {
  let size = statSync(logFile).size;

  const drain = (): void => {
    try {
      const st = statSync(logFile);
      if (st.size < size) {
        // Rotated/recreated (size shrank): re-anchor so the fresh file's
        // bytes stream from the start.
        size = 0;
      }
      if (st.size <= size) return;
      const fd = openSync(logFile, "r");
      try {
        const buf = Buffer.alloc(st.size - size);
        const n = readSync(fd, buf, 0, buf.length, size);
        if (n > 0) process.stdout.write(buf.subarray(0, n));
        size += n;
      } finally {
        closeSync(fd);
      }
    } catch {
      // Transient (file locked / mid-rename) — retry on next poll.
    }
  };

  try {
    watch(logFile, drain);
  } catch {
    // watch unsupported/locked — polling below still works.
  }
  // Poll as a fallback for platforms where watch is unreliable.
  const poll = setInterval(drain, 200);
  poll.unref?.();
  // Keep the process alive while following (watcher/poll handles are active).
  process.stdout.on("error", () => process.exit(0));
}

/** Print usage for unknown commands. */
export function help(): void {
  console.error(
    [
      "Usage: chorusgate <command> [options]",
      "",
      "Commands:",
      "  run             run the gateway in the foreground (blocks)",
      "  start           start the gateway as a background daemon",
      "  stop            stop the running daemon",
      "  restart         restart the daemon",
      "  status          show whether the daemon is running + runtime info",
      "  list            list active thread→session mappings",
      "  log             print the daemon log (default: last 50 lines)",
      "                  --lines N / -n N   print last N lines",
      "                  --follow / -f      follow new lines (tail -f)",
      "  config migrate  migrate project .env → ~/.chorusgate/<id>/.env",
      "  config init     initialize a missing agent profile",
      "",
      "Options:",
      "  --agent <id>     load config from ~/.chorusgate/<id>/.env (default: default)",
      "  --env-file <path> load explicit .env file (mutually exclusive with --agent)",
      "  --init           initialize a missing --agent profile automatically",
    ].join("\n")
  );
}
