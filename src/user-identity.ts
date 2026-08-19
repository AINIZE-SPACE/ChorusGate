// ============================================================
// user-identity — parse a raw Slack event's author identity
//
// Distinguishes humans from bots at the event layer. Slack sends
// bot messages with `subtype: "bot_message"` and a `bot_id`
// (B-prefixed); when the bot has a user identity it may also carry
// `user` / `bot_profile.id` (U-prefixed). Human messages carry only
// `user`. Every parsing code path must route through parseUser so
// downstream logic (tracking, handlers, notifications) can trust the
// result.
//
// 跟踪: #144 bot-to-bot message tracking (USER vs BOT identity)
// ============================================================

/** The two author kinds a Slack event can carry. */
export type UserType = "USER" | "BOT";

/**
 * Rich, downstream-usable author identity for a Slack event.
 *  - user_id: the actor's Slack user ID (U-prefixed). Present for
 *    humans and for bots that have a user identity.
 *  - user_type: "USER" | "BOT" — the discriminator consumers key on.
 *  - bot_id: the bot's ID (B-prefixed) — only present for bots.
 *  - is_bot: boolean convenience flag (user_type === "BOT").
 */
export interface ParsedUser {
  user_id?: string;
  user_type: UserType;
  bot_id?: string;
  is_bot: boolean;
}

/**
 * Parse a raw Slack event payload into a ParsedUser identity.
 * A message is treated as a bot when it carries a `bot_message`
 * subtype, a `bot_id`, or a `bot_profile` — any of which Slack only
 * sets for bot-authored messages. Everything else is a human.
 */
export function parseUser(rawEvent: unknown): ParsedUser {
  const evt = rawEvent as Record<string, unknown> | undefined;
  if (!evt) {
    return { user_type: "USER", is_bot: false };
  }

  const subtype =
    typeof evt.subtype === "string" ? (evt.subtype as string) : undefined;
  const botId =
    typeof evt.bot_id === "string" ? (evt.bot_id as string) : undefined;
  const botProfile = evt.bot_profile as Record<string, unknown> | undefined;
  const botUserId =
    typeof botProfile?.id === "string"
      ? (botProfile.id as string)
      : undefined;
  const userId = typeof evt.user === "string" ? (evt.user as string) : undefined;

  const isBot =
    subtype === "bot_message" || Boolean(botId) || Boolean(botUserId) ||
    Boolean(botProfile);

  return {
    user_id: userId || botUserId || undefined,
    user_type: isBot ? "BOT" : "USER",
    bot_id: botId || undefined,
    is_bot: isBot,
  };
}

/**
 * "Is this message from a bot?" — convenience helper over parseUser.
 * Accepts a raw Slack event payload, an already-parsed ParsedUser, or a
 * StoredEvent (whose is_bot / user_type fields are used directly).
 */
export function isBotMessage(rawEvent: unknown): boolean {
  if (rawEvent && typeof rawEvent === "object") {
    const maybe = rawEvent as Partial<ParsedUser>;
    if (typeof maybe.is_bot === "boolean") return maybe.is_bot;
    if (typeof maybe.user_type === "string") return maybe.user_type === "BOT";
  }
  return parseUser(rawEvent).is_bot;
}
