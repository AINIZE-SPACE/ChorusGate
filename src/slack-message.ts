import type { WebClient } from "@slack/web-api";

// #131: lowered from 3500 to 2900 to leave headroom for mrkdwn expansion
// (link_names, formatting, CJK UTF-8 byte overhead). Slack API text limit
// is 40000 chars, but chat.update has been observed to fail with msg_too_long
// at ~3500 chars in some edge cases.
export const SLACK_MESSAGE_CHUNK_LIMIT = 2900;

/**
 * Sanitize text for safe Slack delivery.
 * Removes problematic control chars, limits consecutive newlines,
 * and hard-truncates as a safety net.
 */
export function sanitizeForSlack(text: string, maxLen = 39000): string {
  // 1. Strip null bytes and control chars (except common whitespace)
  let out = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  // 2. Limit consecutive blank lines
  out = out.replace(/\n{4,}/g, "\n\n\n");
  // 3. Hard truncation safety net
  if (out.length > maxLen) {
    out = out.slice(0, maxLen) + "\n\n…(truncated)";
  }
  return out;
}

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
