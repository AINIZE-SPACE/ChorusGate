// ============================================================
// Tool: slack_list_channels — List channels the bot is a member of
// ============================================================

import type {
  ListChannelsInput,
  ListChannelsOutput,
  SlackChannelInfo,
} from "../types.js";
import { getWebClient } from "../slack-clients.js";
import { slackApiError } from "../tool-errors.js";

export const listChannelsTool = {
  name: "slack_list_channels",
  description:
    "List Slack channels the bot is a member of. " +
    "Returns channel IDs, names, and metadata.",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "number",
        description: "Max channels to return (default: 50, max: 1000)",
      },
      cursor: {
        type: "string",
        description:
          "Optional pagination cursor returned as next_cursor by a previous call",
      },
    },
  },
  async handler(input: ListChannelsInput): Promise<ListChannelsOutput> {
    const web = getWebClient();
    const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 1000);
    const channels: SlackChannelInfo[] = [];
    let cursor = input.cursor;

    while (channels.length < limit) {
      const pageLimit = Math.min(200, limit - channels.length);
      const result = await web.conversations.list({
        types: "public_channel,private_channel",
        limit: pageLimit,
        cursor,
        exclude_archived: true,
      });

      if (!result.ok) {
        throw slackApiError("Failed to list channels", result.error);
      }

      for (const ch of result.channels || []) {
        const channel = ch as Record<string, unknown>;
        channels.push({
          id: (channel.id as string) || "",
          name: (channel.name as string) || "",
          is_private: (channel.is_private as boolean) || false,
          topic:
            ((channel.topic as Record<string, unknown>)?.value as string) || "",
          num_members: (channel.num_members as number) || 0,
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }

    return {
      channels,
      ...(cursor ? { next_cursor: cursor } : {}),
    };
  },
};
