// ============================================================
// Session commands - Slack-side control of gateway session bindings
//
// Command names are Slack-facing and derive from the configured prefix, while
// the stored session model stays prefix-agnostic:
//
//   /<prefix>_sessions       list sessions tracked in memory/sessions.md
//   /<prefix>_resume N|<uuid> bind THIS scope to session N (or a specific UUID)
//   /<prefix>_new            drop this scope's binding (next msg starts fresh)
//   /<prefix>_current        show this scope's bound session
//   /<prefix>help            list commands
//
// Source of truth is sessionStore (memory/sessions.md) - no .jsonl reading.
// ============================================================

import { getWebClient } from "./slack-clients.js";
import { sessionStore } from "./session-store.js";

const COMMAND_PREFIX = (process.env.GATEWAY_COMMAND_PREFIX || "cc")
  .trim()
  .replace(/^\/+/, "")
  .replace(/_+$/, "")
  .toLowerCase();

function commandName(base: string): string {
  return `${COMMAND_PREFIX}_${base}`;
}

function slashCommand(base: string): string {
  return `/${commandName(base)}`;
}

function slashHelpCommand(): string {
  return `/${commandName("help")}`;
}

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
    case commandName("sessions"):
    case "sessions":
    case "list":
      return { kind: "sessions" };
    case commandName("resume"):
    case "resume":
    case "switch":
      return { kind: "resume", arg };
    case commandName("new"):
    case "new":
    case "reset":
      return { kind: "new" };
    case commandName("current"):
    case "current":
    case "whoami":
      return { kind: "current" };
    case commandName("help"):
    case `${COMMAND_PREFIX}_help`:
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
          "*Available commands:*",
          `\`${slashCommand("sessions")}\` - list known sessions`,
          `\`${slashCommand("resume")} N\` or \`${slashCommand("resume")} <uuid>\` - bind this scope to a known session`,
          `\`${slashCommand("new")}\` - reset this scope so the next message starts fresh`,
          `\`${slashCommand("current")}\` - show the session currently bound to this scope`,
          `\`${slashHelpCommand()}\` - show this help`,
        ].join("\n")
      );
      return;
    }

    case "current": {
      if (!bound) {
        await post(
          "This channel or DM is not bound to a session yet. The next message will create one automatically."
        );
      } else {
        await post(
          `Current bound session: \`${bound.sessionId}\`\n` +
            `Last used: ${fmtTime(bound.lastUsed)}`
        );
      }
      return;
    }

    case "new": {
      sessionStore.reset(scopeKey);
      await post(
        "Reset the current session binding. The next message will start a fresh session."
      );
      return;
    }

    case "sessions": {
      const all = sessionStore.entries().sort((a, b) => b.lastUsed - a.lastUsed);
      if (all.length === 0) {
        await post(
          "No known sessions yet. Send a message and the gateway will create one automatically."
        );
        return;
      }
      const lines = all.map((s, i) => {
        const mark = bound && bound.sessionId === s.sessionId ? "  <- current" : "";
        return (
          `${i + 1}. \`${s.sessionId.slice(0, 8)}...\`` +
          `  ${fmtTime(s.lastUsed)}` +
          `  \`${s.key}\`` +
          mark
        );
      });
      await post(
        `*Known sessions (${all.length}):*\n\n` +
          lines.join("\n") +
          `\n\nUse \`${slashCommand("resume")} N\` to switch to one of them.`
      );
      return;
    }

    case "resume": {
      if (!cmd.arg) {
        await post(
          `Usage: \`${slashCommand("resume")} N\` or \`${slashCommand("resume")} <session-uuid>\`.`
        );
        return;
      }
      const all = sessionStore.entries().sort((a, b) => b.lastUsed - a.lastUsed);
      let target: (typeof all)[number] | undefined;

      if (/^\d+$/.test(cmd.arg)) {
        target = all[Number(cmd.arg) - 1];
      } else {
        const a = cmd.arg.toLowerCase();
        target = all.find((s) => s.sessionId === a || s.sessionId.startsWith(a));
      }

      if (!target) {
        await post(
          `No session matched \`${cmd.arg}\`. Use \`${slashCommand("sessions")}\` to see the available choices.`
        );
        return;
      }
      sessionStore.setSession(scopeKey, target.sessionId);
      await post(
        `Switched this scope to session \`${target.sessionId.slice(0, 8)}...\`.\n` +
          "Subsequent messages will continue in that session."
      );
      return;
    }
  }
}
