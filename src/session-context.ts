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
  /** Home / notification channel ID (from env) */
  homeChannel?: { id: string; name: string };
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

  if (ctx.homeChannel && ctx.homeChannel.name !== ctx.channelName) {
    lines.push(`- **Home channel**: ${ctx.homeChannel.name} (${ctx.homeChannel.id})`);
  }

  return lines.join("\n");
}

/**
 * Build the async reply routing block for the system prompt.
 * Gives the agent the channel/thread IDs needed to send messages
 * asynchronously via MCP tools.
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
  } else {
    lines.push(`- **Thread TS**: (none — reply at channel top level)`);
  }

  lines.push(
    `- **Profile**: \`${routing.profileId}\``,
    `- **Channel name**: ${routing.channelName}`,
    ``,
    `Use \`slack_send_message\` with \`channel="${routing.channelId}"\` ` +
      `and \`thread_ts="${routing.threadTs || ""}"\` to post.`,
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

  const homeChannelId = process.env.GATEWAY_HOME_CHANNEL_ID;
  const homeChannelName = homeChannelId
    ? resolveChannelName(profileId, homeChannelId)
    : undefined;

  return {
    identity,
    channelName,
    channelType,
    userName: event.user_name || event.user || "unknown",
    connectedProfiles,
    homeChannel: homeChannelId && homeChannelName
      ? { id: homeChannelId, name: homeChannelName }
      : undefined,
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
