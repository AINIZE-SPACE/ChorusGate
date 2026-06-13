// ============================================================
// Slack Socket Mode MCP Server — Main Entry Point
// ============================================================

import { bootstrap } from "./bootstrap.js";

bootstrap();

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
import { serializeToolError } from "./tool-errors.js";

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
    name: "chorusgate-mcp",
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
    const error = serializeToolError(err);
    console.error(
      `[chorusgate-mcp] Tool error (${name}/${error.code}):`,
      error.message
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ok: false, error }, null, 2),
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
  console.error(`[chorusgate-mcp] Subscribed to resource: ${uri}`);
  return {};
});

// --- resources/unsubscribe ---
server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  const uri = request.params.uri;
  subscriptions.delete(uri);
  console.error(`[chorusgate-mcp] Unsubscribed from resource: ${uri}`);
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

  console.error("[chorusgate-mcp] MCP Server ready (stdio)");

  // Sender-only mode: skip Socket Mode so this process does NOT open a second
  // event connection competing with a running gateway. The send/reply/history
  // tools still work (they're Web API calls), letting Claude Code proactively
  // act on Slack while the gateway owns the single event-receiving connection.
  if (process.env.MCP_SENDER_ONLY) {
    console.error(
      "[chorusgate-mcp] MCP_SENDER_ONLY set — skipping Socket Mode. " +
        "Send/reply/history tools work via Web API; check_events will be empty " +
        "(events go to the gateway's connection)."
    );
    return;
  }

  // Start Slack Socket Mode
  await startSocketMode(notifySubscribers);

  console.error("[chorusgate-mcp] Socket Mode started, listening for events...");
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.error("[chorusgate-mcp] Shutting down...");
  await stopSocketMode();
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[chorusgate-mcp] Fatal error:", (err as Error).message);
  process.exit(1);
});
