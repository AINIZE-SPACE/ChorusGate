// ============================================================
// Socket Mode Connection Manager
// ============================================================

import { SocketModeClient } from "@slack/socket-mode";
import { LogLevel } from "@slack/socket-mode";
import { eventStore } from "./event-store.js";
import { getAppToken, getWebClient } from "./slack-clients.js";
import type { StoredEvent, SlackEventType } from "./types.js";

export type EventCallback = (event: StoredEvent) => void;

/** A Slack slash command received over Socket Mode. */
export interface SlashCommand {
  command: string; // e.g. "/cc_sessions"
  text: string; // args after the command
  channelId: string;
  userId: string;
  userName?: string;
}
export type SlashCallback = (cmd: SlashCommand) => void | Promise<void>;

/** A block_actions interaction (e.g. Approve/Deny button click). */
export interface BlockAction {
  type: "block_actions";
  channelId: string;
  userId: string;
  /** The value field from the button's block element */
  actionValue: string;
  /** The action_id of the clicked button */
  actionId: string;
  /** The ts of the interactive message */
  messageTs: string;
}
export type BlockActionCallback = (action: BlockAction) => void | Promise<void>;

let socketClient: SocketModeClient | null = null;
let onEventCallback: EventCallback | null = null;
let onSlashCallback: SlashCallback | null = null;
let onBlockActionCallback: BlockActionCallback | null = null;

// Track our own bot user ID to filter out self-messages
let botUserId: string | null = null;

/**
 * Start the Socket Mode connection.
 * @param onEvent Called whenever a new Slack event is stored
 * @param onSlash Called when a slash command arrives (optional)
 */
export async function startSocketMode(
  onEvent: EventCallback,
  onSlash?: SlashCallback,
  onBlockAction?: BlockActionCallback,
): Promise<void> {
  const appToken = getAppToken();
  onEventCallback = onEvent;
  onSlashCallback = onSlash ?? null;
  onBlockActionCallback = onBlockAction ?? null;

  // Resolve our own bot user ID to filter self-messages
  try {
    const web = getWebClient();
    const auth = await web.auth.test();
    botUserId = auth.user_id ?? null;
    console.error(
      `[slack-socket-mcp] Bot user ID: ${botUserId}`
    );
  } catch (err) {
    console.error(
      "[slack-socket-mcp] Failed to resolve bot user ID, " +
        "self-message filtering disabled:",
      (err as Error).message
    );
  }

  socketClient = new SocketModeClient({
    appToken,
    logLevel: LogLevel.INFO,
  });

  // --- Connection lifecycle events ---
  socketClient.on("connecting", () => {
    console.error("[slack-socket-mcp] Connecting to Slack via Socket Mode...");
  });

  socketClient.on("connected", () => {
    console.error("[slack-socket-mcp] Socket Mode connected");
  });

  socketClient.on("ready", () => {
    console.error("[slack-socket-mcp] Socket Mode ready, listening for events");
  });

  socketClient.on("disconnecting", () => {
    console.error("[slack-socket-mcp] Socket Mode disconnecting...");
  });

  socketClient.on("reconnecting", () => {
    console.error("[slack-socket-mcp] Socket Mode reconnecting...");
  });

  socketClient.on("error", (error) => {
    console.error("[slack-socket-mcp] Socket Mode error:", (error as Error).message);
  });

  // --- Slack Event Handlers ---

  // app_mention — someone @mentions the bot
  socketClient.on("app_mention", async ({ event, ack }) => {
    // Enqueue BEFORE ack, so a crash between the two doesn't lose the event
    // (ack tells Slack "got it"; we want it recorded first).
    await handleSlackEvent("app_mention", event);
    await ack();
  });

  // message — any message in channels the bot is in
  socketClient.on("message", async ({ event, ack }) => {
    // Skip messages from our own bot
    if (botUserId && (event as Record<string, unknown>).user === botUserId) {
      await ack();
      return;
    }
    // Skip bot_message subtypes from other bots
    const subtype = (event as Record<string, unknown>).subtype as string | undefined;
    if (subtype === "bot_message") {
      await ack();
      return;
    }
    await handleSlackEvent("message", event);
    await ack();
  });

  // reaction_added — someone adds a reaction
  socketClient.on("reaction_added", async ({ event, ack }) => {
    await handleSlackEvent("reaction_added", event);
    await ack();
  });

  // slash_commands — native Slack slash commands (registered in manifest)
  // Slash commands need ack() within 3 seconds. We ack empty (no visible
  // intermediate message) and let the command handler post the real response.
  socketClient.on("slash_commands", async ({ body, ack }) => {
    await ack();
    if (onSlashCallback) {
      const cmd: SlashCommand = {
        command: (body.command as string) || "",
        text: ((body.text as string) || "").trim(),
        channelId: (body.channel_id as string) || "",
        userId: (body.user_id as string) || "",
        userName: (body.user_name as string) || undefined,
      };
      try {
        await onSlashCallback(cmd);
      } catch (err) {
        console.error(
          "[slack-socket-mcp] slash command handler error:",
          (err as Error).message
        );
      }
    }
  });

  // block_actions — interactive message button clicks (e.g. Approve/Deny)
  socketClient.on("interactive", async ({ body, ack }) => {
    const payload = body as Record<string, unknown>;
    if (payload.type !== "block_actions") {
      await ack();
      return;
    }
    await ack(); // ack immediately — 3s timeout
    if (!onBlockActionCallback) return;

    const actions = payload.actions as Array<Record<string, unknown>> | undefined;
    if (!actions || actions.length === 0) return;

    for (const action of actions) {
      const ch = payload.channel as Record<string, unknown> | undefined;
      const usr = payload.user as Record<string, unknown> | undefined;
      const msg = payload.message as Record<string, unknown> | undefined;
      const container = payload.container as Record<string, unknown> | undefined;
      const blockAction: BlockAction = {
        type: "block_actions",
        channelId: ((ch?.id || payload.channel_id || "") as string),
        userId: ((usr?.id || payload.user_id || "") as string),
        actionValue: (action.value as string) || "",
        actionId: (action.action_id as string) || "",
        messageTs: ((msg?.ts || container?.message_ts || "") as string),
      };
      try {
        await onBlockActionCallback(blockAction);
      } catch (err) {
        console.error(
          "[slack-socket-mcp] block_action handler error:",
          (err as Error).message,
        );
      }
    }
  });

  await socketClient.start();
}

/**
 * Stop the Socket Mode connection
 */
export async function stopSocketMode(): Promise<void> {
  if (socketClient) {
    await socketClient.disconnect();
    socketClient = null;
  }
}

/**
 * Convert a raw Slack event into a StoredEvent and push to the store
 */
async function handleSlackEvent(
  type: SlackEventType,
  rawEvent: unknown
): Promise<void> {
  try {
    const evt = rawEvent as Record<string, unknown>;
    const item = evt.item as Record<string, unknown> | undefined;

    // Build the stored event. For reaction_added, the channel lives on
    // evt.item.channel (evt.channel is empty for reactions).
    const stored = eventStore.push({
      type,
      subtype: evt.subtype as string | undefined,
      channel:
        (evt.channel as string) || (item?.channel as string) || "",
      user: (evt.user as string) || "",
      text: (evt.text as string) || "",
      ts: (evt.ts as string) || (evt.event_ts as string) || "",
      thread_ts: evt.thread_ts as string | undefined,
      reaction: evt.reaction as string | undefined,
      reaction_user: evt.user as string | undefined,
      reaction_item_channel: item?.channel as string | undefined,
      reaction_item_ts: item?.ts as string | undefined,
      user_name: undefined,
      channel_name: undefined,
      raw: rawEvent,
    });

    console.error(
      `[slack-socket-mcp] Event stored: ${stored.type} ` +
        `from ${stored.user} in ${stored.channel} (id: ${stored.id})`
    );

    // Notify the MCP layer
    if (onEventCallback) {
      onEventCallback(stored);
    }
  } catch (err) {
    console.error(
      "[slack-socket-mcp] Error handling event:",
      (err as Error).message
    );
  }
}

/**
 * Enrich stored events with user/channel names
 */
export async function enrichEvent(event: StoredEvent): Promise<StoredEvent> {
  const web = getWebClient();

  // Resolve channel name
  if (event.channel && !event.channel_name) {
    try {
      const info = await web.conversations.info({ channel: event.channel });
      if (info.channel) {
        event.channel_name =
          (info.channel as Record<string, unknown>).name as string | undefined;
      }
    } catch {
      // Channel info not available (maybe private, maybe DM)
    }
  }

  // Resolve user name
  if (event.user && !event.user_name) {
    try {
      const info = await web.users.info({ user: event.user });
      if (info.user) {
        event.user_name =
          (info.user as Record<string, unknown>).real_name as
            | string
            | undefined;
      }
    } catch {
      // User info not available
    }
  }

  return event;
}
