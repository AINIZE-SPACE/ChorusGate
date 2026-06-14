// ============================================================
// ClaudeProvider — spawn `claude -p` via stdin, parse stream-json
//
// 从 reply-engine.ts 原有逻辑迁移，实现 AgentProvider 接口。
//
// MCP: `claude -p` 继承父进程环境，直接加载项目 `.mcp.json`。
//
// 跟踪: [#22](https://github.com/AINIZE-SPACE/chorusgate/issues/22)
// ============================================================

import { ClaudeEventParser } from "./claude-parser.js";
import {
  buildSpawnCommand,
  buildSpawnOptions,
  buildSpawnEnv,
  createLineBuffer,
  flushBuffer,
  spawnAndWait,
} from "./_spawn-helpers.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
} from "./types.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// ---- spawn helper ------------------------------------------------------------

function spawnClaude(
  args: string[],
  prompt: string,
  opts: CreateSessionOptions,
  parser: ClaudeEventParser,
): Promise<SessionOutput> {
  return new Promise<SessionOutput>((resolve) => {
    const { cmd, spawnArgs } = buildSpawnCommand(CLAUDE_BIN, args);
    const env = buildSpawnEnv(opts);
    const spawnOpts = buildSpawnOptions(opts.cwd, env);

    const feedLine = createLineBuffer((line) => parser.feed(line));

    const sr = spawnAndWait(
      cmd, spawnArgs, spawnOpts, opts.timeoutMs,
      (ok, code) => {
        flushBuffer(feedLine);
        const text = parser.getResultText();
        if (ok && text) {
          resolve({ ok: true, text, sessionId: "" });
        } else if (ok && !text) {
          resolve({ ok: false, text: "", sessionId: "",
            error: "claude -p exited 0 but produced no output" });
        } else {
          resolve({ ok: false, text, sessionId: "",
            error: `claude -p exited ${code}: ${sr.stderr.slice(0, 500)}` });
        }
      },
      opts.onSpawn,
    );

    // stdout: use line buffer directly
    sr.child.stdout?.on("data", (chunk) => feedLine(chunk));
    // stderr tracking
    sr.child.stderr?.on("data", (chunk) => { sr.stderr += chunk.toString(); });

    // Write prompt via stdin, then close
    sr.child.stdin!.write(prompt);
    sr.child.stdin!.end();
  });
}

// ---- Provider ----------------------------------------------------------------

export const claudeProvider: AgentProvider = {
  id: "claude",
  bin: CLAUDE_BIN,

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    const sessionId = opts.sessionId || crypto.randomUUID();
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode",
      process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
      "--session-id", sessionId,
    ];

    const parser = new ClaudeEventParser();
    parser.onProgress = opts.onProgress;
    parser.onSessionId = opts.onSessionId;

    return spawnClaude(args, prompt, opts, parser).then(
      (r) => ({ ...r, sessionId: r.sessionId || sessionId }),
    );
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode",
      process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
      "--resume", sessionId,
    ];

    const parser = new ClaudeEventParser();
    parser.onProgress = opts.onProgress;

    return spawnClaude(args, prompt, opts, parser).then(
      (r) => ({ ...r, sessionId }),
    );
  },
};
