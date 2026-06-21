// ============================================================
// Reply Engine — thin adapter over AgentProvider (v3 refactor)
//
// Spawn + stream-json/JSONL parse logic lives in src/providers/.
// This module keeps the legacy ReplyEngineOptions signature for
// backward compat with gateway.ts.
//
// 跟踪: [#22](https://github.com/AINIZE-SPACE/chorusgate/issues/22)
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34) — M2 stream mode
// ============================================================

import type { ReplyEngineOptions, ReplyResult } from "./providers/types.js";
import type { PermissionRequest } from "./providers/claude-stream-parser.js";
import type { PlanUpdate } from "./providers/claude-parser.js";

// Re-export for backward compat
export type { ReplyEngineOptions, ReplyResult };

/**
 * Generate a reply via the configured AgentProvider.
 * Set GATEWAY_CLAUDE_MODE=stream for ClaudeStreamProvider (bidirectional).
 * Default: ClaudeProvider (legacy one-shot).
 */
export async function generateReply(
  prompt: string,
  opts: ReplyEngineOptions = {}
): Promise<ReplyResult> {
  // Select provider based on profileId → providerId routing.
  // Falls back to GATEWAY_CLAUDE_MODE for backward compat.
  const providerId = opts.providerId || "claude";
  const mode = process.env.GATEWAY_CLAUDE_MODE || "legacy";

  let provider;
  switch (providerId) {
    case "codex":
      provider = (await import("./providers/codex.js")).codexProvider;
      break;
    case "claude-stream":
      provider = (await import("./providers/claude-stream.js")).claudeStreamProvider;
      break;
    default: // "claude"
      provider = mode === "stream"
        ? (await import("./providers/claude-stream.js")).claudeStreamProvider
        : (await import("./providers/claude.js")).claudeProvider;
  }

  const timeoutMs = opts.timeoutMs ?? 180_000;
  console.error(`[reply-engine] generateReply opts.timeoutMs=${opts.timeoutMs} → timeoutMs=${timeoutMs}`);
  const cwd = opts.cwd ?? process.cwd();
  // 动态读取 env 而非模块常量——ESM 静态 import 链中 PERMISSION_MODE
  // 可能在 bootstrap()/loadEnv() 之前已被冻结为默认值。沿用 a4f05c1 修法。
  const permissionMode =
    process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";

  try {
    if (opts.sessionId && opts.resume) {
      const r = await provider.resumeSession(prompt, opts.sessionId, {
        cwd,
        timeoutMs,
        mcpConfigPath: "",
        permissionMode,
        botToken: opts.botToken,
        appToken: opts.appToken,
        onProgress: opts.onProgress,
        onSpawn: opts.onSpawn,
      });
      if (r.ok) return { ok: true, text: r.text, sessionId: r.sessionId };
      // Resume failed — auto fallback to new session.
      // Mark the response so the user knows this is a fresh start.
      console.error(
        `[reply-engine] resume failed (${r.error}), auto-creating new session`,
      );
      const fr = await provider.createSession(prompt, {
        cwd,
        timeoutMs,
        mcpConfigPath: "",
        permissionMode,
        botToken: opts.botToken,
        appToken: opts.appToken,
        onProgress: opts.onProgress,
        onSpawn: opts.onSpawn,
      });
      if (fr.ok) {
        return {
          ok: true,
          text: `🆕 新会话（之前的会话已过期，已自动创建新会话）\n\n${fr.text}`,
        };
      }
      return { ok: false, text: "", error: fr.error };
    }

    const r = await provider.createSession(prompt, {
      cwd,
      timeoutMs,
      mcpConfigPath: "",
      permissionMode,
      sessionId: opts.sessionId,
      botToken: opts.botToken,
      appToken: opts.appToken,
      onProgress: opts.onProgress,
      onSpawn: opts.onSpawn,
    });
    if (r.ok) return { ok: true, text: r.text, sessionId: r.sessionId };

    // New session also failed — retry once, then give user a clear message
    console.error(
      `[reply-engine] createSession failed (${r.error}), retrying once...`,
    );
    const r2 = await provider.createSession(prompt, {
      cwd,
      timeoutMs: Math.min(timeoutMs * 2, 900_000),
      mcpConfigPath: "",
      permissionMode,
      botToken: opts.botToken,
      appToken: opts.appToken,
      onProgress: opts.onProgress,
      onSpawn: opts.onSpawn,
    });
    if (r2.ok) return { ok: true, text: r2.text, sessionId: r2.sessionId };
    return { ok: false, text: "", error: r2.error };
  } catch (err) {
    return {
      ok: false,
      text: "",
      error: `provider error: ${(err as Error).message}`,
    };
  }
}

/**
 * 双向 stream-json reply（M2）。
 *
 * 与 generateReply() 不同，此函数:
 *   - 使用 createStreamSession()（stdin 保持打开）
 *   - 通过 onPermission callback 接收实时审批请求
 *   - onPermission 返回 true=approve, false=deny
 *   - stdin 写回 permission_response 后 Claude 继续执行
 *
 * 仅在 GATEWAY_CLAUDE_MODE=stream 时可用。
 */
export async function generateReplyStream(
  prompt: string,
  opts: ReplyEngineOptions & {
    /** 审批回调: 收到 permission_request 时调用，返回 approve(true)/deny(false) */
    onPermission?: (req: PermissionRequest) => Promise<boolean>;
    /** 任务计划回调: Claude 更新 todo list 时调用 */
    onPlanUpdate?: (plan: PlanUpdate) => void;
    /** M3 流式增量回调 (#85) */
    onTextDelta?: (text: string) => void;
    onBlockStart?: (blockType: string) => void;
    onBlockStop?: (blockType: string) => void;
    onMetrics?: (m: { costUsd?: number; inputTokens?: number; outputTokens?: number }) => void;
    /** M3 统一 StreamUpdate 回调 (#86) */
    onStreamUpdate?: (update: import("./providers/types.js").StreamUpdate) => void;
  } = {}
): Promise<ReplyResult> {
  const { createStreamSession } = await import(
    "./providers/claude-stream.js"
  );

  const timeoutMs = opts.timeoutMs ?? 180_000;
  const cwd = opts.cwd ?? process.cwd();

  let session: Awaited<ReturnType<typeof createStreamSession>> | null = null;
  try {
    session = createStreamSession(prompt, {
      cwd,
      timeoutMs,
      mcpConfigPath: "",
      // 同 generateReply：env 在调用点读，避开模块顶层冻结。
      permissionMode: process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
      sessionId: opts.sessionId,
      resume: opts.resume,
      botToken: opts.botToken,
      appToken: opts.appToken,
      onProgress: opts.onProgress,
      onSpawn: opts.onSpawn,
      onPlanUpdate: opts.onPlanUpdate,
      onTextDelta: opts.onTextDelta,
      onBlockStart: opts.onBlockStart,
      onBlockStop: opts.onBlockStop,
      onMetrics: opts.onMetrics,
      onStreamUpdate: opts.onStreamUpdate, // #86: unified streaming
      onPermissionRequest: opts.onPermission
        ? async (req) => {
            try {
              const granted = await opts.onPermission!(req);
              session!.sendPermissionResponse(req.requestId, granted);
            } catch (err) {
              console.error(
                "[reply-engine] permission callback error, denying:",
                (err as Error).message,
              );
              session!.sendPermissionResponse(req.requestId, false);
            }
          }
        : undefined,
    });

    const result = await session.result;
    return { ok: result.ok, text: result.text, error: result.error };
  } catch (err) {
    return {
      ok: false,
      text: "",
      error: `stream provider error: ${(err as Error).message}`,
    };
  } finally {
    // P1-5 fix: 确保 stdin 关闭，避免子进程延迟退出
    session?.close();
  }
}
