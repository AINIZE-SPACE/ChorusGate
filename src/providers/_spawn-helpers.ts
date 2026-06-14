// ============================================================
// Shared spawn utilities — extracted from claude.ts / claude-stream.ts
//
// P2-2: 消除两个 provider 的 spawn 模板重复。
// ============================================================

import { spawn, type SpawnOptions, type ChildProcess } from "node:child_process";

// ---- Windows-safe command construction ---------------------------------------

/** Build a Windows-safe command string and args for spawning. */
export function buildSpawnCommand(
  bin: string,
  args: string[],
): { cmd: string; spawnArgs: string[] } {
  const win = process.platform === "win32";
  if (!win) return { cmd: bin, spawnArgs: args };

  // P3-4: escape backslashes inside double-quoted args to prevent
  // cmd.exe from interpreting them as escape sequences.
  const escapeArg = (a: string): string => {
    if (a.includes(" ")) {
      return `"${a.replace(/\\/g, "\\\\")}"`;
    }
    return a.replace(/\\/g, "\\\\");
  };

  const cmd = `"${bin}" ${args.map(escapeArg).join(" ")}`;
  return { cmd, spawnArgs: [] };
}

/** Build base SpawnOptions shared by all providers. */
export function buildSpawnOptions(
  cwd: string,
  env?: Record<string, string | undefined>,
): SpawnOptions {
  const win = process.platform === "win32";
  const opts: SpawnOptions = {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    shell: win,
    windowsHide: true,
  };
  if (env) opts.env = env;
  return opts;
}

// ---- Env helper (per-profile token injection, STORY-7) -----------------------

/** Build spawn environment with per-profile Slack tokens injected. */
export function buildSpawnEnv(opts: {
  botToken?: string;
  appToken?: string;
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (opts.botToken) env.SLACK_BOT_TOKEN = opts.botToken;
  if (opts.appToken) env.SLACK_APP_TOKEN = opts.appToken;
  return env;
}

// ---- stdout line buffer ------------------------------------------------------

/**
 * Create a stdout line buffer that calls onLine for each complete line.
 * Returns a function that accepts Buffer chunks.
 */
export function createLineBuffer(
  onLine: (line: string) => void,
): (chunk: Buffer | string) => void {
  let buf = "";
  return (chunk: Buffer | string) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  };
}

/** Feed remaining partial data through the line buffer (call after process exits). */
export function flushBuffer(
  feedLine: (chunk: Buffer | string) => void,
): void {
  // Force-flush: append "\n" so any partial line in the buffer is emitted.
  try { feedLine("\n"); } catch { /* ignore */ }
}

// ---- shared spawn + result promise -------------------------------------------

export interface SpawnResult {
  child: ChildProcess;
  stderr: string;
  settled: boolean;
}

/**
 * Spawn a process and return a result object + a Promise that resolves on exit.
 * Centralizes the timeout, error, and close handling.
 */
export function spawnAndWait(
  cmd: string,
  spawnArgs: string[],
  opts: SpawnOptions,
  timeoutMs: number,
  onResult: (ok: boolean, code: number | null, stderr: string) => void,
  onSpawn?: (child: ChildProcess) => void,
): SpawnResult {
  const child = spawn(cmd, spawnArgs, opts);
  try { onSpawn?.(child); } catch { /* best effort */ }

  let stderr = "";
  const result: SpawnResult = { child, stderr: "", settled: false };

  const timer = setTimeout(() => {
    if (result.settled) return;
    result.settled = true;
    child.kill("SIGKILL");
    onResult(false, null, result.stderr);
  }, timeoutMs);

  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    result.stderr = stderr;
  });

  child.on("error", (err) => {
    if (result.settled) return;
    result.settled = true;
    clearTimeout(timer);
    onResult(false, null, `failed to spawn: ${err.message}`);
  });

  child.on("close", (code) => {
    if (result.settled) return;
    result.settled = true;
    clearTimeout(timer);
    onResult(code === 0, code, result.stderr);
  });

  return result;
}
