// ============================================================
// ClaudeStreamProvider — 双向 stream-json 协议
//
// 使用 `claude -p --input-format stream-json --output-format stream-json`
// stdin 发送 JSON 消息（保持打开），stdout 解析 JSON 事件。
//
// 与单向 ClaudeProvider 的关键差异：
//   - stdin 不关闭（可回写 approve/deny）
//   - 解析 system.init 获取 session_id
//   - system.permission_request → 审批回调 → stdin 回写
//   - --replay-user-messages 回显用户消息（isReplay:true 忽略）
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/34)
// ============================================================

import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeStreamParser } from "./claude-stream-parser.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// ---- MCP config (same as claude.ts) ------------------------------------------

let _senderMcpConfig: string | null = null;
function getSenderMCPConfig(): string {
  if (_senderMcpConfig !== null) return _senderMcpConfig;
  const senderMcpConfig = resolve(
    projectRoot, "config", "sender-mcp.generated.json",
  );
  const senderBin = resolve(projectRoot, "bin", "slack-socket-mcp.mjs");
  try {
    writeFileSync(
      senderMcpConfig,
      JSON.stringify({
        mcpServers: {
          slack: {
            command: "node",
            args: [senderBin],
            env: {
              MCP_SENDER_ONLY: "1",
              SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "",
              SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN || "",
            },
          },
        },
      }, null, 2),
    );
  } catch (err) {
    console.error(
      "[claude-stream] WARNING: could not write sender MCP config:",
      (err as Error).message,
    );
  }
  _senderMcpConfig = senderMcpConfig;
  return senderMcpConfig;
}

// ---- spawn helper ------------------------------------------------------------

interface StreamSpawnResult {
  child: ChildProcess;
  stdoutBuf: string;
  stderr: string;
  settled: boolean;
}

function spawnStream(
  args: string[],
  cwd: string,
  parser: ClaudeStreamParser,
): StreamSpawnResult {
  const win = process.platform === "win32";
  const cmd = win
    ? `"${CLAUDE_BIN}" ${args
        .map((a) => (a.includes(" ") ? `"${a}"` : a))
        .join(" ")}`
    : CLAUDE_BIN;
  const spawnArgs = win ? [] : args;
  const child = spawn(cmd, spawnArgs, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    shell: win,
    windowsHide: true,
  });

  const result: StreamSpawnResult = {
    child,
    stdoutBuf: "",
    stderr: "",
    settled: false,
  };

  child.stdout.on("data", (chunk) => {
    result.stdoutBuf += chunk.toString();
    const lines = result.stdoutBuf.split("\n");
    result.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) parser.feed(line);
  });

  child.stderr.on("data", (chunk) => {
    result.stderr += chunk.toString();
  });

  return result;
}

/** Send a JSON message on stdin and wait for the result. */
function streamToResult(
  spawnResult: StreamSpawnResult,
  timeoutMs: number,
): Promise<SessionOutput> {
  return new Promise((resolve) => {
    const { child, parser } = spawnResult as StreamSpawnResult & {
      parser: ClaudeStreamParser;
    };
    // parser is captured via closure below

    const timer = setTimeout(() => {
      if (spawnResult.settled) return;
      spawnResult.settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false, text: "", sessionId: (parser.init?.sessionId || ""),
        error: `claude stream timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      if (spawnResult.settled) return;
      spawnResult.settled = true;
      clearTimeout(timer);
      resolve({
        ok: false, text: "", sessionId: "",
        error: `failed to spawn ${CLAUDE_BIN}: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (spawnResult.settled) return;
      spawnResult.settled = true;
      clearTimeout(timer);

      // flush trailing buffer
      if (spawnResult.stdoutBuf) parser.feed(spawnResult.stdoutBuf);

      const text = parser.getResultText();
      if (code === 0 && text) {
        resolve({ ok: true, text, sessionId: (parser.init?.sessionId || "") });
      } else if (code === 0 && !text) {
        resolve({
          ok: false, text: "", sessionId: (parser.init?.sessionId || ""),
          error: "claude stream exited 0 but produced no output",
        });
      } else {
        resolve({
          ok: false, text, sessionId: (parser.init?.sessionId || ""),
          error: `claude stream exited ${code}: ${spawnResult.stderr.trim().slice(0, 500)}`,
        });
      }
    });
  });
}

// ---- Provider ----------------------------------------------------------------

export const claudeStreamProvider: AgentProvider = {
  id: "claude-stream",
  bin: CLAUDE_BIN,

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    const sessionId = opts.sessionId || crypto.randomUUID();
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--replay-user-messages",
      "--strict-mcp-config",
      "--mcp-config", getSenderMCPConfig(),
      "--session-id", sessionId,
    ];

    const parser = new ClaudeStreamParser();
    parser.onProgress = opts.onProgress;
    parser.onSessionId = opts.onSessionId;

    const sr = spawnStream(args, opts.cwd, parser);

    // Send user prompt on stdin (keep pipe open for future approve/deny)
    const userMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
    sr.child.stdin?.write(userMsg);
    // NOTE: stdin NOT closed — open for approve/deny responses

    // Wait for result
    const result = await streamToResult(
      { ...sr, parser } as StreamSpawnResult & { parser: ClaudeStreamParser },
      opts.timeoutMs,
    );

    // Close stdin now that we have the result
    if (!sr.settled) sr.child.stdin?.end();

    return { ...result, sessionId: result.sessionId || sessionId };
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--replay-user-messages",
      "--strict-mcp-config",
      "--mcp-config", getSenderMCPConfig(),
      "--resume", sessionId,
    ];

    const parser = new ClaudeStreamParser();
    parser.onProgress = opts.onProgress;

    const sr = spawnStream(args, opts.cwd, parser);

    const userMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
    sr.child.stdin?.write(userMsg);

    const result = await streamToResult(
      { ...sr, parser } as StreamSpawnResult & { parser: ClaudeStreamParser },
      opts.timeoutMs,
    );

    if (!sr.settled) sr.child.stdin?.end();

    return { ...result, sessionId };
  },
};
