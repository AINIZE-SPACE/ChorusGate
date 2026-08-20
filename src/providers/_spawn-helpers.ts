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

  // P3-4: escape cmd.exe metacharacters. In double-quoted strings,
  // backslashes must be escaped. Outside quotes, & | > < ^ % must be escaped.
  const CMD_META = /[&|><^%]/g;
  const escapeArg = (a: string): string => {
    if (a.includes(" ")) {
      // Inside double quotes: escape backslashes and double-quote characters
      return `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    // Outside quotes: escape cmd.exe metacharacters
    const escaped = a.replace(/\\/g, "\\\\").replace(CMD_META, "^$&");
    return escaped;
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

/**
 * #147 代理隔离：Slack 直连、spawn 的 agent CLI 按 CHORUSGATE_AGENT_PROXY
 * 模式构造子进程 env。
 *
 * 不修改 process.env（spec §1 约束 + 小马 SIT D1-5）：Slack 直连靠 @slack
 * SDK 本身不走代理（web-api v7 proxy:false / socket-mode 无 proxy agent /
 * ws 不读 HTTP_PROXY）；子进程 env 由 transport.buildAgentSpawnEnv 按模式
 * 显式构造：inherit（默认，继承宿主代理）/ direct（剥离）/ proxy（注入
 * CHORUSGATE_PROXY_URL）。旧配置 GATEWAY_AGENT_PROXY=<URL> 视为 proxy 模式。
 */
import {
  agentTransportConfig,
  buildAgentSpawnEnv,
} from "../transport.js";

/** Build spawn environment with per-profile Slack tokens injected. */
export function buildSpawnEnv(opts: {
  botToken?: string;
  appToken?: string;
}): Record<string, string | undefined> {
  const env = buildAgentSpawnEnv(agentTransportConfig(), process.env);
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
