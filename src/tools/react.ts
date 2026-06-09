// ============================================================
// Tool: slack_add_reaction — Add an emoji reaction to a message
// ============================================================

import type { AddReactionInput, AddReactionOutput } from "../types.js";
import { getWebClient } from "../slack-clients.js";

export const addReactionTool = {
  name: "slack_add_reaction",
  description:
    "Add an emoji reaction to a Slack message. " +
    "Use the emoji name without colons (e.g. 'thumbsup', 'rocket', 'eyes').",
  inputSchema: {
    type: "object" as const,
    properties: {
      channel: {
        type: "string",
        description: "Channel ID where the message is",
      },
      timestamp: {
        type: "string",
        description: "Message timestamp to react to (the 'ts' field)",
      },
      name: {
        type: "string",
        description:
          "Emoji name without colons. " +
          "Examples: 'thumbsup', 'rocket', 'white_check_mark', 'eyes', 'smile'",
      },
    },
    required: ["channel", "timestamp", "name"],
  },
  async handler(input: AddReactionInput): Promise<AddReactionOutput> {
    const web = getWebClient();

    const result = await web.reactions.add({
      channel: input.channel,
      timestamp: input.timestamp,
      name: input.name,
    });

    if (!result.ok) {
      throw new Error(`Failed to add reaction: ${result.error}`);
    }

    return { ok: true };
  },
};
