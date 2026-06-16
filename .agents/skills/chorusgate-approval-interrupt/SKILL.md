---
name: chorusgate-approval-interrupt
description: ChorusGate 4-Button Approval and Interrupt Manager patterns. Use when implementing or reviewing agent permission requests, Slack interactive buttons, kill/interrupt flows, or cross-profile approval caching in src/gateway.ts.
---

# ChorusGate 审批与中断控制

> **一句话原则**: 审批请求必须绑定请求者身份、按钮响应后必须防重入、进程级中断必须 kill + 清理 timer。
>
> 来源: v3 STORY-8 M2 实现
> 跟踪: [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32) / [#57](https://github.com/AINIZE-SPACE/chorusgate/issues/57) / [#84](https://github.com/AINIZE-SPACE/chorusgate/issues/84)

## Trigger

当你需要以下任一操作时 load 本 skill：
- 修改 `src/gateway.ts` 的 block_actions / permission 处理
- 调整 `permissionTracker` 或 `buildApprovalBlocks`
- 修改 `InterruptManager` 或 `createStreamSession` 的中断逻辑
- 新增一种 agent 的批准协议（v4 Codex 双向批准 #84）

## 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `permissionTracker` | `src/permission-tracker.ts` | 4-scope 缓存：once / session / always / deny |
| `buildApprovalBlocks` | `src/slack-blocks.ts` | 4-Button Slack Block Kit UI |
| `socket-manager` block_actions handler | `src/socket-manager.ts` | 接收按钮点击，校验身份，回写响应 |
| `InterruptManager` | `src/interrupt-manager.ts` | busy-ack / kill / queue |

## 审批安全铁律

### 1. 身份绑定

`action_value` 必须编码 `requesterUserId`，gateway 在校验通过前不得 resolve promise。

```ts
// ✅ 正确：先校验，再 resolve
if (userId !== requesterUserId) {
  await ack(); // 可选：给出无权限提示
  return;
}
await resolve({ granted: true });
```

```ts
// ❌ 错误：先 resolve，后校验（P0-3 / #36）
resolve({ granted: true });
if (userId !== requesterUserId) return;
```

### 2. 防重入

按钮点击后，立即用 `chat.update` 把消息替换为确认文本，避免用户再次点击导致重复审批或状态混乱。

```ts
await client.chat.update({
  channel,
  ts: messageTs,
  text: `✅ 已批准 by <@${userId}>`,
  blocks: [], // 清空按钮
});
```

### 3. 跨 profile 隔离

approval cache key 必须包含 `profileId`，避免 profile A 的 "always" 授权泄漏到 profile B。

```ts
const cacheKey = `${profileId}:${requesterUserId}:${toolHash}`;
```

## Interrupt 铁律

### 1. 暴露 ChildProcess

provider 在 spawn 后必须通过 `onSpawn` 回调把 `ChildProcess` 交给 gateway。

```ts
// provider
opts.onSpawn?.(child);

// gateway
const child = await new Promise<ChildProcess>((resolve) => {
  opts.onSpawn = resolve;
});
interruptManager.register(sessionId, child);
```

### 2. kill + 清理 timer

进程退出时必须清理所有 timer，避免 untracked SIGKILL timer 造成内存泄漏。

```ts
child.on("exit", () => {
  clearTimeout(killTimer);
  clearInterval(heartbeatTimer);
});
```

### 3. queue 语义

用户在中断期间发送的新消息应入队，等当前 session 完全清理后再处理，而不是直接丢弃或并发执行。

## v4 待办：Codex 双向批准

Codex CLI 的 `--ask-for-approval=on-request` 使用 stdin/stdout 与用户交互。v4 需要：
1. M0 Spike：研究 Codex approval 的 stdin/stdout 协议
2. 实现 Codex approval parser，emit 与 Claude 同形的 permission request
3. gateway 复用现有 4-Button UI 与 `sendPermissionResponse`

## Quality Bar

- [ ] 审批 handler 有身份校验单元测试
- [ ] 按钮点击后有防重入测试（再次点击不触发二次 resolve）
- [ ] interrupt 有 timer 清理测试
- [ ] cross-profile approval cache 不共享

## 关联文件

- `src/permission-tracker.ts`
- `src/slack-blocks.ts`
- `src/socket-manager.ts`
- `src/interrupt-manager.ts`
- `src/providers/claude-stream.ts` — `createStreamSession` / `sendPermissionResponse`
- `docs/planning/v4-unified-approval.md`
