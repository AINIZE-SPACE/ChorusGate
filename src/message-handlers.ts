// ============================================================
// message-handlers — bot/human message dispatch + config knob
//
// #144: mechanism for tracking bot-to-bot messages. Once an event's
// author identity is parsed (src/user-identity.ts), this module
// dispatches it to a bot handler or a human handler so callers can
// attach custom logic (e.g. special notifications) without touching
// the parsing or reply-decision pipelines.
//
// The config knob GATEWAY_BOT_MESSAGE_HANDLING ("0" to disable)
// turns the whole handling/notification layer off. Parsing itself
// (user_type / is_bot / bot_id on StoredEvent) is unconditional —
// it is the identity layer every other requirement builds on.
// ============================================================

import type { StoredEvent } from "./types.js";
import type { ParsedUser } from "./user-identity.js";

/** A profile-aware context the handler may use for custom logic. */
export interface MessageHandlerContext {
  /** Slack profile (app) id the event arrived on. */
  profileId: string;
}

/** Custom logic hooks for bot / human messages. */
export interface MessageHandlerHooks {
  /** Called for every message whose author is a bot. */
  onBotMessage?: (
    event: StoredEvent,
    user: ParsedUser,
    ctx: MessageHandlerContext,
  ) => Promise<void> | void;
  /** Called for every message whose author is a human. */
  onHumanMessage?: (
    event: StoredEvent,
    user: ParsedUser,
    ctx: MessageHandlerContext,
  ) => Promise<void> | void;
}

/** Default hooks: structured logging. Override to attach real behavior
 *  (e.g. special notifications) — see gateway.ts for the wiring point. */
export const defaultMessageHandlerHooks: MessageHandlerHooks = {
  onBotMessage: (event, user, ctx) => {
    console.error(
      `[message-handlers] bot message — ${ctx.profileId} from ` +
        `${user.user_id ?? user.bot_id ?? "?"} (bot ${user.bot_id ?? "?"}) ` +
        `in ${event.channel}: "${(event.text ?? "").slice(0, 80)}"`,
    );
  },
  onHumanMessage: (event, user, ctx) => {
    console.error(
      `[message-handlers] human message — ${ctx.profileId} from ` +
        `${user.user_id ?? "?"} in ${event.channel}`,
    );
  },
};

/**
 * Config knob: is the bot-message handling/tracking feature enabled?
 * Default ON. Set GATEWAY_BOT_MESSAGE_HANDLING=0 to disable (old
 * behavior — no handler dispatch, no special notifications).
 * Read at call time so tests can toggle it per-case.
 */
export function botMessageHandlingEnabled(): boolean {
  return process.env.GATEWAY_BOT_MESSAGE_HANDLING !== "0";
}

/**
 * Dispatch a stored event to the bot or human handler hook based on
 * its parsed author identity. Returns whatever the hook returns.
 * When the feature knob is off, this is a no-op.
 */
export function dispatchMessageHandler(
  hooks: MessageHandlerHooks,
  event: StoredEvent,
  user: ParsedUser,
  profileId: string,
): Promise<void> | void {
  if (!botMessageHandlingEnabled()) return;
  const ctx: MessageHandlerContext = { profileId };
  if (user.is_bot) {
    return hooks.onBotMessage?.(event, user, ctx);
  }
  return hooks.onHumanMessage?.(event, user, ctx);
}
