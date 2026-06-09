// ============================================================
// Tool: slack_channel_history — Get recent messages from a channel
// ============================================================

import type { ChannelHistoryInput, ChannelHistoryOutput, SlackMessageInfo } from "../types.js";
import { getWebClient } from "../slack-clients.js";

export const channelHistoryTool = {
  name: "slack_channel_history",
  description:
    "Get recent messages from a Slack channel. " +
    "Useful for catching up on context before replying.",
  inputSchema: {
    type: "object" as const,
    properties: {
      channel: {
        type: "string",
        description: "Channel ID (e.g. 'C123456')",
      },
      limit: {
        type: "number",
        description: "Max messages to return (default: 20, max: 200)",
      },
    },
    required: ["channel"],
  },
  async handler(input: ChannelHistoryInput): Promise<ChannelHistoryOutput> {
    const web = getWebClient();
    const limit = Math.min(input.limit ?? 20, 200);

    const result = await web.conversations.history({
      channel: input.channel,
      limit,
    });

    if (!result.ok) {
      throw new Error(`Failed to get channel history: ${result.error}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: SlackMessageInfo[] = (result.messages || []).map(
      (msg: any) => ({
        user: (msg.user as string) || "",
        text: (msg.text as string) || "",
        ts: (msg.ts as string) || "",
        thread_ts: msg.thread_ts as string | undefined,
        reply_count: msg.reply_count as number | undefined,
        subtype: msg.subtype as string | undefined,
      })
    );

    return {
      messages,
      channel: input.channel,
      has_more: result.has_more ?? false,
    };
  },
};
