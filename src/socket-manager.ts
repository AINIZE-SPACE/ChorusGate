// ============================================================
// Socket Mode Connection Manager
// ============================================================

import { SocketModeClient } from "@slack/socket-mode";
import { LogLevel } from "@slack/socket-mode";
import { eventStore } from "./event-store.js";
import { getAppToken, getWebClient } from "./slack-clients.js";
import type { StoredEvent, SlackEventType } from "./types.js";

export type EventCallback = (event: StoredEvent) => void;

let socketClient: SocketModeClient | null = null;
let onEventCallback: EventCallback | null = null;

// Track our own bot user ID to filter out self-messages
let botUserId: string | null = null;

/**
 * Start the Socket Mode connection.
 * @param onEvent Called whenever a new Slack event is stored
 */
export async function startSocketMode(
  onEvent: EventCallback
): Promise<void> {
  const appToken = getAppToken();
  onEventCallback = onEvent;

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
    await ack();
    await handleSlackEvent("app_mention", event);
  });

  // message — any message in channels the bot is in
  socketClient.on("message", async ({ event, ack }) => {
    await ack();
    // Skip messages from our own bot
    if (botUserId && (event as Record<string, unknown>).user === botUserId) {
      return;
    }
    // Skip bot_message subtypes from other bots
    const subtype = (event as Record<string, unknown>).subtype as string | undefined;
    if (subtype === "bot_message") {
      return;
    }
    await handleSlackEvent("message", event);
  });

  // reaction_added — someone adds a reaction
  socketClient.on("reaction_added", async ({ event, ack }) => {
    await ack();
    await handleSlackEvent("reaction_added", event);
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

    // Build the stored event
    const stored = eventStore.push({
      type,
      subtype: evt.subtype as string | undefined,
      channel: (evt.channel as string) || "",
      user: (evt.user as string) || "",
      text: (evt.text as string) || "",
      ts: (evt.ts as string) || (evt.event_ts as string) || "",
      thread_ts: evt.thread_ts as string | undefined,
      reaction: evt.reaction as string | undefined,
      reaction_user: evt.user as string | undefined,
      reaction_item_channel: (evt.item as Record<string, unknown> | undefined)
        ?.channel as string | undefined,
      reaction_item_ts: (evt.item as Record<string, unknown> | undefined)
        ?.ts as string | undefined,
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
