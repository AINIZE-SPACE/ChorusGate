// ============================================================
// Tool: slack_check_events — Get pending Slack events
// ============================================================

import type { CheckEventsInput, CheckEventsOutput } from "../types.js";
import { eventStore } from "../event-store.js";
import { enrichEvent } from "../socket-manager.js";

export const checkEventsTool = {
  name: "slack_check_events",
  description:
    "Check for pending (unhandled) Slack events received via Socket Mode. " +
    "Returns events that have not been marked as handled yet. " +
    "Use this to see what's waiting for your attention.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pending_only: {
        type: "boolean",
        description: "If true, only return unhandled events (default: true)",
      },
      limit: {
        type: "number",
        description: "Max events to return (default: 20, max: 100)",
      },
      type: {
        type: "string",
        enum: ["app_mention", "message", "reaction_added"],
        description: "Filter by event type",
      },
      channel: {
        type: "string",
        description: "Filter by channel ID",
      },
    },
  },
  async handler(input: CheckEventsInput): Promise<CheckEventsOutput> {
    const pendingOnly = input.pending_only ?? true;
    const limit = Math.min(input.limit ?? 20, 100);

    const events = pendingOnly
      ? eventStore.getPending(limit, input.type, input.channel)
      : eventStore.getRecent(limit, input.type, input.channel);

    // Enrich with names
    const enriched = await Promise.all(events.map((e) => enrichEvent(e)));

    return {
      events: enriched,
      total_pending: eventStore.countPending(),
      total_stored: eventStore.countTotal(),
    };
  },
};
