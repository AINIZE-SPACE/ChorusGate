// ============================================================
// Mention-format guard tests — bare/malformed mentions must be
// rejected so outbound Slack messages always use <@USER_ID> form.
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { findMentionIssues } from "../src/slack-message.js";

test("valid <@U...> mentions pass", () => {
  assert.deepEqual(findMentionIssues("hello <@U0B8VHLHJAX> world"), []);
  assert.deepEqual(findMentionIssues("Hi <@U0B91BVKTL2|小马>, please review"), []);
  assert.deepEqual(findMentionIssues("cc <@U0BGK82C2KV|小龙> and <@U0BAGFVD8VB>"), []);
});

test("bare @名字 is flagged", () => {
  const issues = findMentionIssues("请 @小克 处理");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /bare mention `@小克`/);
});

test("bare @latin name is flagged", () => {
  const issues = findMentionIssues("cc @hermes please");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /bare mention `@hermes`/);
});

test("bare mention at start of message is flagged", () => {
  const issues = findMentionIssues("@小马 看下这个 PR");
  assert.equal(issues.length, 1);
  assert.match(issues[0], /bare mention `@小马`/);
});

test("emails and links are not flagged", () => {
  assert.deepEqual(findMentionIssues("contact foo@bar.com for info"), []);
  assert.deepEqual(findMentionIssues("try <http://user@example.com|this link>"), []);
});

test("@here / @channel / @everyone special mentions are allowed", () => {
  assert.deepEqual(findMentionIssues("call @here and @channel and @everyone"), []);
});

test("malformed <@...> is flagged", () => {
  const issues = findMentionIssues("ping <@小马> please");
  assert.ok(issues.some((i) => /malformed mention/.test(i)));
});

test("multiple issues are all reported", () => {
  const issues = findMentionIssues("hi @小克, ask <@小马> and <@bob> to join");
  assert.ok(issues.some((i) => /bare mention `@小克`/.test(i)));
  assert.ok(issues.some((i) => /malformed mention `<@小马>`/.test(i)));
  assert.ok(issues.some((i) => /malformed mention `<@bob>`/.test(i)));
});
