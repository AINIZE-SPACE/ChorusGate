# STORY-8: Claude 双向 stream-json 控制面（SPEC）

> 状态：🟢 M2 核心已实现 (2026-06-13) | Epic: [v3 EPIC](./v3-epic.md) | M2 | P0
> 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34) | [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32)
> 分支: `feature/034-claude-stream-json`

## M0 Spike 实测 JSONL 格式（已捕获）

```jsonl
{"type":"system","subtype":"init","session_id":"a9a8feff-...","cwd":"...","model":"deepseek-v4-pro[1m]","tools":[...]}
{"type":"user","message":{"role":"user","content":"say hi"},"isReplay":true}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}
{"type":"result","subtype":"success","result":"Hi","duration_ms":...}
```

> :white_check_mark: M0 Spike 完成 (2026-06-13). `permission_request` 格式已从 Discord bridge 项目确认真实格式。
> 实测 fixture: `tests/fixtures/claude-stream-init.jsonl`（init/user/assistant/result 事件链路）
> 参考 fixture: `tests/fixtures/claude-stream-permission-request.jsonl`（含 permission_request 事件）
>
> **Spike 纠正了设计文档两处错误:**
> 1. permission_request 用 `request_id` 而非 `tool_use_id`
> 2. stdin 审批响应格式是 `{"type":"permission_response","request_id":"...","granted":true/false}` 而非 `{"type":"approve","decision":"approve","tool_use_id":"..."}`

## 实现方案

### ClaudeStreamProvider

```typescript
spawn("claude", [
  "-p",
  "--input-format", "stream-json",     // stdin JSON messages
  "--output-format", "stream-json",    // stdout JSON events
  "--verbose",                         // required for stream-json
  "--replay-user-messages",            // echo user messages
  "--permission-mode", "bypassPermissions",  // default, configurable
  "--mcp-config", senderMCPConfigPath,
  "--session-id", sessionId,
]);
// stdin stays open — don't close after writing prompt
// stdout parsed line-by-line for events
```

### 审批流（M0 Spike 已确认格式）

```
stdout: {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","id":"toolu_xxx",...}]}}
  ↓ 如果是需要审批的工具
stdout: {"type":"system","subtype":"permission_request","request_id":"req_abc123","tool_name":"Bash","tool_input":{"command":"rm -rf dist/"},"session_id":"..."}
  ↓ gateway 拦截 → parser 触发 onPermissionRequest 回调
Slack: chat.postMessage(interactive blocks: Approve / Deny)
  ↓ 用户点击
Slack block_actions → gateway
  ↓ 写回 stdin
stdin: {"type":"permission_response","request_id":"req_abc123","granted":true}
  ↓ or
stdin: {"type":"permission_response","request_id":"req_abc123","granted":false}
```

**关键纠正:**
- `permission_request` 使用 `request_id`（不是 `tool_use_id`）
- stdin 响应格式是 `{"type":"permission_response","request_id":"...","granted":true/false}`
- `assistant` 事件中的 `tool_use.id` 可与 `permission_request.request_id` 关联（但不相同）

## 实现清单

- [x] M0 Spike fixture: `tests/fixtures/claude-stream-init.jsonl`, `claude-stream-permission-request.jsonl`
- [x] `src/providers/claude-stream-parser.ts` — 扩展 ClaudeEventParser，新增:
  - `system/subtype:init` → 记录 session_id / model / tools
  - `system/subtype:permission_request` → 触发 `onPermissionRequest` 回调
  - `system/subtype:api_retry` → 日志记录
  - `user` (isReplay) → 跳过或记录
- [x] `src/providers/claude-stream.ts` — ClaudeStreamProvider:
  - spawn `claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages`
  - **stdin 保持打开**（不调用 `child.stdin.end()`）
  - 提供 `sendPermissionResponse(requestId, granted)` 方法写 stdin
  - 返回 `ClaudeStreamSession` 对象（含 stdin 写入能力 + stdout 事件流）
- [x] `src/reply-engine.ts` — `generateReplyStream()` + `GATEWAY_CLAUDE_MODE=stream` 切换
- [x] `src/gateway.ts` — `INTERACTIVE_PERMISSIONS` 模式 + block_actions 审批按钮
- [x] `src/permission-tracker.ts` — 审批请求追踪（Promise-based, Slack block_actions → stdin）
- [x] `src/socket-manager.ts` — `block_actions` (interactive) 事件支持
- [x] 测试: 21/21 通过 (7 parser + 3 session + 7 tracker + 2 event-store + 2 session-store)

## 验收标准

- [x] `ClaudeStreamProvider` spawn 正确，stdin 保持打开
- [x] stdout JSONL 正确解析（assistant、result、permission_request）
- [x] `sendPermissionResponse()` 写回 stdin（格式: `{"type":"permission_response","request_id":"...","granted":true/false}`）
- [x] 与旧 `ClaudeProvider` 并存，flag 切换
- [x] gateway 行为向后兼容（`INTERACTIVE_PERMISSIONS` 默认关闭，需显式配置 `CLAUDE_PERMISSION_MODE`）
