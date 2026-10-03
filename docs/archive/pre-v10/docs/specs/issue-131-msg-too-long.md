# Spec: #131 Codex 经常报 reply failed: msg_too_long

> **Issue**: [#131](https://github.com/AINIZE-SPACE/ChorusGate/issues/131)
> **Type**: Bug
> **Analyst**: 小马
> **Date**: 2026-07-17

## 1. 问题分析

### 1.1 症状

```
[gateway] reply result: ok=true textLen=2333 text=我会按"源文件审计 → 每源 SYNC_LOG → 概念覆盖审计 → GitHub 提单/通知"的顺序做...
[gateway] posting reply: placeholderTs=1782982197.585729 displayLen=2333
[gateway] reply failed: An API error occurred: msg_too_long
```

**关键矛盾**: `textLen=2333` 远小于 Slack 消息限制（40000 字符），但报 `msg_too_long`。

### 1.2 根因分析

**Slack `chat.update` API 的 msg_too_long 原因**:

1. **blocks 限制**: `chat.update` 如果消息有 blocks（结构化布局），每个 block 有独立限制。`text` 字段 2333 字符可能 OK，但如果 `chat.update` 带了其他 blocks 会超限。

2. **`chat.update` 覆盖了带 blocks 的 placeholder**: 看 gateway.ts L677-700：

```typescript
const replyChunks = splitSlackMessage(displayText);
if (placeholderTs) {
  // 覆盖 placeholder 消息
  await web.chat.update({
    channel: event.channel,
    ts: placeholderTs,
    text: replyChunks[0],  // 只传 text，没传 blocks
  });
  // 后续 chunks 作为新消息
  for (const chunk of replyChunks.slice(1)) {
    await web.chat.postMessage({ ... text: chunk });
  }
}
```

3. **实际根因**: `chat.update` 的参数缺少必要的字段。Slack `chat.update` API 在覆盖一条消息时，如果**原消息有 blocks 但 update 调用只传 text 不传 blocks**，在某些情况下会报错。但更可能的原因是：

**Slack API 对 `chat.postMessage` 和 `chat.update` 的 `text` 字段有不同的限制**：
- `chat.postMessage`: text 限制 40000 字符
- `chat.update`: text 限制也是 40000，但**如果 text 包含某些特殊字符或格式化标记**，Slack 内部解析后可能超限

**最终根因**: 检查 `splitSlackMessage` 分块逻辑（`slack-message.ts`）：

```typescript
export const SLACK_MESSAGE_CHUNK_LIMIT = 3500;
```

2333 < 3500，所以不会分块，单条发送。但 2333 字符的中文文本在某些情况下可能被 Slack 内部处理（如 mrkdwn 解析、link_names 展开）后膨胀。

**更可能的根因**: `link_names: true` 在 `chat.update` 时会把 `@username` 格式展开为 `<@U12345>` 格式，如果文本中有大量 mention，展开后可能超限。但 2333 字符即使展开也不太可能超限。

**最可能的根因**: `chat.update` 覆盖 placeholder 时，placeholder 原来可能有特殊的 blocks 或 metadata（如进度消息用了 blocks 格式），`chat.update` 只传 text 但不传 blocks 参数时，Slack API 内部处理可能冲突。但代码中 placeholder 创建只用了 `text: "⏳ 处理中…"`，没有 blocks。

### 1.3 深入排查

重新看日志顺序：
```
[gateway] reply result: ok=true textLen=2333   ← LLM 返回成功，2333 字符
[gateway] posting reply: placeholderTs=1782982197.585729 displayLen=2333  ← 开始发回复
[gateway] reply failed: An API error occurred: msg_too_long  ← 发送失败
```

**msg_too_long** 来自 `catch (err)` 块 (L709)。错误发生在 `chat.update` 或 `chat.postMessage`。

看 `splitSlackMessage` — limit=3500。2333 < 3500，所以 `replyChunks = [displayText]`（一块）。

然后执行：
```typescript
await web.chat.update({
  channel: event.channel,
  ts: placeholderTs,       // 更新 placeholder
  text: replyChunks[0],    // 2333 字符
});
```

**关键发现**: `chat.update` 调用**没有传 `link_names` 参数**！但 `postMessage` 有 `link_names: true`。

不对，`chat.update` 不支持 `link_names`。问题不在 link_names。

**真正原因**: Slack API 的 `chat.update` 方法的 `text` 参数限制与 `chat.postMessage` 不同。`chat.update` 的 text 参数在**包含格式化文本（如 markdown block、code block）**时，实际字节长度可能因 URL encoding 或内部处理而膨胀。中文文本每个字符 3 字节（UTF-8），2333 个中文字符 = ~7000 字节，可能在某些 API 层面超限。

**但更合理的解释**: 错误可能不是来自 `chat.update`，而是来自后续的 `chat.postMessage`。虽然 2333 < 3500（不分块），但如果 `displayText` 包含大量 `\n` 或特殊字符，Slack 内部处理可能超限。

### 1.4 结论

**根因**: Slack API `chat.update` 在某些条件下（可能与文本中的特殊字符、mrkdwn 格式化、或 API 版本差异有关）对 2333 字符的文本报 `msg_too_long`。需要：
1. 在 `chat.update` 和 `chat.postMessage` 前做**更保守的长度检查**
2. 对 `chat.update` 做错误恢复（fallback 到 `chat.postMessage`）
3. 降低 chunk limit 以留更多余量

## 2. 设计方案

### 2.1 降低 chunk limit + 增加安全边界

```typescript
// slack-message.ts
// 旧: 3500 — 太接近 API 限制，mrkdwn 展开后可能超限
// 新: 2900 — 留 600 字符余量给 link_names 展开 + 格式化
export const SLACK_MESSAGE_CHUNK_LIMIT = 2900;
```

### 2.2 chat.update 错误恢复

```typescript
// gateway.ts - 回复发送部分
const replyChunks = splitSlackMessage(displayText);
if (placeholderTs) {
  try {
    await web.chat.update({
      channel: event.channel,
      ts: placeholderTs,
      text: replyChunks[0],
    });
  } catch (updateErr) {
    console.error(
      `[gateway] chat.update failed (${updateErr}), falling back to postMessage`,
    );
    // fallback: 放弃更新 placeholder，直接发新消息
    await web.chat.postMessage({
      channel: event.channel,
      thread_ts: replyThreadTs,
      text: replyChunks[0],
      link_names: true,
    });
    // 尝试把 placeholder 更新为 "完成" 标记
    try {
      await web.chat.update({
        channel: event.channel,
        ts: placeholderTs,
        text: "✅",
      });
    } catch { /* ignore */ }
  }
  // 后续 chunks
  for (const chunk of replyChunks.slice(1)) {
    await web.chat.postMessage({
      channel: event.channel,
      thread_ts: replyThreadTs,
      text: chunk,
      link_names: true,
    });
  }
} else {
  for (const chunk of replyChunks) {
    await web.chat.postMessage({
      channel: event.channel,
      thread_ts: replyThreadTs,
      text: chunk,
      link_names: true,
    });
  }
}
```

### 2.3 文本预处理（可选）

在发送前对文本做安全处理：

```typescript
function sanitizeForSlack(text: string): string {
  // 1. 移除可能导致问题的 null bytes / 控制字符
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  // 2. 限制连续换行
  text = text.replace(/\n{4,}/g, "\n\n\n");
  // 3. 硬截断（安全网）
  if (text.length > 39000) {
    text = text.slice(0, 39000) + "\n\n…(truncated)";
  }
  return text;
}
```

### 2.4 验收标准

- [ ] `msg_too_long` 错误不再发生（通过降低 limit + fallback）
- [ ] `chat.update` 失败时自动 fallback 到 `postMessage`
- [ ] 长文本正确分块发送
- [ ] `npm run build` 通过

## 3. 优先级

**P1** - 影响用户体验，但已有 fallback 到 new session（#127 的 side effect），不是完全阻断。
