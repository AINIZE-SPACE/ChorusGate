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
 * #148 代理隔离：daemon 直连 Slack，spawn 的 agent CLI 按需走代理。
 *
 * go.ps1/.env.ps1 会把 http_proxy/https_proxy 写入 User 级环境变量，daemon 与
 * 它 spawn 的子进程共享同一份 process.env —— Slack 连接与 CLI 出站被耦合。
 * 这里把两者解耦：
 *   - daemon 启动时调用 daemonizeProxyEnv()：捕获代理值 → 从 process.env
 *     删除全部代理变量（daemon 自身出站直连；@slack/web-api v7 本来就
 *     proxy:false，此处是显式保证 + 防未来 HTTP 路径误用代理）。
 *   - spawn 子进程时 buildSpawnEnv() 把捕获的代理值显式注入子进程 env
 *     （claude/codex 访问 Anthropic/GitHub 照常走代理）。
 *
 * 优先级：GATEWAY_AGENT_PROXY（显式配置，迁移 go.ps1 用）> 启动时继承的
 * http_proxy/https_proxy/all_proxy 及大写变体。未设置时子进程不带代理。
 * 未调用 daemonizeProxyEnv() 的路径（MCP、测试）行为不变。
 */
const PROXY_VARS = [
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
] as const;

let capturedAgentProxy: string | undefined;
let daemonProxyStripped = false;

/** Capture the agent-CLI proxy and strip all proxy vars from the daemon env. */
export function daemonizeProxyEnv(): string | undefined {
  if (daemonProxyStripped) return capturedAgentProxy;
  daemonProxyStripped = true;
  const explicit = process.env.GATEWAY_AGENT_PROXY;
  for (const k of PROXY_VARS) {
    if (capturedAgentProxy === undefined && process.env[k]) {
      capturedAgentProxy = process.env[k];
    }
    delete process.env[k];
  }
  if (explicit) capturedAgentProxy = explicit;
  return capturedAgentProxy;
}

/** Whether the daemon has stripped proxy vars (used by tests / logging). */
export function isDaemonProxyStripped(): boolean {
  return daemonProxyStripped;
}

/** 仅供测试：重置单例捕获状态（daemon 生产路径只调用一次，无需重置）。 */
export function resetDaemonProxyEnvForTests(): void {
  capturedAgentProxy = undefined;
  daemonProxyStripped = false;
}

/** Build spawn environment with per-profile Slack tokens injected. */
export function buildSpawnEnv(opts: {
  botToken?: string;
  appToken?: string;
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  // #148: inject the captured agent-CLI proxy into child env (not the daemon's).
  if (capturedAgentProxy) {
    for (const k of PROXY_VARS) env[k] = capturedAgentProxy;
  }
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
