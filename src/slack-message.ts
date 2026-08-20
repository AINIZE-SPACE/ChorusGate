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

/**
 * Validate Slack mention formatting on outbound messages.
 *
 * Slack user mentions MUST use the angle-bracket ID form `<@U0B8VHLHJAX>`
 * (optionally `<@U0B8VHLHJAX|小克>`). A bare `@名字` / `@name` does not
 * reliably resolve, and a malformed `<@...>` posts a broken token — both
 * were a recurring team failure (iteration 2). Returns a list of
 * human-readable problems ([] when the text is clean).
 *
 * Excluded by design: emails (`user@host`) since `@` is preceded by a word
 * char; special `<mailto:...>` links; and `@here` / `@channel` which are
 * valid Slack syntax and render correctly.
 */
export function findMentionIssues(text: string): string[] {
  const issues: string[] = [];

  // 1) Any `<@...>` present must wrap a valid user ID (U-prefixed).
  const angleRe = /<@([^>]*)>/g;
  let am: RegExpExecArray | null;
  while ((am = angleRe.exec(text)) !== null) {
    const inner = am[1];
    const valid = /^U[A-Z0-9]+(\|[^<>\n]{0,80})?$/.test(inner);
    if (!valid) {
      issues.push(
        `malformed mention \`${am[0]}\` — use \`<@USER_ID>\` in angle brackets (e.g. \`<@U0B8VHLHJAX>\`)`,
      );
    }
  }

  // 2) A bare `@...` outside `<...>` that looks like a person mention:
  //    directly after whitespace / open brackets / CJK punctuation / start.
  //    Emails are excluded because they require a word char before `@`.
  const bareRe =
    /(^|[\s([{【（｛，。！？；])@(here|channel|everyone|[A-Za-z0-9_一-龥]{1,40})/gi;
  let bm: RegExpExecArray | null;
  while ((bm = bareRe.exec(text)) !== null) {
    const token = bm[2];
    // @here / @channel / @everyone are valid Slack special mentions.
    if (/^(here|channel|everyone)$/i.test(token)) continue;
    issues.push(
      `bare mention \`@${token}\` — wrap it as \`<@USER_ID>\` in angle brackets (e.g. \`<@U0B8VHLHJAX>\`)`,
    );
  }

  return issues;
}

export async function postSlackMessageChunks(
  web: WebClient,
  args: { channel: string; text: string; thread_ts?: string },
) {
  // Interceptor: refuse to send if any mention is not in <@USER_ID> form.
  const mentionIssues = findMentionIssues(args.text);
  if (mentionIssues.length > 0) {
    throw new Error(
      "Refusing to send — invalid Slack mention format(s):\n" +
        mentionIssues.map((i) => `• ${i}`).join("\n"),
    );
  }

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
