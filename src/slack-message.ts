import type { WebClient } from "@slack/web-api";

export const SLACK_MESSAGE_CHUNK_LIMIT = 3500;

export function splitSlackMessage(
  text: string,
  limit = SLACK_MESSAGE_CHUNK_LIMIT,
): string[] {
  if (limit <= 0) throw new Error("Slack message chunk limit must be positive");
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < Math.floor(limit / 2)) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt <= 0) splitAt = limit;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt);
    if (remaining.startsWith("\n") || remaining.startsWith(" ")) {
      remaining = remaining.slice(1);
    }
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export async function postSlackMessageChunks(
  web: WebClient,
  args: { channel: string; text: string; thread_ts?: string },
) {
  const results = [];
  for (const chunk of splitSlackMessage(args.text)) {
    results.push(await web.chat.postMessage({
      channel: args.channel,
      text: chunk,
      ...(args.thread_ts ? { thread_ts: args.thread_ts } : {}),
      link_names: true,
    }));
  }
  return results;
}
