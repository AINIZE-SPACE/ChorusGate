// ============================================================
// Reply Engine — thin adapter over AgentProvider (v3 refactor)
//
// Spawn + stream-json/JSONL parse logic lives in src/providers/.
// This module keeps the legacy ReplyEngineOptions signature for
// backward compat with gateway.ts.
//
// 跟踪: [#22](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/22)
// ============================================================

import type { ReplyEngineOptions, ReplyResult } from "./providers/types.js";

// Re-export for backward compat
export type { ReplyEngineOptions, ReplyResult };

const PERMISSION_MODE =
  process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";

/**
 * Generate a reply via the configured AgentProvider.
 * Set GATEWAY_CLAUDE_MODE=stream for ClaudeStreamProvider (bidirectional).
 * Default: ClaudeProvider (legacy one-shot).
 */
export async function generateReply(
  prompt: string,
  opts: ReplyEngineOptions = {}
): Promise<ReplyResult> {
  const mode = process.env.GATEWAY_CLAUDE_MODE || "legacy";
  const provider =
    mode === "stream"
      ? (await import("./providers/claude-stream.js")).claudeStreamProvider
      : (await import("./providers/claude.js")).claudeProvider;

  const timeoutMs = opts.timeoutMs ?? 180_000;
  const cwd = opts.cwd ?? process.cwd();

  try {
    if (opts.sessionId && opts.resume) {
      const r = await provider.resumeSession(prompt, opts.sessionId, {
        cwd,
        timeoutMs,
        mcpConfigPath: "",
        permissionMode: PERMISSION_MODE,
        onProgress: opts.onProgress,
      });
      return { ok: r.ok, text: r.text, error: r.error };
    }

    const r = await provider.createSession(prompt, {
      cwd,
      timeoutMs,
      mcpConfigPath: "",
      permissionMode: PERMISSION_MODE,
      sessionId: opts.sessionId,
      onProgress: opts.onProgress,
    });
    return { ok: r.ok, text: r.text, error: r.error };
  } catch (err) {
    return {
      ok: false,
      text: "",
      error: `provider error: ${(err as Error).message}`,
    };
  }
}
