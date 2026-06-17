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
import type { ProfileConfig } from "./profile-config.js";

const profiles = bootstrap();

import { getWebClient } from "./slack-clients.js";
import {
  getSocketManager,
  enrichEvent,
  type SocketManager,
  type SlashCommand,
  type BlockAction,
} from "./socket-manager.js";
import { eventStore } from "./event-store.js";
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
import {
  ensureGatewayDir,
  getPidFile,
  getStatusFile,
  type GatewayStatus,
} from "./gateway-paths.js";
import { writeFileSync, rmSync } from "node:fs";
import type { StoredEvent } from "./types.js";

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

/** Decide whether a stored event warrants an auto-reply. */
function shouldReply(event: StoredEvent): boolean {
  // Skip system events: edits, deletions, message_changed, etc.
  if (event.subtype) return false;
  // Skip bot-authored messages to prevent self-reply loops.
  // Bot progress messages have empty user; bot replies have bot user ID.
  if (!event.user || BOT_USER_IDS.has(event.user)) return false;
  // Skip empty messages
  if (!cleanText(event.text || "")) return false;

  // Always reply to explicit @mentions (any channel)
  if (event.type === "app_mention") return true;

  // Reply to direct messages (DMs).
  if (event.type === "message") {
    const channelType = (event.raw as Record<string, unknown> | undefined)
      ?.channel_type as string | undefined;
    if (channelType === "im") return true;
  }

  // Ignore plain channel chatter and reactions.
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
    `You are ChorusGate, an AI assistant replying in Slack (${where}).`,
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

// ---- concurrency ------------------------------------------------------------

function acquireSlot(): Promise<void> {
  const maxConcurrentRaw = Number(process.env.GATEWAY_MAX_CONCURRENT || 3);
  const MAX_CONCURRENT =
    Number.isFinite(maxConcurrentRaw) && maxConcurrentRaw > 0
      ? Math.floor(maxConcurrentRaw)
      : 3;
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
function onEvent(event: StoredEvent, profileId: string): void {
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
  const _replyTimeoutMs = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
  const _replyTimeoutMsLong = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS_LONG || _replyTimeoutMs * 2);
  const timeoutMs = isResume ? _replyTimeoutMsLong : _replyTimeoutMs;

  // Wait for a global concurrency slot (queues if MAX_CONCURRENT reached).
  await acquireSlot();

  /** Stop heartbeat + wait for the progress update queue to drain. */
  const stopProgress = async (): Promise<void> => {
    progressDone = true;
    await progressChain;
  };

  try {
    await enrichEvent(event); // resolve user_name / channel_name (best effort)

    const session = sessionStore.getOrCreate(id);
    const resume = session.started;
    console.error(
      `[gateway] reply (${running} slots, timeout ${timeoutMs / 1000}s) ` +
        `${resume ? "resume" : "new"} session ${session.sessionId.slice(0, 8)} ` +
        `for ${event.type} from ${event.user_name || event.user} in ` +
        `${event.channel_name || event.channel}`
    );

    const prompt = await buildPrompt(event, resume);

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
        updatePlaceholder(label, true);
      },
    };

    console.error(`[gateway] generating reply — timeoutMs=${timeoutMs} isResume=${isResume} replyOpts.timeoutMs=${replyOpts.timeoutMs}`);
    const result =
      process.env.GATEWAY_INTERACTIVE_PERMISSIONS !== "0" &&
      (process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions") !== "bypassPermissions"
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
              _replyTimeoutMsLong,
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

    const displayText = (text && text.trim().length > 10) ? text
      : planTracker.getPlanMessageTs(`${event.channel}:${replyThreadTs}`)
        ? "👆 以上为任务进度，最终回复见上方的消息。"
        : (text || "✅ 完成");

    console.error(
      `[gateway] posting reply: placeholderTs=${placeholderTs} ` +
      `displayLen=${displayText.length}`,
    );

    if (placeholderTs) {
      await web.chat.update({
        channel: event.channel,
        ts: placeholderTs,
        text: displayText,
      });
    } else {
      await web.chat.postMessage({
        channel: event.channel,
        thread_ts: replyThreadTs,
        text,
        link_names: true,
      });
    }

    console.error(
      `[gateway] ${result.ok ? "replied" : "posted error notice"} to ` +
        `${event.channel} (thread ${replyThreadTs})`
    );
  } catch (err) {
    console.error("[gateway] reply failed:", (err as Error).message);
    // Drain the progress queue first so the placeholder is in a stable state,
    // then overwrite it with the error (rather than leaving it stuck on the
    // last tool label forever).
    await stopProgress();
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
  console.error(`: ${profiles.map(p => `${p.id}(${p.providerId})`).join(", ")}`);
  console.error(`[gateway] claude cwd: ${process.env.GATEWAY_CLAUDE_CWD || process.cwd()}`);

  // Write PID file so the control commands (status/stop/restart) find us.
  ensureGatewayDir();
  const startedAt = Date.now();
  try {
    writeFileSync(getPidFile(), String(process.pid));
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
      maxConcurrent: (() => { const r = Number(process.env.GATEWAY_MAX_CONCURRENT || 3); return Number.isFinite(r) && r > 0 ? Math.floor(r) : 3; })(),
      sessions: sessionStore.entries(),
    };
    try {
      writeFileSync(getStatusFile(), JSON.stringify(snapshot, null, 2));
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

  const socketManager = getSocketManager();
  socketManager.setEventCallback((event, profileId) => {
    // onEvent enqueues onto the thread's serial chain (non-blocking).
    onEvent(event, profileId);
  });
  socketManager.setSlashCallback(onSlash);
  if (
    process.env.GATEWAY_INTERACTIVE_PERMISSIONS !== "0" &&
    (process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions") !== "bypassPermissions"
  ) {
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
    rmSync(getPidFile(), { force: true });
    rmSync(getStatusFile(), { force: true });
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
