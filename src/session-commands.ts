// ============================================================
// Session commands — Slack-side control of Claude Code sessions
//
// Lets a Slack user list and switch the Claude session bound to the current
// channel/thread, enabling shared sessions across Slack and Claude Code:
//
//   /cc_sessions       list sessions tracked in memory/sessions.md
//   /cc_resume N|<uuid> bind THIS scope to session N (or a specific UUID)
//   /cc_new             drop this scope's binding (next msg starts fresh)
//   /cc_current         show this scope's bound session
//   /cchelp             list commands
//
// Source of truth is sessionStore (memory/sessions.md) — no .jsonl reading.
// ============================================================

import { getWebClient } from "./slack-clients.js";
import { sessionStore } from "./session-store.js";

/** Context for posting a command response. */
export interface ReplyContext {
  /** Channel to post the response in. */
  channel: string;
  /** Thread timestamp; omit for a channel-level reply (no thread). */
  threadTs?: string;
}

export type Command =
  | { kind: "sessions" }
  | { kind: "resume"; arg: string }
  | { kind: "new" }
  | { kind: "current" }
  | { kind: "help" };

/** Detect a session command from message text. Returns null if not a command. */
export function detectCommand(text: string): Command | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [raw, ...rest] = t.slice(1).split(/\s+/);
  const cmd = raw.toLowerCase();
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "cc_sessions":
    case "sessions":
    case "list":
      return { kind: "sessions" };
    case "cc_resume":
    case "resume":
    case "switch":
      return { kind: "resume", arg };
    case "cc_new":
    case "new":
    case "reset":
      return { kind: "new" };
    case "cc_current":
    case "current":
    case "whoami":
      return { kind: "current" };
    case "cchelp":
    case "cc_help":
    case "help":
      return { kind: "help" };
    default:
      return null;
  }
}

function fmtTime(ms: number): string {
  if (!ms) return "??";
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Handle a session command and post the response to Slack. */
export async function handleCommand(
  cmd: Command,
  scopeKey: string,
  ctx: ReplyContext
): Promise<void> {
  const web = getWebClient();
  const post = (text: string): Promise<unknown> =>
    web.chat.postMessage({
      channel: ctx.channel,
      ...(ctx.threadTs ? { thread_ts: ctx.threadTs } : {}),
      text,
    });

  const bound = sessionStore.entries().find((e) => e.key === scopeKey);

  switch (cmd.kind) {
    case "help": {
      await post(
        [
          "*可用命令：*",
          "`/cc_sessions` — 列出已知的 Claude Code 会话",
          "`/cc_resume N` 或 `/cc_resume <uuid>` — 把当前频道绑定到某个会话",
          "`/cc_new` — 重置当前频道，下条消息开新会话",
          "`/cc_current` — 显示当前频道绑定的会话",
          "`/cchelp` — 显示本帮助",
        ].join("\n")
      );
      return;
    }

    case "current": {
      if (!bound) {
        await post("当前频道还没有绑定会话，下一条消息会自动新建。");
      } else {
        await post(
          `当前频道绑定的会话：\`${bound.sessionId}\`\n` +
            `最后使用：${fmtTime(bound.lastUsed)}`
        );
      }
      return;
    }

    case "new": {
      sessionStore.reset(scopeKey);
      await post("🆕 已重置当前频道的会话，下一条消息将开始全新对话。");
      return;
    }

    case "sessions": {
      const all = sessionStore
        .entries()
        .sort((a, b) => b.lastUsed - a.lastUsed);
      if (all.length === 0) {
        await post("暂无已知会话，发一条消息会自动新建。");
        return;
      }
      const lines = all.map((s, i) => {
        const mark = bound && bound.sessionId === s.sessionId ? "  ⬅ 当前" : "";
        return (
          `${i + 1}. \`${s.sessionId.slice(0, 8)}…\`` +
          `  ${fmtTime(s.lastUsed)}` +
          `  \`${s.key}\`` +
          mark
        );
      });
      await post(
        `*已知会话（${all.length} 个）：*\n\n` +
          lines.join("\n") +
          "\n\n用 `/cc_resume N` 切换到对应会话。"
      );
      return;
    }

    case "resume": {
      if (!cmd.arg) {
        await post("用法：`/cc_resume N`（编号）或 `/cc_resume <session-uuid>`。");
        return;
      }
      const all = sessionStore
        .entries()
        .sort((a, b) => b.lastUsed - a.lastUsed);
      let target: (typeof all)[number] | undefined;

      if (/^\d+$/.test(cmd.arg)) {
        target = all[Number(cmd.arg) - 1];
      } else {
        const a = cmd.arg.toLowerCase();
        target = all.find(
          (s) => s.sessionId === a || s.sessionId.startsWith(a)
        );
      }

      if (!target) {
        await post(
          `没找到会话 \`${cmd.arg}\`。先用 \`/cc_sessions\` 看看可用编号。`
        );
        return;
      }
      sessionStore.setSession(scopeKey, target.sessionId);
      await post(
        `✅ 当前频道已切换到会话 \`${target.sessionId.slice(0, 8)}…\`\n` +
          `之后的对话将在此会话中继续，上下文已加载。`
      );
      return;
    }
  }
}
