// ============================================================
// Slack Auto-Reply Gateway — standing daemon
//
// Unlike the MCP server (src/index.ts), which is a passive tool that
// Claude Code calls, this is a long-running process that drives itself:
// it listens on Socket Mode and, for each incoming @mention or DM,
// generates a reply via `claude -p` and posts it back to Slack.
//
// RUN THIS IN YOUR OWN TERMINAL (not from a sandboxed shell): the spawned
// `claude -p` inherits this process's network/auth, and only the native
// environment can reach the configured ANTHROPIC_BASE_URL.
//
// Reuses the connection + send primitives from the MCP server modules.
// ============================================================

// Load .env from the project root, regardless of cwd (same logic as index.ts)
import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dotEnvResult = loadDotEnv({ path: resolve(projectRoot, ".env") });
for (const key of ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"] as const) {
  if (process.env[key]?.startsWith("${") && dotEnvResult.parsed?.[key]) {
    process.env[key] = dotEnvResult.parsed[key];
  }
}

import { initSlackClients, getWebClient } from "./slack-clients.js";
import {
  startSocketMode,
  stopSocketMode,
  enrichEvent,
} from "./socket-manager.js";
import { eventStore } from "./event-store.js";
import { generateReply } from "./reply-engine.js";
import { sessionStore } from "./session-store.js";
import {
  ensureGatewayDir,
  PID_FILE,
  STATUS_FILE,
  type GatewayStatus,
} from "./gateway-paths.js";
import { writeFileSync, rmSync } from "node:fs";
import type { StoredEvent } from "./types.js";

// ============================================================
// Config / validation
// ============================================================

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error(
    "[gateway] FATAL: SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required (check .env)"
  );
  process.exit(1);
}

initSlackClients({ botToken: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN });

// Optional: directory the spawned `claude -p` runs in (for tool/file access)
const CLAUDE_CWD = process.env.GATEWAY_CLAUDE_CWD || projectRoot;
const REPLY_TIMEOUT_MS = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
// Max concurrent `claude -p` replies. Excess events queue and run as slots free.
const MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.GATEWAY_MAX_CONCURRENT || 3)
);
// Evict thread→session mappings idle longer than this (default 24h).
const SESSION_IDLE_MS = Number(
  process.env.GATEWAY_SESSION_IDLE_MS || 24 * 60 * 60 * 1000
);

// ============================================================
// Reply decision
// ============================================================

/** Decide whether a stored event warrants an auto-reply. */
function shouldReply(event: StoredEvent): boolean {
  // Always reply to explicit @mentions (any channel)
  if (event.type === "app_mention") return true;

  // Reply to direct messages (DMs). channel_type lives on the raw payload.
  if (event.type === "message") {
    const channelType = (event.raw as Record<string, unknown> | undefined)
      ?.channel_type as string | undefined;
    if (channelType === "im") return true;
  }

  // Ignore plain channel chatter (not addressed to the bot) and reactions.
  return false;
}

// ============================================================
// Prompt construction
// ============================================================

/** Strip the leading <@BOTID> mention from text for a cleaner prompt. */
function cleanText(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

/**
 * Build the prompt sent to `claude -p`.
 *
 * When `resume` is true the Claude session already holds this thread's
 * history, so we send just the new message (lean). On a fresh session we
 * include light thread context + a persona/format preamble.
 */
async function buildPrompt(
  event: StoredEvent,
  resume: boolean
): Promise<string> {
  const userMsg = cleanText(event.text || "");
  const who = event.user_name || event.user || "a user";

  // Resuming: the model remembers the thread; just relay the new turn.
  if (resume) {
    return `(channel ${event.channel}) ${who} wrote: "${userMsg}"`;
  }

  const web = getWebClient();
  const where = event.channel_name ? `#${event.channel_name}` : "a DM";

  let context = "";
  // First turn in a thread that already has prior messages: seed context.
  const threadTs = event.thread_ts;
  if (threadTs && threadTs !== event.ts) {
    try {
      const res = await web.conversations.replies({
        channel: event.channel,
        ts: threadTs,
        limit: 8,
      });
      const msgs = (res.messages || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any) => {
          const u = (m.user as string) || "?";
          const t = cleanText((m.text as string) || "");
          return t ? `${u}: ${t}` : "";
        })
        .filter(Boolean)
        .join("\n");
      if (msgs) context = `\n\nThread context so far:\n${msgs}`;
    } catch {
      // ignore — context is best-effort
    }
  }

  return [
    `You are ClaudeCodeApp, an AI assistant replying in Slack (${where}).`,
    `Current channel ID: ${event.channel}.`,
    `${who} wrote: "${userMsg}"`,
    context,
    "",
    "You have Slack tools (mcp__slack__*): read channel history, thread replies,",
    "list channels, look up users, post/react. Use them when the request needs",
    "Slack data (e.g. summarizing a channel — call slack_channel_history with the",
    "channel ID above). Do NOT claim you cannot read Slack.",
    "Write a concise, helpful Slack reply. Use Slack mrkdwn formatting.",
    "Reply with ONLY the message text — no preamble, no quotes around it.",
  ]
    .filter((s) => s !== undefined)
    .join("\n");
}

// ============================================================
// Event handler — with dedup, concurrency cap, and correct handled-timing
// ============================================================

// Events currently being processed (keyed by event.ts) — guards against
// Slack redelivery / socket reconnect causing a duplicate reply.
const inFlight = new Set<string>();

// Simple counting semaphore to cap concurrent `claude -p` spawns.
let running = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseSlot(): void {
  running = Math.max(0, running - 1);
  const next = waiters.shift();
  if (next) {
    running += 1;
    next();
  }
}

// Per-thread serial queues. A thread maps to ONE Claude session, so its
// turns must run sequentially — two concurrent `claude -p --resume <same uuid>`
// would corrupt session state. We chain each thread's work on a promise;
// different threads still run in parallel (bounded by the global semaphore).
const threadChains = new Map<string, Promise<void>>();

/** Entry point: enqueue an event onto its thread's serial chain. */
function onEvent(event: StoredEvent): void {
  if (!shouldReply(event)) {
    eventStore.markHandled(event.id);
    return;
  }

  // Dedup: skip Slack redelivery of an event we're already handling/queued.
  const dedupKey = event.ts || event.id;
  if (inFlight.has(dedupKey)) {
    eventStore.markHandled(event.id);
    return;
  }
  inFlight.add(dedupKey);

  const replyThreadTs = event.thread_ts || event.ts;
  const tKey = sessionStore.threadKey(event.channel, replyThreadTs);

  // Append to this thread's chain so same-thread turns run in order.
  const prev = threadChains.get(tKey) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // a prior failure shouldn't break the chain
    .then(() => processEvent(event, tKey, replyThreadTs));
  threadChains.set(tKey, next);
  // Clean up the map entry once this is the tail of the chain.
  void next.finally(() => {
    if (threadChains.get(tKey) === next) threadChains.delete(tKey);
  });
}

/** Process one event: reply via the thread's reused Claude session. */
async function processEvent(
  event: StoredEvent,
  tKey: string,
  replyThreadTs: string
): Promise<void> {
  const web = getWebClient();

  // Wait for a global concurrency slot (queues if MAX_CONCURRENT reached).
  await acquireSlot();

  try {
    await enrichEvent(event); // resolve user_name / channel_name (best effort)

    const session = sessionStore.getOrCreate(tKey);
    const resume = session.started;
    console.error(
      `[gateway] reply (${running}/${MAX_CONCURRENT} slots) ` +
        `${resume ? "resume" : "new"} session ${session.sessionId.slice(0, 8)} ` +
        `for ${event.type} from ${event.user_name || event.user} in ` +
        `${event.channel_name || event.channel}`
    );

    const prompt = await buildPrompt(event, resume);
    const result = await generateReply(prompt, {
      timeoutMs: REPLY_TIMEOUT_MS,
      cwd: CLAUDE_CWD,
      sessionId: session.sessionId,
      resume,
    });

    if (result.ok) {
      // First successful turn establishes the session; later turns resume it.
      sessionStore.markStarted(tKey);
    } else if (!resume) {
      // A brand-new session failed to start — drop the mapping so the next
      // turn mints a fresh UUID rather than trying to --resume a non-session.
      sessionStore.reset(tKey);
    }

    const text = result.ok
      ? result.text
      : `:warning: 抱歉，我暂时无法生成回复（${result.error}）。`;

    await web.chat.postMessage({
      channel: event.channel,
      thread_ts: replyThreadTs,
      text,
    });

    console.error(
      `[gateway] ${result.ok ? "replied" : "posted error notice"} to ` +
        `${event.channel} (thread ${replyThreadTs})`
    );
  } catch (err) {
    console.error("[gateway] reply failed:", (err as Error).message);
    try {
      await web.chat.postMessage({
        channel: event.channel,
        thread_ts: replyThreadTs,
        text: `:warning: 回复时出错：${(err as Error).message}`,
      });
    } catch {
      // give up
    }
  } finally {
    eventStore.markHandled(event.id);
    inFlight.delete(event.ts || event.id);
    releaseSlot();
  }
}

// ============================================================
// Startup / shutdown
// ============================================================

async function main(): Promise<void> {
  console.error("[gateway] starting Slack auto-reply gateway...");
  console.error(`[gateway] claude cwd: ${CLAUDE_CWD}`);

  // Write PID file so the control commands (status/stop/restart) find us.
  ensureGatewayDir();
  const startedAt = Date.now();
  try {
    writeFileSync(PID_FILE, String(process.pid));
  } catch (err) {
    console.error(
      "[gateway] WARNING: could not write PID file:",
      (err as Error).message
    );
  }

  // Periodically write a runtime snapshot for `status` / `list`.
  const writeStatus = (): void => {
    const snapshot: GatewayStatus = {
      pid: process.pid,
      startedAt,
      updatedAt: Date.now(),
      activeSlots: running,
      maxConcurrent: MAX_CONCURRENT,
      sessions: sessionStore.entries(),
    };
    try {
      writeFileSync(STATUS_FILE, JSON.stringify(snapshot, null, 2));
    } catch {
      // best effort
    }
  };
  writeStatus();
  const statusTimer = setInterval(writeStatus, 5000);
  statusTimer.unref?.();

  // Periodically evict idle thread→session mappings to bound memory.
  const evictTimer = setInterval(() => {
    const removed = sessionStore.evictIdle(SESSION_IDLE_MS);
    if (removed > 0) {
      console.error(
        `[gateway] evicted ${removed} idle session mapping(s); ` +
          `${sessionStore.size()} active`
      );
    }
  }, 30 * 60 * 1000);
  // Don't keep the process alive just for the eviction timer.
  evictTimer.unref?.();

  await startSocketMode((event) => {
    // onEvent enqueues onto the thread's serial chain (non-blocking).
    onEvent(event);
  });
  console.error(
    "[gateway] listening — will auto-reply to @mentions and DMs. " +
      "Sessions are reused per thread. Ctrl+C to stop."
  );
}

async function shutdown(): Promise<void> {
  console.error("[gateway] shutting down...");
  await stopSocketMode();
  // Clean up control-plane files so `status` reports stopped.
  try {
    rmSync(PID_FILE, { force: true });
    rmSync(STATUS_FILE, { force: true });
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[gateway] fatal:", (err as Error).message);
  process.exit(1);
});
