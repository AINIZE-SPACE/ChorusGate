## 问题
commit `6dc97bd fix(slack): add link_names:true to all chat.postMessage calls for mention notification` 的 commit message 明确说"所有 chat.postMessage 统一加 link_names:true"，但**遗漏了 `src/tools/reply.ts:42`**。

全仓 `chat.postMessage` 调用点扫描：
```
src/gateway.ts:495           ← 已加 ✓
src/gateway.ts:583           ← 已加 ✓
src/gateway.ts:629           ← 已加 ✓
src/gateway.ts:668           ← 已加 ✓
src/gateway.ts:695           ← 已加 ✓
src/interrupt.ts:139         ← 已加 ✓
src/session-commands.ts:129  ← 已加 ✓
src/tools/send-message.ts:40 ← 已加 ✓
src/tools/reply.ts:42        ← ❌ 漏了
```

## 现状（src/tools/reply.ts:38-46）
```typescript
const result = await web.chat.postMessage({
  channel: input.channel,
  thread_ts: input.thread_ts,
  text: input.text,
});
```

## 影响
- **同 #59 症状**：`slack_reply` 是 Claude Code 在 Slack 线程中回复用户的主要工具（`src/index.ts:17,32` 注册为 MCP tool）。Claude Code 通过 `slack_reply` 发送 `<@USER_ID>` 格式的 mention 时（如 @ 小马 / @ 小克 求助），对方**收不到推送通知**。
- 用户体验：对话中 Claude 提到 `@小克` 看一眼，但小克手机不响，必须打开 Slack 客户端主动看。问题与 #59 报告完全一致。
- 隐蔽性强：只有提到人才触发，普通对话看不到。

## 修法
在 `src/tools/reply.ts:38-46` 的 `chat.postMessage` 调用中加 `link_names: true`：

```diff
 const result = await web.chat.postMessage({
   channel: input.channel,
   thread_ts: input.thread_ts,
   text: input.text,
+  link_names: true,
 });
```

## 验收
- `grep -n "link_names" src/tools/reply.ts` → 1 处
- `grep -rn "chat.postMessage" src/ --include=*.ts | wc -l` = `grep -rn "link_names" src/ --include=*.ts | wc -l`（数量一致）
- 新增 `tests/slack-reply-link-names.test.ts` 验证 `web.chat.postMessage` 被传入 `{ link_names: true }`

## 关联
- Bug: #59 (Mention 通知 — 主路径)
- Commit: `6dc97bd`
- PR: #53
- REVIEW: `docs/tests/REVIEW-MentionNotification-2026-06-14-xiaoma.md`
