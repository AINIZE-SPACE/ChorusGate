// ============================================================
// ClaudeStreamProvider — 双向 stream-json 协议
//
// 使用 `claude -p --input-format stream-json --output-format stream-json`
// stdin 发送 JSON 消息（保持打开），stdout 解析 JSON 事件。
//
// 本模块导出两个 API：
//   1. claudeStreamProvider  — AgentProvider 接口实现（ONE-SHOT）：
//      createSession() / resumeSession() 是一次性的（spawn → stdin→end → 等结果）。
//      用于 GATEWAY_CLAUDE_MODE=stream + INTERACTIVE_PERMISSIONS=false 的简单模式。
//      与 legacy ClaudeProvider 语义一致：不保持 stdin 打开、不支持审批交互。
//
//   2. createStreamSession() — 双向会话（BIDIRECTIONAL）：
//      stdin 保持打开直到 close()，支持实时 sendPermissionResponse() 回写
//      approve/deny 响应。用于 GATEWAY_CLAUDE_MODE=stream + INTERACTIVE_PERMISSIONS=true
//      的完整审批流程。不要用 claudeStreamProvider 替代这个！！！
//
// 与单向 ClaudeProvider 的关键差异：
//   - stdin 不关闭（可回写 approve/deny）
//   - 解析 system.init 获取 session_id
//   - system.permission_request → 审批回调 → stdin 回写
//   - --replay-user-messages 回显用户消息（isReplay:true 忽略）
//
// MCP: `claude -p` 继承父进程环境，直接加载项目 `.mcp.json`。
// ChorusGate MCP 固定为 Web API 工具集，不承担 Socket Mode 收事件。
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
// ============================================================

import { spawn, type ChildProcess } from "node:child_process";
import { ClaudeStreamParser } from "./claude-stream-parser.js";
import {
  buildSpawnCommand,
  buildSpawnOptions,
  buildSpawnEnv,
} from "./_spawn-helpers.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
  StreamUpdate,
} from "./types.js";
import { toolLabel } from "./types.js";

/** Build shared args for claude -p stream-json mode. */
function buildStreamArgs(sessionFlag: "--session-id" | "--resume", sessionId: string, model?: string): string[] {
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--replay-user-messages",
    "--permission-mode", process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
    sessionFlag, sessionId,
  ];
  // M3: opt-in token-level streaming (#85)
  if (process.env.CLAUDE_STREAM_PARTIAL === "true") {
    args.splice(args.indexOf("--verbose") + 1, 0, "--include-partial-messages");
  }
  // #86: model selection — env override takes precedence over opts.model
  const effectiveModel = process.env.CLAUDE_MODEL || model;
  if (effectiveModel) {
    args.push("--model", effectiveModel);
  }
  return args;
}

// ---- StreamUpdate binding helper (#86) ---------------------------------------

/**
 * Wrap parser callbacks to emit unified StreamUpdate events.
 * Works for both one-shot (claudeStreamProvider) and bidirectional
 * (createStreamSession) paths.
 *
 * Callbacks that depend on --include-partial-messages (text, thinking,
 * block_start/stop, tool_param) are wrapped unconditionally — they simply
 * won't fire if partial messages are disabled.
 */
function bindStreamUpdate(
  parser: ClaudeStreamParser,
  onStreamUpdate: (update: StreamUpdate) => void,
): void {
  const su = onStreamUpdate;

  // session_id — always fires (system/init)
  const origSid = parser.onSessionId;
  parser.onSessionId = (sid) => {
    origSid?.(sid);
    su({ kind: "session_id", payload: sid, providerId: "claude-stream" });
  };

  // progress — always fires (via onProgress)
  // Always wrap, even if orig is undefined (#86 warning #4 fix)
  const origProgress = parser.onProgress;
  parser.onProgress = (l) => {
    origProgress?.(l);
    su({ kind: "progress", payload: l, providerId: "claude-stream" });
  };

  // tool_call + progress — fires from assistant tool_use blocks
  // (inherited from ClaudeEventParser.onToolCall, which fires for ALL tool_use,
  //  not just those wrapped by stream_event)
  parser.onToolCall = (name, _input) => {
    const label = toolLabel(name);
    su({ kind: "tool_call", payload: { name, label }, providerId: "claude-stream" });
    su({ kind: "progress", payload: label, providerId: "claude-stream" });
  };

  // done — fires when result event arrives
  parser.onDone = () => {
    su({ kind: "done", payload: null, providerId: "claude-stream" });
  };

  // The following only fire when --include-partial-messages is active.
  // We wrap them unconditionally so they "just work" when the flag is on.

  const origText = parser.onTextDelta;
  parser.onTextDelta = (t) => {
    origText?.(t);
    su({ kind: "text", payload: t, providerId: "claude-stream" });
  };

  const origThinking = parser.onThinkingDelta;
  parser.onThinkingDelta = (t) => {
    origThinking?.(t);
    su({ kind: "thinking", payload: t, providerId: "claude-stream" });
  };

  const origBlockStart = parser.onBlockStart;
  parser.onBlockStart = (b) => {
    origBlockStart?.(b);
    su({ kind: "block_start", payload: b, providerId: "claude-stream" });
    // #86 warning #6: thinking block → also emit progress
    if (b === "thinking") {
      su({ kind: "progress", payload: "🧠 Extended Thinking…", providerId: "claude-stream" });
    }
  };

  const origBlockStop = parser.onBlockStop;
  parser.onBlockStop = (b) => {
    origBlockStop?.(b);
    su({ kind: "block_stop", payload: b, providerId: "claude-stream" });
  };

  const origMetrics = parser.onMetrics;
  parser.onMetrics = (m) => {
    origMetrics?.(m);
    su({ kind: "metrics", payload: m, providerId: "claude-stream" });
  };

  const origToolParam = parser.onToolParam;
  parser.onToolParam = (j) => {
    origToolParam?.(j);
    su({ kind: "tool_param", payload: j, providerId: "claude-stream" });
  };

  const origHook = parser.onHook;
  parser.onHook = (h) => {
    origHook?.(h);
    su({ kind: "hook", payload: h, providerId: "claude-stream" });
  };
}

// ---- spawn helper ------------------------------------------------------------

interface StreamSpawnResult {
  child: ChildProcess;
  parser: ClaudeStreamParser;
  stdoutBuf: string;
  stderr: string;
  settled: boolean;
}

function spawnStream(
  args: string[],
  cwd: string,
  parser: ClaudeStreamParser,
  env?: Record<string, string | undefined>,
  onSpawn?: (child: ChildProcess) => void,
): StreamSpawnResult {
  const { cmd, spawnArgs } = buildSpawnCommand(process.env.CLAUDE_BIN || "claude", args);
  const spawnOpts = buildSpawnOptions(cwd, env);
  console.error(`[claude-stream] SPAWN: ${cmd}`);
  const child = spawn(cmd, spawnArgs, spawnOpts);

  try { onSpawn?.(child); } catch { /* best effort */ }

  const result: StreamSpawnResult = {
    child,
    parser,
    stdoutBuf: "",
    stderr: "",
    settled: false,
  };

  child.stdout!.on("data", (chunk) => {
    result.stdoutBuf += chunk.toString();
    const lines = result.stdoutBuf.split("\n");
    result.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) parser.feed(line);
  });

  child.stderr!.on("data", (chunk) => {
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
    const { child, parser } = spawnResult;

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
        error: `failed to spawn ${process.env.CLAUDE_BIN || "claude"}: ${err.message}`,
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
        console.error(`[claude-stream] EXIT ${code}, stderr(${spawnResult.stderr.length}B): ${spawnResult.stderr.trim().slice(0, 500)}`);
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
  get bin() { return process.env.CLAUDE_BIN || "claude"; },

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    // createSession is ALWAYS for new sessions (routed by generateReply).
    // Even if opts.sessionId is truthy (from sessionStore), use --session-id.
    const sessionId = opts.sessionId || crypto.randomUUID();
    const env = buildSpawnEnv(opts);
    const args = buildStreamArgs("--session-id", sessionId, opts.model);
    const parser = new ClaudeStreamParser();
    parser.onProgress = opts.onProgress;
    parser.onSessionId = opts.onSessionId;
    // #86: unified streaming
    if (opts.onStreamUpdate) bindStreamUpdate(parser, opts.onStreamUpdate);
    const sr = spawnStream(args, opts.cwd, parser, env, opts.onSpawn);
    parser.onResult = () => { if (!sr.settled) sr.child.stdin?.end(); };

    // Send user prompt on stdin (keep pipe open for future approve/deny)
    const userMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
    sr.child.stdin?.write(userMsg);
    // NOTE: stdin NOT closed — open for approve/deny responses

    // Wait for result
    const result = await streamToResult(sr, opts.timeoutMs);

    // Close stdin now that we have the result
    if (!sr.settled) sr.child.stdin?.end();

    return { ...result, sessionId: result.sessionId || sessionId };
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const env = buildSpawnEnv(opts);
    const args = buildStreamArgs("--resume", sessionId, opts.model);
    const parser = new ClaudeStreamParser();
    parser.onProgress = opts.onProgress;
    // #86: unified streaming
    if (opts.onStreamUpdate) bindStreamUpdate(parser, opts.onStreamUpdate);
    const sr = spawnStream(args, opts.cwd, parser, env, opts.onSpawn);
    parser.onResult = () => { if (!sr.settled) sr.child.stdin?.end(); };

    const userMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
    sr.child.stdin?.write(userMsg);

    const result = await streamToResult(sr, opts.timeoutMs);

    if (!sr.settled) sr.child.stdin?.end();

    return { ...result, sessionId };
  },
};

// ---- StreamSession: bidirectional API for permission_request flow ----------

/**
 * 双向 stream-json session。
 *
 * 与 AgentProvider.createSession() 返回的 one-shot SessionOutput 不同，
 * ClaudeStreamSession 保持 stdin 打开，允许在 Claude 运行过程中通过
 * sendPermissionResponse() 回写 approve/deny 响应。
 *
 * 典型流程:
 *   const session = createStreamSession(prompt, opts);
 *   session.parser.onPermissionRequest = async (req) => {
 *     // Slack 发送审批按钮，用户点击后调用:
 *     session.sendPermissionResponse(req.requestId, true);
 *   };
 *   const result = await session.result;  // 等待最终结果
 *   session.close();
 */
export interface ClaudeStreamSession {
  /** session_id (从 system.init 解析或在 spawn 前预生成) */
  sessionId: string;
  /** 事件解析器 (可绑定 onPermissionRequest 等回调) */
  parser: ClaudeStreamParser;
  /** 最终结果 Promise */
  result: Promise<SessionOutput>;
  /** 发送权限响应回 Claude stdin */
  sendPermissionResponse(requestId: string, granted: boolean): void;
  /** 关闭 session (kill 进程 + 清理) */
  close(): void;
}

/**
 * 创建双向 stream-json session (stdin 保持打开)。
 *
 * 与 claudeStreamProvider.createSession() 不同:
 *   - 不等待最终结果即返回
 *   - stdin 保持打开直到 close() 调用
 *   - 可通过 sendPermissionResponse() 实时审批
 *   - onPermissionRequest 构造时绑定，避免 spawn 后竞态
 *
 * @param opts.onPermissionRequest 审批回调 — 必须在 spawn 前绑定，
 *   防止首条 permission_request 在回调注册前到达而丢失。
 */
export function createStreamSession(
  prompt: string,
  opts: CreateSessionOptions & {
    /** 审批回调 (构造时绑定以避免竞态) */
    onPermissionRequest?: (req: import("./claude-stream-parser.js").PermissionRequest) => void;
    /** 任务计划回调 (构造时绑定) */
    onPlanUpdate?: (plan: import("./claude-parser.js").PlanUpdate) => void;
    /** M3 流式增量回调 (#85) */
    onTextDelta?: (text: string) => void;
    onThinkingDelta?: (thinking: string) => void;
    onBlockStart?: (blockType: string) => void;
    onBlockStop?: (blockType: string) => void;
    onMetrics?: (m: { costUsd?: number; inputTokens?: number; outputTokens?: number }) => void;
    /** 续接已有 session (true) vs 新 session (false) */
    resume?: boolean;
  },
): ClaudeStreamSession {
  // 使用 resume 标志而非 !!opts.sessionId，因为新 session 也有预生成的 UUID
  const sessionId = opts.sessionId || crypto.randomUUID();
  const isResume = !!opts.resume;
  const env = buildSpawnEnv(opts);
  const args = buildStreamArgs(
    isResume ? "--resume" : "--session-id", sessionId, opts.model,
  );

  const parser = new ClaudeStreamParser();
  parser.onProgress = opts.onProgress;
  parser.onSessionId = opts.onSessionId;
  if (opts.onPermissionRequest) {
    parser.onPermissionRequest = opts.onPermissionRequest;
  }
  if (opts.onPlanUpdate) {
    parser.onPlanUpdate = opts.onPlanUpdate;
  }
  // M3: 流式增量回调 — raw callbacks + unified StreamUpdate (#85, #86)
  if (opts.onTextDelta) parser.onTextDelta = opts.onTextDelta;
  if (opts.onThinkingDelta) parser.onThinkingDelta = opts.onThinkingDelta;
  if (opts.onBlockStart) parser.onBlockStart = opts.onBlockStart;
  if (opts.onBlockStop) parser.onBlockStop = opts.onBlockStop;
  if (opts.onMetrics) parser.onMetrics = opts.onMetrics;
  if (opts.onStreamUpdate) bindStreamUpdate(parser, opts.onStreamUpdate);
  // result → close stdin
  parser.onResult = () => {
    if (!sr.settled) {
      try { sr.child.stdin?.end(); } catch { /* ignore */ }
    }
  };

  const sr = spawnStream(args, opts.cwd, parser, env, opts.onSpawn);

  // Send user prompt on stdin (keep pipe open)
  const userMsg =
    JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
  console.error(`[claude-stream] stdin prompt (${userMsg.length}B): ${userMsg.slice(0, 100)}...`);
  if (sr.child.stdin) {
    sr.child.stdin.write(userMsg);
  } else {
    console.error("[claude-stream] WARNING: stdin is null, cannot write prompt");
  }

  const resultPromise = streamToResult(
    { ...sr, parser } as StreamSpawnResult & { parser: ClaudeStreamParser },
    opts.timeoutMs,
  );

  return {
    sessionId,
    parser,

    result: resultPromise,

    sendPermissionResponse(requestId: string, granted: boolean): void {
      if (sr.settled) {
        console.error(
          "[claude-stream] WARNING: session already settled, ignoring permission_response",
        );
        return;
      }
      const msg =
        JSON.stringify({
          type: "permission_response",
          request_id: requestId,
          granted,
        }) + "\n";
      if (sr.child.stdin) {
        sr.child.stdin.write(msg);
      } else {
        console.error(
          "[claude-stream] WARNING: stdin is null, cannot send permission_response",
        );
      }
    },

    close(): void {
      if (sr.settled) return;
      sr.settled = true;
      try {
        if (sr.child.stdin) sr.child.stdin.end();
      } catch {
        // ignore
      }
      sr.child.kill("SIGKILL");
    },
  };
}
