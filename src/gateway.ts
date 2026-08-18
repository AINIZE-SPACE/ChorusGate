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

import { bootstrap } from "./bootstrap.js";
import type { ProfileConfig, ProfileTriggers } from "./profile-config.js";
import { parseProfileTriggers } from "./profile-config.js";
import { parseCliArgs } from "./cli-args.js";
import { requireWindowsAdmin } from "./require-admin.js";

// Windows requires an elevated process (see require-admin.ts). Enforced here
// as defense-in-depth — the CLI dispatcher also guards, but `npm run gateway`
// (tsx src/gateway.ts) bypasses it.
requireWindowsAdmin();

const cliArgs = parseCliArgs();
// Default to "default" agent profile when neither --agent nor --env-file given
// (spec AC1: `chorusgate run` ≡ `chorusgate run --agent default`).
const agentId = cliArgs.agentId ?? (cliArgs.envFile ? undefined : "default");
// Control-plane identity: pid/status/log always live under
// ~/.chorusgate/<agent>/ — with --env-file and no --agent, use "default".
const controlAgentId = agentId ?? "default";

// Issue #141: daemon-owned rotating logger. Init as early as possible so all
// console output (this file + socket-manager, same process) is captured, even
// before main() runs. The daemon self-manages the log fd — the CLI `start`
// no longer passes a stdio fd (rotating from inside the daemon is the only
// way around the fd-rename trap on Windows).
const logger = createLogger({ logFile: getLogFile(controlAgentId) });
// Route all console output through the rotating logger (module "daemon").
redirectConsoleToLogger(logger);

const profiles = bootstrap({ agentId, envFile: cliArgs.envFile });

import { getWebClient } from "./slack-clients.js";
import {
  getSocketManager,
  enrichEvent,
  type SocketManager,
  type SlashCommand,
  type BlockAction,
} from "./socket-manager.js";
import { eventStore } from "./event-store.js";
import { durableEventStore } from "./durable-event-store.js";
import { generateReply, generateReplyStream } from "./reply-engine.js";
import { sessionStore } from "./session-store.js";
import {
  PermissionTracker,
  buildApprovalBlocks,
} from "./permission-tracker.js";
import { PlanTracker } from "./plan-tracker.js";
import { interruptManager } from "./interrupt.js";
import { detectCommand, handleCommand } from "./session-commands.js";
import { type SessionIdentity, formatIdentityKey } from "./session-store.js";
import { buildSessionContext, buildRoutingContext, buildFullContextPrompt } from "./session-context.js";
import { channelDirectory } from "./channel-directory.js";
import {
  ensureGatewayDir,
  getPidFile,
  getStatusFile,
  getLogFile,
  type GatewayStatus,
} from "./gateway-paths.js";
import { createLogger, redirectConsoleToLogger } from "./logger.js";
import { writeFileSync, rmSync } from "node:fs";
import type { StoredEvent } from "./types.js";
import { sanitizeForSlack, splitSlackMessage } from "./slack-message.js";

// ---- multi-profile routing ---------------------------------------------------
// Build a lookup map from profile id → ProfileConfig for O(1) routing.
const profileMap = new Map<string, ProfileConfig>();
for (const p of profiles) {
  profileMap.set(p.id, p);
}

// Per-scope project directory overrides (set by /cc_new --project).
const scopeProjectOverrides = new Map<string, string>();

/** Get the CLI working directory for a profile. */
function profileCwd(profileId: string): string {
  return profileMap.get(profileId)?.cwd || process.env.GATEWAY_CLAUDE_CWD || process.cwd();
}

/** Get the command prefix for a profile. */
function profilePrefix(profileId: string): string {
  return profileMap.get(profileId)?.commandPrefix || "cc";
}

/** Get the provider id for a profile. */
function profileProvider(profileId: string): string {
  return profileMap.get(profileId)?.providerId || "claude";
}

// ============================================================
// Reply decision
// ============================================================

/**
 * Compute the session identity for a channel+thread+profile combination.
 * - "channel" scope (default): one shared session per channel/DM,
 *   EXCEPT assistant threads in DMs — each new chat (distinct thread_ts)
 *   gets its own session so "新聊天" always starts fresh.
 * - "thread" scope: one session per thread everywhere.
 * Slash commands always use channel scope (they carry no thread_ts).
 */
function sessionIdentity(
  channel: string,
  profileId: string,
  providerId: string,
  threadTs?: string,
  channelType?: string,
  projectDir?: string,
): SessionIdentity {
  // Check for a per-scope project dir override (set by /cc_new --project).
  const useThread =
    ((process.env.GATEWAY_SESSION_SCOPE || "channel") === "thread" && threadTs) ||
    (channelType === "im" && threadTs);

  const scopeKey = useThread
    ? `thread:${channel}:${threadTs}`
    : `channel:${channel}`;
  const effectiveProjectDir =
    scopeProjectOverrides.get(scopeKey) ?? projectDir;

  if (useThread) {
    return sessionStore.threadIdentity(
      profileId, providerId, channel, threadTs!, effectiveProjectDir,
    );
  }
  return sessionStore.channelIdentity(
    profileId, providerId, channel, effectiveProjectDir,
  );
}

/** Bot user IDs — skip messages from these (self-reply loop prevention). */
const BOT_USER_IDS = new Set([
  "U0B8VHLHJAX",  // 小克 (CC)
  "U0BAGFVD8VB",  // 小扣 (CX)
]);

/** Decide whether a stored event warrants an auto-reply.
 *
 * #128: Multi-level decision pipeline:
 *   Level 1 — hard filters (subtype, bot, empty)
 *   Level 2 — app_mention + DM (existing)
 *   Level 3 — Thread context (name match, parent-is-bot)
 *   Level 4 — LLM judgment (optional, env-gated)
 */
async function shouldReply(
  event: StoredEvent,
  profileId: string,
): Promise<boolean> {
  // Level 1: Hard filters
  if (event.subtype) return false;
  if (!event.user || BOT_USER_IDS.has(event.user)) return false;
  if (!cleanText(event.text || "")) return false;

  // Level 2: Explicit mentions + DM
  if (event.type === "app_mention") return true;
  if (event.type === "message") {
    const channelType = (event.raw as Record<string, unknown> | undefined)
      ?.channel_type as string | undefined;
    if (channelType === "im") return true;
  }

  // Level 3: Thread context smart reply
  if (process.env.GATEWAY_THREAD_SMART_REPLY !== "0") {
    const profile = profileMap.get(profileId);
    if (!profile) return false;

    const triggers = parseProfileTriggers(profileId, "unknown");
    const text = event.text || "";

    // 3A: Name match — user mentioned our display name or aliases
    if (mentionsMyName(text, triggers)) return true;

    // 3B: Thread parent is our own message (user replied to us)
    const threadTs = event.thread_ts;
    if (threadTs && threadTs !== event.ts) {
      if (await isThreadParentBot(threadTs, event.channel, profileId)) {
        return true;
      }

      // 3C: No other bot was mentioned in this message, and it's in a
      //     thread we're participating in → likely relevant
      if (!mentionsOtherBot(text, profileId)) {
        // Check if this thread has one of our sessions (meaning we're active in it)
        if (isActiveInThread(event.channel, threadTs, profileId)) {
          return true;
        }
      }
    }

    // Level 4: LLM judgment (optional, expensive — default off)
    if (process.env.GATEWAY_LLM_REPLY_JUDGE === "1") {
      return await llmShouldReply(event, triggers);
    }
  }

  return false;
}

/** Check if text contains the bot's display name or aliases. */
function mentionsMyName(text: string, triggers: ProfileTriggers): boolean {
  const lower = text.toLowerCase();
  // Explicit Slack mention
  if (triggers.botUserId !== "unknown" && lower.includes(`<@${triggers.botUserId}>`)) {
    return true;
  }
  // Name / alias match
  for (const word of [triggers.displayName, ...triggers.aliases]) {
    if (word && lower.includes(word.toLowerCase())) return true;
  }
  return false;
}

/** Check if text mentions any *other* bot (not our profile). */
function mentionsOtherBot(text: string, myProfileId: string): boolean {
  // Find bot user IDs that aren't ours
  for (const botId of BOT_USER_IDS) {
    if (text.includes(`<@${botId}>`)) {
      // Check if this is our own bot ID — if so, not "other"
      // (We can't determine exact mapping without profile triggers,
      //  so we're conservative: if it mentions ANY bot ID, skip.)
      return true;
    }
  }
  return false;
}

/** Cache for thread parent checks (ttl 30s). */
const threadParentCache = new Map<string, { user: string; ts: number }>();

/** Check if the thread's parent message was authored by this bot. */
async function isThreadParentBot(
  threadTs: string,
  channel: string,
  profileId: string,
): Promise<boolean> {
  const cacheKey = `${channel}:${threadTs}`;
  const cached = threadParentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30_000) {
    return cached.user !== "unknown";
  }

  try {
    const web = getWebClient();
    const res = await web.conversations.replies({
      channel,
      ts: threadTs,
      limit: 1,
    });
    const parent = res.messages?.[0] as { user?: string } | undefined;
    const user = parent?.user || "unknown";
    threadParentCache.set(cacheKey, { user, ts: Date.now() });
    // Check if parent is either of our bot user IDs
    return BOT_USER_IDS.has(user);
  } catch {
    threadParentCache.set(cacheKey, { user: "unknown", ts: Date.now() });
    return false;
  }
}

/** Check if we're actively participating in this thread. */
function isActiveInThread(
  channel: string,
  threadTs: string,
  profileId: string,
): boolean {
  const providerId = profileMap.get(profileId)?.providerId || "claude";
  const id = sessionStore.threadIdentity(
    profileId, providerId, channel, threadTs,
  );
  // Check existing entries without creating a new session
  const entries = sessionStore.entries();
  return entries.some(
    (e) =>
      e.identity.scopeTarget === id.scopeTarget &&
      e.identity.threadTs === id.threadTs &&
      e.identity.profileId === id.profileId &&
      e.started,
  );
}

/**
 * LLM judgment for message relevance (Level 4, optional).
 * Uses a lightweight prompt to ask if the message is directed at us.
 */
async function llmShouldReply(
  event: StoredEvent,
  triggers: ProfileTriggers,
): Promise<boolean> {
  try {
    const result = await generateReply(
      `You are ${triggers.displayName}. A user posted this Slack message ` +
      `in a channel or thread. Reply ONLY with the single word "YES" or "NO": ` +
      `is this message directed at you or requiring your attention?\n\n` +
      `Message: "${event.text}"`,
      {
        timeoutMs: 10_000,
        cwd: profileCwd(Array.from(profileMap.keys())[0] || "default"),
        providerId: "claude",
        sessionId: undefined,
        resume: false,
      },
    );
    return result.ok && result.text.trim().toUpperCase().startsWith("YES");
  } catch {
    return false;
  }
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
 *
 * #132: session context + routing info injected for async reply awareness.
 */
async function buildPrompt(
  event: StoredEvent,
  resume: boolean,
  profileId: string,
  replyThreadTs?: string,
): Promise<string> {
  const userMsg = cleanText(event.text || "");
  const who = event.user_name || event.user || "a user";

  // #132: build session context info for injection
  const connectedProfiles = Array.from(profileMap.keys());
  const ctx = buildSessionContext(
    { profileId, providerId: profileProvider(profileId), scopeType: "channel", scopeTarget: event.channel },
    event, profileId, connectedProfiles,
  );
  const routing = buildRoutingContext(event, profileId, replyThreadTs);

  // Resuming: the model remembers the thread; just relay the new turn.
  if (resume) {
    return [
      buildFullContextPrompt(ctx, routing),
      ``,
      `(channel ${event.channel}) ${who} wrote: "${userMsg}"`,
    ].join("\n");
  }

  const web = getWebClient();
  const where = event.channel_name ? `#${event.channel_name}` : "a DM";

  // #132: session context prefix
  const sessionCtx = buildFullContextPrompt(ctx, routing);

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
    `You are ChorusGate, an AI assistant replying in Slack (${where}).`,
    sessionCtx,
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

// ---- concurrency ------------------------------------------------------------

/** Parse GATEWAY_MAX_CONCURRENT — single source of truth, read at call time. */
function getMaxConcurrent(): number {
  const r = Number(process.env.GATEWAY_MAX_CONCURRENT || 3);
  return Number.isFinite(r) && r > 0 ? Math.floor(r) : 3;
}

/** Check if interactive permission flow is enabled — read at call time. */
function isInteractivePermissionsEnabled(): boolean {
  return process.env.GATEWAY_INTERACTIVE_PERMISSIONS !== "0" &&
    (process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions") !== "bypassPermissions";
}

function acquireSlot(): Promise<void> {
  const MAX_CONCURRENT = getMaxConcurrent();
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

// Per-scope serial queues. A scope maps to ONE Claude session, so its
// turns must run sequentially — two concurrent `claude -p --resume <same uuid>`
// would corrupt session state. We chain each scope's work on a promise;
// different scopes still run in parallel (bounded by the global semaphore).
const threadChains = new Map<string, Promise<void>>();

// M2: Permission tracker for interactive approve/deny via Slack buttons
const permissionTracker = new PermissionTracker();
// Plan tracker: parse Claude todo tool output → Slack plan status message
const planTracker = new PlanTracker();

/** Handle a native Slack slash command for session control. */
function onSlash(slashCmd: SlashCommand): void {
  const id = sessionIdentity(
    slashCmd.channelId,
    slashCmd.profileId,
    profileProvider(slashCmd.profileId),
    undefined, // slash commands always channel scope
    undefined,
    profileCwd(slashCmd.profileId),
  );
  const sKey = formatIdentityKey(id);
  const prefix = profilePrefix(slashCmd.profileId);
  const command = detectCommand(
    slashCmd.command + (slashCmd.text ? ` ${slashCmd.text}` : ""),
    prefix,
  );
  if (!command) {
    console.error(
      `[gateway] unrecognized slash command: ${slashCmd.command}` +
        ` (profile: ${slashCmd.profileId})`,
    );
    return;
  }

  // Build a project dir setter for the scope override map.
  const scopeKey = `channel:${slashCmd.channelId}`;
  const onSetProjectDir = (dir: string | undefined) => {
    if (dir) scopeProjectOverrides.set(scopeKey, dir);
    else scopeProjectOverrides.delete(scopeKey);
  };

  // Run on the channel's serial chain to avoid races with concurrent messages.
  const prev = threadChains.get(sKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try {
      await handleCommand(command, id, { channel: slashCmd.channelId }, prefix, onSetProjectDir);
    } catch (err) {
      console.error(
        "[gateway] slash command handler failed:",
        (err as Error).message,
      );
    }
  });
  threadChains.set(sKey, next);
  void next.finally(() => {
    if (threadChains.get(sKey) === next) threadChains.delete(sKey);
  });
}

/** Entry point: enqueue an event onto its scope's serial chain. */
async function onEvent(event: StoredEvent, profileId: string): Promise<void> {
  if (!(await shouldReply(event, profileId))) {
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

  // #1: durable dedup — skip if this event.ts was already replied in a
  // previous gateway run (survives restarts)
  if (durableEventStore.isDedup(event.ts)) {
    console.error(
      `[gateway] durable dedup: skipping already-replied event ${event.ts}`,
    );
    eventStore.markHandled(event.id);
    inFlight.delete(dedupKey);
    return;
  }

  // #1: record event as pending before processing
  durableEventStore.markPending({
    ts: event.ts,
    channel: event.channel,
    user: event.user,
    user_name: event.user_name,
    type: event.type,
    text: event.text,
  });

  const channelType = (event.raw as Record<string, unknown> | undefined)
    ?.channel_type as string | undefined;
  // DM: reply directly, not in thread. Channel: reply in thread.
  const replyThreadTs = channelType === "im"
    ? undefined
    : (event.thread_ts || event.ts);

  const providerId = profileProvider(profileId);
  const id = sessionIdentity(
    event.channel, profileId, providerId, replyThreadTs, channelType,
    profileCwd(profileId),
  );
  const tKey = formatIdentityKey(id);

  // Session commands bypass the
  // AI reply path — handle them directly, but still on the scope chain so
  // ordering/dedup stay consistent.
  const prefix = profilePrefix(profileId);
  const cmd = detectCommand(cleanText(event.text || ""), prefix);

  const prev = threadChains.get(tKey) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // a prior failure shouldn't break the chain
    .then(async () => {
      if (cmd) {
        const evtScopeKey = replyThreadTs
          ? `thread:${event.channel}:${replyThreadTs}`
          : `channel:${event.channel}`;
        const onSetProjectDir = (dir: string | undefined) => {
          if (dir) scopeProjectOverrides.set(evtScopeKey, dir);
          else scopeProjectOverrides.delete(evtScopeKey);
        };
        try {
          await handleCommand(cmd, id, {
            channel: event.channel,
            threadTs: replyThreadTs,
          }, prefix, onSetProjectDir);
        } catch (err) {
          console.error("[gateway] command failed:", (err as Error).message);
        } finally {
          eventStore.markHandled(event.id);
          inFlight.delete(dedupKey);
        }
        return;
      }
      return processEvent(event, id, tKey, replyThreadTs, profileId);
    });
  threadChains.set(tKey, next);
  // Clean up the map entry once this is the tail of the chain.
  void next.finally(() => {
    if (threadChains.get(tKey) === next) threadChains.delete(tKey);
  });
}

/** Process one event: reply via the scope's reused Claude session. */
async function processEvent(
  event: StoredEvent,
  id: SessionIdentity,
  tKey: string,
  replyThreadTs: string | undefined,
  profileId: string,
): Promise<void> {
  // #1: mark event as being processed
  durableEventStore.markProcessing(event.ts);

  // ---- busy interrupt check ----
  // If this session already has a running claude -p, interrupt or queue.
  // interrupt() kills the current process (interrupt mode) or awaits its
  // exit (queue mode), then returns true so we proceed with the new message.
  if (interruptManager.isRunning(tKey)) {
    await interruptManager.interrupt(tKey, event.channel, replyThreadTs);
  }

  const web = getWebClient();
  let progressDone = false;
  let progressChain = Promise.resolve();
  let placeholderTs: string | undefined;

  // Use the long timeout for resume turns (established sessions tend to be
  // longer tasks — the user has already context-built). Fresh sessions get
  // the normal timeout. Both are configurable via env vars.
  const isResume = sessionStore.getOrCreate(id).started;
  // 动态读取 process.env 而非模块常量——ESM 导入链中可能有模块
  // 在 bootstrap()/loadEnv() 之前已读取默认值 180000。
  const replyTimeoutMs = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
  const replyTimeoutMsLong = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS_LONG || replyTimeoutMs * 2);
  const timeoutMs = isResume ? replyTimeoutMsLong : replyTimeoutMs;

  // Wait for a global concurrency slot (queues if MAX_CONCURRENT reached).
  await acquireSlot();

  /** Stop heartbeat + wait for the progress update queue to drain. */
  const stopProgress = async (): Promise<void> => {
    progressDone = true;
    await progressChain;
  };

  // #129: intermediate progress messages — append mode avoids "(edited)" label
  const progressMode =
    process.env.GATEWAY_PROGRESS_MODE || "hybrid"; // "edit" | "hybrid" | "append"
  const progressMessages: string[] = [];
  const maxProgressMsgs = Number(process.env.GATEWAY_PROGRESS_MAX_MESSAGES || 5);
  /** Track ts of appended progress messages for cleanup on error. */
  const appendedMsgTs: string[] = [];

  async function appendProgressResult(
    label: string,
    content: string,
  ): Promise<void> {
    if (progressDone) return;
    if (progressMessages.length >= maxProgressMsgs) return;
    if (progressMessages.includes(label)) return;
    progressMessages.push(label);
    const text = `*${label}*\n${content.slice(0, 1000)}`;
    try {
      const msg = await web.chat.postMessage({
        channel: event.channel,
        thread_ts: replyThreadTs,
        text,
        link_names: true,
      });
      if (msg.ts) appendedMsgTs.push(msg.ts as string);
    } catch { /* ignore */ }
  }

  /** Clean up appended progress messages (e.g. on error). */
  async function cleanupProgressMessages(): Promise<void> {
    for (const ts of appendedMsgTs) {
      try {
        await web.chat.update({ channel: event.channel, ts, text: "…" });
      } catch { /* best-effort */ }
    }
    appendedMsgTs.length = 0;
  }

  try {
    await enrichEvent(event); // resolve user_name / channel_name (best effort)

    const session = sessionStore.getOrCreate(id);
    const resume = session.started;
    console.error(
      `[gateway] reply (${running}/${getMaxConcurrent()} slots, timeout ${timeoutMs / 1000}s) ` +
        `${resume ? "resume" : "new"} session ${session.sessionId.slice(0, 8)} ` +
        `for ${event.type} from ${event.user_name || event.user} in ` +
        `${event.channel_name || event.channel}`
    );

    const prompt = await buildPrompt(event, resume, profileId, replyThreadTs);

    // --- live progress: post a placeholder, then edit it in place ---
    let lastUpdate = 0;
    let lastLabel = "";
    let lastToolAt = 0;

    if (process.env.GATEWAY_PROGRESS !== "0") {
      try {
        const ph = await web.chat.postMessage({
          channel: event.channel,
          thread_ts: replyThreadTs,
          text: "⏳ 处理中…",
          link_names: true,
        });
        placeholderTs = ph.ts as string | undefined;
      } catch {
        placeholderTs = undefined; // fall back to plain post at the end
      }
    }

    // Throttled in-place update of the placeholder message.
    const updatePlaceholder = (text: string, force = false): void => {
      if (!placeholderTs || progressDone) return;
      const now = Date.now();
      if (!force && now - lastUpdate < 1500) return; // throttle to dodge rate limits
      lastUpdate = now;
      progressChain = progressChain
        .then(async () => {
          if (progressDone || !placeholderTs) return;
          await web.chat.update({ channel: event.channel, ts: placeholderTs, text });
        })
        .catch(() => {});
    };

    // No heartbeat — Claude stream emits tool_use events for real progress.
    // Placeholder is updated via onProgress callback only.

    const profile = profileMap.get(profileId);
    const replyOpts = {
      timeoutMs,
      cwd: profileCwd(profileId),
      sessionId: session.sessionId,
      resume,
      profileId,
      providerId: profileProvider(profileId),
      botToken: profile?.botToken,
      appToken: profile?.appToken,
      onSpawn: (child: import("node:child_process").ChildProcess) => {
        interruptManager.register(tKey, child);
      },
      onProgress: (label: string) => {
        lastLabel = label;
        lastToolAt = Date.now();
        // #129: edit mode shows label directly; hybrid/append update placeholder
        // (no appended message — placeholder alone is enough for progress labels)
        if (progressMode === "edit") {
          updatePlaceholder(label, true);
        } else {
          updatePlaceholder(`⏳ ${label}`, true);
        }
      },
      // #129: StreamUpdate handler — append intermediate results
      onStreamUpdate: (update: import("./providers/types.js").StreamUpdate) => {
        if (progressMode === "edit") return; // old behavior
        switch (update.kind) {
          case "tool_call": {
            const tc = update.payload as { name: string; label: string };
            if (tc.label && tc.label !== lastLabel) {
              lastLabel = tc.label;
              updatePlaceholder(`⏳ ${tc.label}`, true);
              appendProgressResult("🔧 执行工具", tc.label);
            }
            break;
          }
          case "metrics": {
            const m = update.payload as {
              inputTokens?: number;
              outputTokens?: number;
              costUsd?: number;
            };
            const parts: string[] = [];
            if (m.inputTokens) parts.push(`输入 ${m.inputTokens.toLocaleString()} tokens`);
            if (m.outputTokens) parts.push(`输出 ${m.outputTokens.toLocaleString()} tokens`);
            if (m.costUsd) parts.push(`$${m.costUsd.toFixed(4)}`);
            if (parts.length > 0) {
              updatePlaceholder(`📊 ${parts.join(" / ")}`, true);
            }
            break;
          }
          case "block_start": {
            const bs = update.payload as string;
            if (bs === "thinking") {
              updatePlaceholder("🧠 思考中…", true);
            }
            break;
          }
          case "done":
            // Final update is handled by the reply posting logic
            break;
        }
      },
    };

    console.error(`[gateway] generating reply — timeoutMs=${timeoutMs} isResume=${isResume}`);
    const result =
      isInteractivePermissionsEnabled()
      ? await generateReplyStream(prompt, {
          ...replyOpts,
          onPermission: async (req) => {
            // Check auto-approval cache first (session/always scope).
            const providerId = profile?.providerId ?? "claude";
            const sessionIdentity = `${profileId}:${providerId}:${event.channel}:${replyThreadTs}`;
            const autoScope = permissionTracker.checkAutoApproval(
              sessionIdentity, req.toolName, event.user,
            );
            if (autoScope) {
              console.error(
                `[gateway] permission ${req.requestId} (${req.toolName}): ` +
                  `auto-approved (${autoScope})`,
              );
              return true;
            }

            // Post Slack interactive message with 4 approval buttons
            if (placeholderTs) {
              await stopProgress();
            }
            const blocks = buildApprovalBlocks(
              req.toolName,
              req.toolInput,
              req.requestId,
              event.user,
              replyTimeoutMsLong,
            );
            try {
              await web.chat.postMessage({
                channel: event.channel,
                thread_ts: replyThreadTs,
                blocks,
                text: `Claude 请求执行 \`${req.toolName}\` — 需要你的批准`,
                link_names: true,
              });
            } catch (err) {
              console.error(
                "[gateway] failed to post approval message:",
                (err as Error).message,
              );
            }

            // Wait for user response (auto-denies after timeout)
            const scope = await permissionTracker.waitForApproval(
              req.requestId,
              {
                toolName: req.toolName,
                toolInput: req.toolInput,
                channel: event.channel,
                threadTs: replyThreadTs,
                requesterUserId: event.user,
                sessionIdentity,
              },
            );
            console.error(
              `[gateway] permission ${req.requestId} (${req.toolName}): ` +
                `${scope}`,
            );
            return scope !== "deny";
          },
          onTextDelta: (text: string) => {
            if (placeholderTs) {
              updatePlaceholder(`💬 ${text.slice(-500)}`);
            }
          },
          onBlockStart: (blockType: string) => {
            if (placeholderTs) {
              const label = blockType === "thinking" ? "🧠 思考中…" : "💬 回复中…";
              updatePlaceholder(label, true);
            }
          },
          onBlockStop: (_blockType: string) => {
            // block end — next text_delta or tool_use will update the placeholder
          },
          onMetrics: (m: { costUsd?: number; inputTokens?: number; outputTokens?: number }) => {
            console.error(
              `[gateway] stream metrics: ` +
              `tokens(in=${m.inputTokens},out=${m.outputTokens}) ` +
              `cost=${m.costUsd}`,
            );
          },
          onPlanUpdate: async (plan) => {
            const planKey = `${event.channel}:${replyThreadTs}`;
            const update = planTracker.updatePlan(planKey, plan.entries);
            if (!update || !update.changed) return;

            const existingTs = planTracker.getPlanMessageTs(planKey);
            try {
              if (existingTs) {
                await web.chat.update({
                  channel: event.channel,
                  ts: existingTs,
                  text: update.text,
                });
              } else {
                const msg = await web.chat.postMessage({
                  channel: event.channel,
                  thread_ts: replyThreadTs,
                  text: update.text,
                  link_names: true,
                });
                if (msg.ts) {
                  planTracker.setPlanMessageTs(planKey, msg.ts as string);
                }
              }
            } catch (err) {
              console.error(
                "[gateway] failed to update plan message:",
                (err as Error).message,
              );
            }
          },
        })
      : await generateReply(prompt, replyOpts);

    await stopProgress();

    console.error(
      `[gateway] reply result: ok=${result.ok} textLen=${result.text?.length || 0} ` +
      `text=${(result.text || "").slice(0, 80)} error=${result.error || "-"}`,
    );

    if (result.ok) {
      if (result.sessionId && result.sessionId !== session.sessionId) {
        sessionStore.setSession(id, result.sessionId);
      }
      sessionStore.markStarted(id);
    } else if (!resume) {
      sessionStore.reset(id);
    }

    const text = result.ok
      ? result.text
      : `:warning: 抱歉，我暂时无法生成回复（${result.error}）。`;

    const displayText = sanitizeForSlack(
      (text && text.trim().length > 10) ? text
      : planTracker.getPlanMessageTs(`${event.channel}:${replyThreadTs}`)
        ? "👆 以上为任务进度，最终回复见上方的消息。"
        : (text || "✅ 完成")
    );

    console.error(
      `[gateway] posting reply: placeholderTs=${placeholderTs} ` +
      `displayLen=${displayText.length}`,
    );

    const replyChunks = splitSlackMessage(displayText);
    if (placeholderTs) {
      // #131: chat.update may fail with msg_too_long even for text under limit.
      // Fall back to postMessage (new message) instead of losing the reply.
      try {
        await web.chat.update({
          channel: event.channel,
          ts: placeholderTs,
          text: replyChunks[0],
        });
      } catch (updateErr) {
        console.error(
          `[gateway] chat.update failed (${(updateErr as Error).message}), ` +
          `falling back to postMessage`,
        );
        // Fallback: post as new message instead of updating placeholder
        await web.chat.postMessage({
          channel: event.channel,
          thread_ts: replyThreadTs,
          text: replyChunks[0],
          link_names: true,
        });
        // Try to mark the placeholder as done with a minimal text
        try {
          await web.chat.update({
            channel: event.channel,
            ts: placeholderTs,
            text: "✅",
          });
        } catch { /* ignore — placeholder cleanup is best-effort */ }
      }
      for (const chunk of replyChunks.slice(1)) {
        await web.chat.postMessage({
          channel: event.channel,
          thread_ts: replyThreadTs,
          text: chunk,
          link_names: true,
        });
      }
    } else {
      for (const chunk of replyChunks) {
        await web.chat.postMessage({
          channel: event.channel,
          thread_ts: replyThreadTs,
          text: chunk,
          link_names: true,
        });
      }
    }

    // Clean up appended progress messages now that final reply is posted
    await cleanupProgressMessages();

    // #1: mark as successfully replied
    durableEventStore.markReplied(event.ts);

    console.error(
      `[gateway] ${result.ok ? "replied" : "posted error notice"} to ` +
        `${event.channel} (thread ${replyThreadTs})`
    );
  } catch (err) {
    console.error("[gateway] reply failed:", (err as Error).message);
    // #1: record failure for diagnostics/retry
    durableEventStore.markFailed(event.ts, (err as Error).message);
    // Drain the progress queue first so the placeholder is in a stable state,
    // then overwrite it with the error (rather than leaving it stuck on the
    // last tool label forever).
    await stopProgress();
    await cleanupProgressMessages();
    try {
      const errText = `:warning: 回复时出错：${(err as Error).message}`;
      if (placeholderTs) {
        await web.chat.update({
          channel: event.channel,
          ts: placeholderTs,
          text: errText,
        });
      } else {
        await web.chat.postMessage({
          channel: event.channel,
          thread_ts: replyThreadTs,
          text: errText,
          link_names: true,
        });
      }
    } catch {
      // give up
    }
  } finally {
    progressDone = true;
    interruptManager.unregister(tKey);
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
  console.error(`[gateway] gateway cwd: ${process.cwd()}`);
  console.error(`[gateway] profiles: ${profiles.map(p => `${p.id}(${p.providerId})`).join(", ")}`);
  console.error(`[gateway] claude cwd: ${process.env.GATEWAY_CLAUDE_CWD || process.cwd()}`);
  {
    const t = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
    const tl = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS_LONG || t * 2);
    console.error(`[gateway] REPLY_TIMEOUT_MS/REPLY_TIMEOUT_MS_LONG: ${t}/${tl}`);
  }

  // Write PID file so the control commands (status/stop/restart) find us.
  ensureGatewayDir(controlAgentId);
  const startedAt = Date.now();
  try {
    writeFileSync(getPidFile(controlAgentId), String(process.pid));
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
      maxConcurrent: getMaxConcurrent(),
      sessions: sessionStore.entries(),
    };
    try {
      writeFileSync(getStatusFile(controlAgentId), JSON.stringify(snapshot, null, 2));
    } catch {
      // best effort
    }
  };
  writeStatus();
  const statusTimer = setInterval(writeStatus, 5000);
  statusTimer.unref?.();

  // Periodically evict idle thread→session mappings to bound memory.
  const evictTimer = setInterval(() => {
    const removed = sessionStore.evictIdle(
      Number(process.env.GATEWAY_SESSION_IDLE_MS || 24 * 60 * 60 * 1000)
    );
    if (removed > 0) {
      console.error(
        `[gateway] evicted ${removed} idle session mapping(s); ` +
          `${sessionStore.size()} active`
      );
    }
  }, 30 * 60 * 1000);
  // Don't keep the process alive just for the eviction timer.
  evictTimer.unref?.();

  // #1: log durable event store stats on startup
  {
    const counts = durableEventStore.countByState();
    console.error(
      `[gateway] durable-event-store: ${durableEventStore.size()} events — ` +
      `pending=${counts.pending} processing=${counts.processing} ` +
      `replied=${counts.replied} failed=${counts.failed}`,
    );
    // Evict old replied entries to bound file size
    const removed = durableEventStore.evictReplied();
    if (removed > 0) {
      console.error(
        `[gateway] durable-event-store: evicted ${removed} old replied entries`,
      );
    }
    // Log any replayable events (they'll be re-processed via Slack redelivery)
    const replayable = durableEventStore.getReplayable();
    if (replayable.length > 0) {
      console.error(
        `[gateway] durable-event-store: ${replayable.length} replayable events ` +
        `(will replay via Slack redelivery) — ts: ${replayable.map(e => e.ts.slice(0, 10)).join(", ")}`,
      );
    }
  }

  const socketManager = getSocketManager();
  socketManager.setEventCallback((event, profileId) => {
    // onEvent enqueues onto the thread's serial chain (non-blocking).
    onEvent(event, profileId);
  });
  socketManager.setSlashCallback(onSlash);
  if (isInteractivePermissionsEnabled()) {
    socketManager.setBlockActionCallback(async (action) => {
      const result = permissionTracker.handleAction(action.actionValue);
      if (!result.handled) return;

      if (action.userId !== result.requesterUserId) {
        console.error(
          `[gateway] permission block_action from non-requester: ` +
          `${action.userId} (expected ${result.requesterUserId}), ignoring`,
        );
        return;
      }

      // Build status text reflecting the chosen scope
      const scopeLabel: Record<string, string> = {
        once: `✅ Approved once by <@${action.userId}>`,
        session: `📋 Approved for session by <@${action.userId}>`,
        always: `🔒 Always approved by <@${action.userId}>`,
        deny: `❌ Denied by <@${action.userId}>`,
      };
      const statusText = scopeLabel[result.scope ?? "deny"] ??
        `✅ Approved by <@${action.userId}>`;
      try {
        const webClient = getWebClient();
        await webClient.chat.update({
          channel: action.channelId,
          ts: action.messageTs,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: statusText },
            },
          ],
          text: statusText,
        });
      } catch (err) {
        console.error(
          "[gateway] failed to update approval message:",
          (err as Error).message,
        );
      }
    });
  }

  // Start all profiles — one Socket Mode connection per Slack app.
  await socketManager.startAll(profiles);

  console.error(
    "[gateway] listening on " +
      `${profiles.length} Slack app(s) — ` +
      `will auto-reply to @mentions and DMs. ` +
      `Sessions are reused per ${process.env.GATEWAY_SESSION_SCOPE || "channel"} scope. Ctrl+C to stop.`
  );
}

async function shutdown(): Promise<void> {
  console.error("[gateway] shutting down...");
  const socketManager = getSocketManager();
  await socketManager.stopAll();
  // Clean up control-plane files so `status` reports stopped.
  try {
    rmSync(getPidFile(controlAgentId), { force: true });
    rmSync(getStatusFile(controlAgentId), { force: true });
  } catch {
    // ignore
  }
  // Flush + close the rotating logger so the final lines land on disk.
  await logger.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[gateway] fatal:", (err as Error).message);
  process.exit(1);
});
