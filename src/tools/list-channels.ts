// ============================================================
// Tool: slack_list_channels — List channels the bot is a member of
// ============================================================

import type { ListChannelsInput, ListChannelsOutput, SlackChannelInfo } from "../types.js";
import { getWebClient } from "../slack-clients.js";

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
        description: "Max channels to return (default: 50)",
      },
    },
  },
  async handler(input: ListChannelsInput): Promise<ListChannelsOutput> {
    const web = getWebClient();
    const limit = input.limit ?? 50;

    const result = await web.conversations.list({
      types: "public_channel,private_channel",
      limit,
      exclude_archived: true,
    });

    if (!result.ok) {
      throw new Error(`Failed to list channels: ${result.error}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channels: SlackChannelInfo[] = (result.channels || []).map(
      (ch: any) => ({
        id: (ch.id as string) || "",
        name: (ch.name as string) || "",
        is_private: (ch.is_private as boolean) || false,
        topic: ((ch.topic as Record<string, unknown>)?.value as string) || "",
        num_members: (ch.num_members as number) || 0,
      })
    );

    return { channels };
  },
};
