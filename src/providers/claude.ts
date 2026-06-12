// ============================================================
// ClaudeProvider — spawn `claude -p` via stdin, parse stream-json
//
// 从 reply-engine.ts 原有逻辑迁移，实现 AgentProvider 接口。
//
// 跟踪: [#22](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/22)
// ============================================================

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeEventParser } from "./claude-parser.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");

const PERMISSION_MODE =
  process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";

// ---- MCP config (lazy, per-provider) -----------------------------------------

function ensureSenderMCPConfig(): string {
  const senderMcpConfig = resolve(
    projectRoot,
    "config",
    "sender-mcp.generated.json",
  );
  const senderBin = resolve(projectRoot, "bin", "slack-socket-mcp.mjs");
  try {
    writeFileSync(
      senderMcpConfig,
      JSON.stringify(
        {
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
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(
      "[claude-provider] WARNING: could not write sender MCP config:",
      (err as Error).message,
    );
  }
  return senderMcpConfig;
}

let _senderMcpConfig: string | null = null;
function getSenderMCPConfig(): string {
  if (_senderMcpConfig === null) _senderMcpConfig = ensureSenderMCPConfig();
  return _senderMcpConfig;
}

// ---- Provider 实现 -----------------------------------------------------------

function spawnClaude(
  bin: string,
  args: string[],
  prompt: string,
  cwd: string,
  timeoutMs: number,
  parser: ClaudeEventParser,
): Promise<SessionOutput> {
  return new Promise<SessionOutput>((resolve) => {
    // Windows: shell:true for .cmd shims; concat args ourselves to avoid DEP0190
    const win = process.platform === "win32";
    const cmd = win
      ? `"${bin}" ${args
          .map((a) => (a.includes(" ") ? `"${a}"` : a))
          .join(" ")}`
      : bin;
    const spawnArgs = win ? [] : args;
    const child = spawn(cmd, spawnArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: win,
      windowsHide: true,
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdoutBuf = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        text: "",
        sessionId: "",
        error: `claude -p timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) parser.feed(line);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        text: "",
        sessionId: "",
        error: `failed to spawn ${bin}: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (stdoutBuf) parser.feed(stdoutBuf);

      const text = parser.getResultText();
      if (code === 0 && text) {
        resolve({ ok: true, text, sessionId: "" });
      } else if (code === 0 && !text) {
        resolve({
          ok: false,
          text: "",
          sessionId: "",
          error: "claude -p exited 0 but produced no output",
        });
      } else {
        resolve({
          ok: false,
          text,
          sessionId: "",
          error: `claude -p exited ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });
  });
}

export const claudeProvider: AgentProvider = {
  id: "claude",
  bin: process.env.CLAUDE_BIN || "claude",

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    const sessionId = opts.sessionId || crypto.randomUUID();

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      PERMISSION_MODE,
      "--strict-mcp-config",
      "--mcp-config",
      getSenderMCPConfig(),
      "--session-id",
      sessionId,
    ];

    const parser = new ClaudeEventParser();
    parser.onProgress = opts.onProgress;

    return spawnClaude(
      this.bin,
      args,
      prompt,
      opts.cwd,
      opts.timeoutMs,
      parser,
    ).then((r) => ({ ...r, sessionId }));
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      PERMISSION_MODE,
      "--strict-mcp-config",
      "--mcp-config",
      getSenderMCPConfig(),
      "--resume",
      sessionId,
    ];

    const parser = new ClaudeEventParser();
    parser.onProgress = opts.onProgress;

    return spawnClaude(
      this.bin,
      args,
      prompt,
      opts.cwd,
      opts.timeoutMs,
      parser,
    ).then((r) => ({ ...r, sessionId }));
  },
};
