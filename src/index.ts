// ============================================================
// Slack Socket Mode MCP Server — Main Entry Point
// ============================================================

// Load .env file before anything else
import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { StoredEvent } from "./types.js";
import { initSlackClients } from "./slack-clients.js";
import { startSocketMode, stopSocketMode, enrichEvent } from "./socket-manager.js";
import { eventStore } from "./event-store.js";

// --- Tools ---
import { checkEventsTool } from "./tools/check-events.js";
import { replyTool } from "./tools/reply.js";
import { sendMessageTool } from "./tools/send-message.js";
import { addReactionTool } from "./tools/react.js";
import { channelHistoryTool } from "./tools/channel-history.js";
import { threadRepliesTool } from "./tools/thread-replies.js";
import { listChannelsTool } from "./tools/list-channels.js";
import { getUserInfoTool } from "./tools/get-user.js";

// ============================================================
// Config & Validation
// ============================================================

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

if (!SLACK_BOT_TOKEN) {
  console.error(
    "[slack-socket-mcp] FATAL: SLACK_BOT_TOKEN environment variable is required"
  );
  process.exit(1);
}

if (!SLACK_APP_TOKEN) {
  console.error(
    "[slack-socket-mcp] FATAL: SLACK_APP_TOKEN environment variable is required"
  );
  process.exit(1);
}

// Validate token formats
if (!SLACK_BOT_TOKEN.startsWith("xoxb-")) {
  console.error(
    "[slack-socket-mcp] WARNING: SLACK_BOT_TOKEN should start with 'xoxb-'. " +
      "Got: " + SLACK_BOT_TOKEN.substring(0, 5) + "..."
  );
}
if (!SLACK_APP_TOKEN.startsWith("xapp-")) {
  console.error(
    "[slack-socket-mcp] WARNING: SLACK_APP_TOKEN should start with 'xapp-'. " +
      "Got: " + SLACK_APP_TOKEN.substring(0, 5) + "..."
  );
}

// Initialize Slack clients
initSlackClients({
  botToken: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
});

// ============================================================
// Tool Registry
// ============================================================

const tools = [
  checkEventsTool,
  replyTool,
  sendMessageTool,
  addReactionTool,
  channelHistoryTool,
  threadRepliesTool,
  listChannelsTool,
  getUserInfoTool,
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

// ============================================================
// Resource URIs
// ============================================================

const RESOURCE_STREAM = "slack://events/stream";
const RESOURCE_PENDING = "slack://events/pending";

// Track active subscriptions
const subscriptions = new Set<string>();

// ============================================================
// MCP Server Setup
// ============================================================

const server = new Server(
  {
    name: "slack-socket-mcp",
    version: "1.0.0",
    description:
      "Real-time Slack event bridge via Socket Mode. " +
      "Listens for app_mention, message, and reaction_added events. " +
      "Provides tools for reading and responding to Slack activity.",
  },
  {
    capabilities: {
      tools: {},
      resources: {
        subscribe: true,
        listChanged: true,
      },
    },
  }
);

// --- tools/list ---
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// --- tools/call ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolMap.get(name);

  if (!tool) {
    throw new Error(
      `Unknown tool: ${name}. Available tools: ${Array.from(toolMap.keys()).join(", ")}`
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.handler as any)(args ?? {});

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[slack-socket-mcp] Tool error (${name}):`, message);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: message }),
        },
      ],
      isError: true,
    };
  }
});

// --- resources/list ---
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: RESOURCE_STREAM,
      name: "Slack Event Stream",
      description:
        "Real-time stream of Slack events received via Socket Mode. " +
        "Events include app_mention, message, and reaction_added. " +
        "Subscribe to receive notifications when new events arrive.",
      mimeType: "application/json",
    },
    {
      uri: RESOURCE_PENDING,
      name: "Pending Slack Events",
      description:
        "Events that have not been handled/replied to yet. " +
        "Read this to see what needs attention.",
      mimeType: "application/json",
    },
  ],
}));

// --- resources/read ---
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  switch (uri) {
    case RESOURCE_STREAM: {
      const events = eventStore.getRecent(30);
      const enriched = await Promise.all(events.map((e) => enrichEvent(e)));
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ events: enriched, total: enriched.length }, null, 2),
          },
        ],
      };
    }

    case RESOURCE_PENDING: {
      const events = eventStore.getPending(50);
      const enriched = await Promise.all(events.map((e) => enrichEvent(e)));
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                events: enriched,
                total_pending: enriched.length,
                total_stored: eventStore.countTotal(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// --- resources/subscribe ---
server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  const uri = request.params.uri;
  subscriptions.add(uri);
  console.error(`[slack-socket-mcp] Subscribed to resource: ${uri}`);
  return {};
});

// --- resources/unsubscribe ---
server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  const uri = request.params.uri;
  subscriptions.delete(uri);
  console.error(`[slack-socket-mcp] Unsubscribed from resource: ${uri}`);
  return {};
});

// ============================================================
// Notify subscribers when new events arrive
// ============================================================

function notifySubscribers(_event: StoredEvent): void {
  // Notify for each subscribed resource URI
  for (const uri of subscriptions) {
    try {
      server.notification({
        method: "notifications/resources/updated",
        params: { uri },
      });
    } catch (err) {
      // Notification might fail if not connected — ignore
    }
  }
}

// ============================================================
// Startup
// ============================================================

async function main(): Promise<void> {
  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[slack-socket-mcp] MCP Server ready (stdio)");

  // Start Slack Socket Mode
  await startSocketMode(notifySubscribers);

  console.error("[slack-socket-mcp] Socket Mode started, listening for events...");
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.error("[slack-socket-mcp] Shutting down...");
  await stopSocketMode();
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[slack-socket-mcp] Fatal error:", (err as Error).message);
  process.exit(1);
});
