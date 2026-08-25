// ============================================================
// shouldReply — auto-reply decision pipeline (extracted from gateway.ts)
// ============================================================

import type { StoredEvent } from "./types.js";
import type { ProfileTriggers } from "./profile-config.js";

/** Strip the leading <@BOTID> mention from text for a cleaner prompt. */
export function cleanText(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

/**
 * External hooks the gateway provides so this module stays side-effect free
 * (no Slack client, session store, or module-level gateway state):
 *  - myBotUserId: our own bot's Slack user ID, resolved from runtime auth
 *    (undefined until profiles start). Deliberately NOT a hardcoded list of
 *    teammate bots — colleagues join/leave; a fixed list would break.
 *  - triggers: display name + aliases for Level 3A name matching. Undefined
 *    (profile not loaded) → Level 3/4 are skipped.
 *  - isThreadParentBot / isActiveInThread / llmShouldReply: async/stateful
 *    checks owned by the gateway (web client, session store, LLM judge).
 */
export interface ShouldReplyContext {
  myBotUserId?: string;
  triggers?: ProfileTriggers;
  isThreadParentBot?: (threadTs: string, channel: string) => Promise<boolean>;
  isActiveInThread?: (channel: string, threadTs: string) => boolean;
  llmShouldReply?: (
    event: StoredEvent,
    triggers: ProfileTriggers,
  ) => Promise<boolean>;
}

/** Decide whether a stored event warrants an auto-reply.
 *
 * #128: Multi-level decision pipeline:
 *   Level 1 — hard filters (subtype, bot, empty)
 *   Level 2 — app_mention + DM (existing)
 *   Level 3 — Thread context (name match, parent-is-bot)
 *   Level 4 — LLM judgment (optional, env-gated)
 */
export async function shouldReply(
  event: StoredEvent,
  ctx: ShouldReplyContext,
): Promise<boolean> {
  // Level 1: Hard filters
  const subtype = event.subtype;
  const myBotUserId = ctx.myBotUserId;

  // Skip our own bot's messages (self-reply loop prevention). This is resolved
  // per-profile from runtime auth — a colleague's messages are NOT filtered
  // here; they reach the mention/thread decision below.
  if (
    event.user &&
    myBotUserId &&
    event.user === myBotUserId
  ) {
    return false;
  }
  // Skip edit/delete/broadcast etc. subtypes. `bot_message` is allowed through:
  // socket-manager already gates other-bot messages by an explicit <@us> mention.
  if (subtype && subtype !== "bot_message") return false;
  if (!event.user && subtype !== "bot_message") return false;
  if (!cleanText(event.text || "")) return false;

  // Level 2: Explicit mentions + DM
  if (event.type === "app_mention") return true;
  if (event.type === "message") {
    const channelType = (event.raw as Record<string, unknown> | undefined)
      ?.channel_type as string | undefined;
    if (channelType === "im") return true;
  }

  // #133 C1 (ALLOW_MENTION_EVERYONE, 写死非配置): a room-broadcast mention
  // (@everyone/@here/@channel) addresses the whole channel, so bots participate
  // too. Receive-side trigger — output-side findMentionIssues already tolerates
  // these for sending; this is the long-missing receive-side branch.
  if (hasSpecialBroadcastMention(event.text)) {
    return true;
  }

  // Level 3: Thread context smart reply
  if (process.env.GATEWAY_THREAD_SMART_REPLY !== "0") {
    const triggers = ctx.triggers;
    if (!triggers) return false;

    const text = event.text || "";

    // 3A: Name match — user mentioned our display name or aliases
    if (mentionsMyName(text, triggers)) return true;

    // 3B: Thread parent is our own message (user replied to us)
    const threadTs = event.thread_ts;
    if (threadTs && threadTs !== event.ts) {
      if (await ctx.isThreadParentBot?.(threadTs, event.channel)) {
        return true;
      }

      // 3C: Message doesn't mention any other entity, and it's in a
      //     thread we're participating in → likely relevant
      if (!mentionsOtherBot(text, myBotUserId)) {
        // Check if this thread has one of our sessions (meaning we're active in it)
        if (ctx.isActiveInThread?.(event.channel, threadTs)) {
          return true;
        }
      }
    }

    // Level 4: LLM judgment (optional, expensive — default off)
    if (
      process.env.GATEWAY_LLM_REPLY_JUDGE === "1" &&
      ctx.llmShouldReply
    ) {
      return await ctx.llmShouldReply(event, triggers);
    }
  }

  return false;
}

/**
 * Detect Slack special room-broadcast mentions: @everyone/@here/@channel.
 * These render in message text as <!everyone>, <!here>, <!channel>, each
 * optionally followed by a |label suffix (e.g. <!channel|@channel>). #133 C1.
 */
export function hasSpecialBroadcastMention(text?: string): boolean {
  if (!text) return false;
  return /<!(?:everyone|here|channel)(?=[|>])/i.test(text);
}

/** Check if text contains the bot's display name or aliases. */
function mentionsMyName(text: string, triggers: ProfileTriggers): boolean {
  const lower = text.toLowerCase();
  // Explicit Slack mention — lowercase the template too so the uppercase
  // <@USER_ID> in text matches the lowercased copy.
  if (
    triggers.botUserId !== "unknown" &&
    lower.includes(`<@${triggers.botUserId.toLowerCase()}>`)
  ) {
    return true;
  }
  // Name / alias match
  for (const word of [triggers.displayName, ...triggers.aliases]) {
    if (word && lower.includes(word.toLowerCase())) return true;
  }
  return false;
}

/** Check if text mentions any *other* entity besides our own bot — generic,
 *  no hardcoded per-person bot list. Any explicit `<@ID>` mention that is not
 *  our own bot user ID counts as addressing someone else.
 */
function mentionsOtherBot(text: string, myBotUserId?: string): boolean {
  if (!myBotUserId) return false;
  const mentions = [...text.matchAll(/<@([A-Z0-9]+)>/g)].map((m) => m[1]);
  return mentions.some((id) => id !== myBotUserId);
}
