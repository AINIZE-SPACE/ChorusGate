# STORY-8: Claude 双向 stream-json 控制面

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 里程碑：M2
> 日程提前：原 M4 审批循环提前，因发现 `--input-format stream-json` 支持双向 JSON 管道
> 跟踪: [#32](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/32)

## 发现

`claude -p` 支持双向 stream-json 协议：

```bash
claude -p --input-format stream-json --output-format stream-json --replay-user-messages
```

- `--input-format stream-json`：stdin 接受 JSON 消息（newline-delimited），**不关闭**
- `--output-format stream-json`：stdout 发出 JSON 事件（newline-delimited）
- `--replay-user-messages`：将 stdin 的用户消息回显到输出流

**不需要 Claude SDK npm 包。** 这是 `claude -p` 的内置能力。

## 协议

### stdin → claude（JSON 消息）

```jsonl
{"type":"user","message":{"role":"user","content":"帮我重构这个函数"}}
{"type":"approve","message":{"decision":"approve","toolName":"Bash","toolUseId":"toolu_xxx"}}
{"type":"approve","message":{"decision":"deny","toolName":"Bash","toolUseId":"toolu_yyy"}}
```

### stdout ← claude（JSON 事件）

```jsonl
{"type":"stream_event","event":{"type":"permission_request","tool":{"name":"Bash","id":"toolu_xxx","input":{"command":"rm -rf /"}}}}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"我来帮你..."}}}
{"type":"stream_event","event":{"type":"tool_use","tool":{"name":"Write","id":"toolu_zzz"}}}
{"type":"result","result":"重构完成"}
```

### 关键事件

| 事件 | 含义 | 处理 |
|------|------|------|
| `permission_request` | Claude 请求工具审批 | 暂停 stdout 消费 → Slack 发 interactive 按钮 → 等待用户点击 → stdin 回写 `approve`/`deny` → 继续消费 stdout |
| `content_block_delta` | 文本流增量 | 累积 + onProgress 更新 |
| `tool_use` | 工具调用开始 | onProgress 工具标签 |
| `result` | 本轮完成 | 获取最终文本，关闭 stdin |

## 实现

### ClaudeStreamProvider

```typescript
// 对比旧 ClaudeProvider
class ClaudeStreamProvider implements AgentProvider {
  id = "claude-stream";
  bin = "claude";

  async createSession(prompt, opts): Promise<SessionOutput> {
    // 1. spawn claude -p --input-format stream-json --output-format stream-json --replay-user-messages
    // 2. stdin.write('{"type":"user","message":{"role":"user","content":"<prompt>"}}\n')
    // 3. stdin 保持打开（不 close）
    // 4. 逐行消费 stdout JSONL
    // 5. 遇到 permission_request → onPermissionRequest 回调
    // 6. 等待 approve/deny 决策 → stdin.write(decision)
    // 7. 遇到 result → 返回
  }
}
```

### 审批循环

```
claude stdout: {"type":"stream_event","event":{"type":"permission_request",...}}
    ↓ gateway 拦截
chat.postMessage(channel, {
  text: "Claude 请求执行: rm -rf /",
  blocks: [Approve按钮, Deny按钮]
})
    ↓ 用户点击 Approve
block_actions 事件 → gateway
    ↓
claude stdin: {"type":"approve","message":{"decision":"approve",...}}
    ↓
claude stdout: 继续输出...
```

### 与旧 ClaudeProvider 的关系

| 维度 | 旧（单向 `-p`） | 新（双向 stream-json） |
|------|-----------------|----------------------|
| stdin | prompt 文本，一次性关闭 | JSON 消息，保持打开 |
| stdout | NDJSON stream | JSONL stream |
| approve/deny | ❌ | ✅ stdin 回写 |
| 协议 | 自定义 | Claude 官方 stream-json 协议 |
| 进度 | `assistant` + `tool_use` 事件 | `content_block_delta` + `tool_use` 事件 |

### 迁移策略

- Phase 1：新建 `ClaudeStreamProvider`，保持 `ClaudeProvider` 并存
- Phase 2：gateway 默认切到 `ClaudeStreamProvider`（`GATEWAY_CLAUDE_MODE=stream`）
- Phase 3：`ClaudeProvider` 标记 deprecated，后续移除

## 验收标准

- [ ] M0 spike: 真实运行 `claude -p --input-format stream-json --output-format stream-json` 1 轮
- [ ] stdin JSON 消息正确发送，stdout JSON 事件正确解析
- [ ] `permission_request` 事件触发审批回调
- [ ] stdin 回写 `approve`/`deny` 后 claude 继续执行
- [ ] `--replay-user-messages` 验证
- [ ] 与现有 `ClaudeProvider` 并存，gateway flag 切换
