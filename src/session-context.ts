// ============================================================
// Session Context — build prompt injection for agent awareness
//
// Builds the session context block injected into the agent's
// system prompt so it knows where it is (channel, thread, user),
// has routing information for async replies, and can reference
// channel names from the directory.
//
// 跟踪: [#132](https://github.com/AINIZE-SPACE/ChorusGate/issues/132)
// ============================================================

import type { SessionIdentity } from "./session-store.js";
import { channelDirectory } from "./channel-directory.js";

// ---- Types -----------------------------------------------------------------

export interface SessionContextInfo {
  /** Session identity (routing key) */
  identity: SessionIdentity;
  /** Resolved channel name, e.g. "#chorusgate_v4" */
  channelName: string;
  /** Channel type label: "channel" | "dm" | "thread" */
  channelType: string;
  /** Display name of the user who triggered the event */
  userName: string;
  /** Connected profile ids (for multi-profile awareness) */
  connectedProfiles: string[];
}

export interface RoutingContext {
  /** Slack channel ID for async replies */
  channelId: string;
  /** Thread timestamp (undefined = top-level channel message) */
  threadTs?: string;
  /** Profile ID for MCP tool routing */
  profileId: string;
  /** Channel display name */
  channelName: string;
}

// ---- Prompt builders -------------------------------------------------------

/**
 * Build the session context injection block for the system prompt.
 * Tells the agent where it is and what tools/platform it has.
 */
export function buildSessionContextPrompt(
  ctx: SessionContextInfo,
): string {
  const lines = [
    `## Current Session Context`,
    ``,
    `- **Channel**: ${ctx.channelName} (${ctx.channelType})`,
    `- **User**: ${ctx.userName}`,
  ];

  if (ctx.connectedProfiles.length > 1) {
    lines.push(`- **Connected profiles**: ${ctx.connectedProfiles.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Build the async reply routing block for the system prompt.
 * Gives the agent the channel/thread IDs needed to send messages
 * asynchronously via MCP tools.
 *
 * Reply routing rule:
 * - Default: reply in the current thread (thread_ts from event).
 * - Exception: when sending a message to someone NOT mentioned in the
 *   thread's parent message, post as a new top-level channel message
 *   (no thread_ts) to avoid hijacking the current thread.
 */
export function buildRoutingContextPrompt(
  routing: RoutingContext,
): string {
  const lines = [
    ``,
    `## Async Reply Routing`,
    `If you need to post results asynchronously (e.g. after a long task), ` +
      `use these identifiers with the Slack MCP tools:`,
    `- **Channel ID**: \`${routing.channelId}\``,
  ];

  if (routing.threadTs) {
    lines.push(`- **Thread TS**: \`${routing.threadTs}\``);
    lines.push(``);
    lines.push(`**Reply routing rule:**`);
    lines.push(`- Default: reply **in this thread** (use the Thread TS above).`);
    lines.push(`- Exception: if you need to notify someone who is NOT already ` +
      `mentioned in this thread's parent message, post a **new top-level ` +
      `channel message** (omit thread_ts) instead of hijacking this thread.`);
  } else {
    lines.push(`- **Thread TS**: (none - reply at channel top level)`);
    lines.push(``);
    lines.push(`**Reply routing rule:** No active thread - reply at channel ` +
      `top level. If a thread develops, continue replying in that thread.`);
  }

  lines.push(
    ``,
    `Use \`slack_send_message\` with \`channel="${routing.channelId}"\` ` +
      `and \`thread_ts="${routing.threadTs || ""}"\` to post in this thread.`,
  );

  return lines.join("\n");
}

/**
 * Build the full context string for injection into the agent prompt.
 * Combines session context + routing context.
 */
export function buildFullContextPrompt(
  ctx: SessionContextInfo,
  routing: RoutingContext,
): string {
  return [
    buildSessionContextPrompt(ctx),
    buildRoutingContextPrompt(routing),
  ].join("\n");
}

// ---- Helpers ----------------------------------------------------------------

/**
 * Resolve channel name from the directory, or fall back to the channel ID.
 */
export function resolveChannelName(
  profileId: string,
  channelId: string,
): string {
  return channelDirectory.resolveChannelName(profileId, channelId)
    ?? channelId;
}

/**
 * Build a SessionContextInfo from event details and session identity.
 */
export function buildSessionContext(
  identity: SessionIdentity,
  event: {
    channel: string;
    channel_name?: string;
    user_name?: string;
    user?: string;
    thread_ts?: string;
  },
  profileId: string,
  connectedProfiles: string[],
): SessionContextInfo {
  const channelName = resolveChannelName(profileId, event.channel);
  const channelType = event.thread_ts
    ? "thread"
    : channelDirectory.lookupChannelType(profileId, event.channel) ?? "channel";

  return {
    identity,
    channelName,
    channelType,
    userName: event.user_name || event.user || "unknown",
    connectedProfiles,
  };
}

/**
 * Build a RoutingContext from event details.
 */
export function buildRoutingContext(
  event: {
    channel: string;
    channel_name?: string;
    thread_ts?: string;
  },
  profileId: string,
  replyThreadTs?: string,
): RoutingContext {
  return {
    channelId: event.channel,
    threadTs: replyThreadTs,
    profileId,
    channelName: resolveChannelName(profileId, event.channel),
  };
}
