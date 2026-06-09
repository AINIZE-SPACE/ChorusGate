// ============================================================
// Tool: slack_thread_replies — Get all replies in a message thread
// ============================================================

import type { ThreadRepliesInput, ThreadRepliesOutput, SlackMessageInfo } from "../types.js";
import { getWebClient } from "../slack-clients.js";

export const threadRepliesTool = {
  name: "slack_thread_replies",
  description:
    "Get all replies in a Slack message thread. " +
    "Useful for understanding the full context of a conversation.",
  inputSchema: {
    type: "object" as const,
    properties: {
      channel: {
        type: "string",
        description: "Channel ID where the thread is",
      },
      thread_ts: {
        type: "string",
        description:
          "The thread_ts (parent message timestamp) of the thread",
      },
    },
    required: ["channel", "thread_ts"],
  },
  async handler(input: ThreadRepliesInput): Promise<ThreadRepliesOutput> {
    const web = getWebClient();

    const result = await web.conversations.replies({
      channel: input.channel,
      ts: input.thread_ts,
    });

    if (!result.ok) {
      throw new Error(`Failed to get thread replies: ${result.error}`);
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
      thread_ts: input.thread_ts,
    };
  },
};
