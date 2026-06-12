# STORY-2: Codex Provider 实现

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-1

## 问题

实现 `CodexProvider`，让 gateway 能 spawn `codex exec` 生成回复。

## 关键差异点

### Session ID 是"后发现"的

CC 模式：gateway 预生成 UUID → `--session-id <uuid>` → spawn → 回复。

Codex 模式：gateway spawn `codex exec <prompt>` → Codex 内部生成 `thread_xxx` → gateway 从 JSONL 输出第一行解析 `thread.id` → 回写 sessionStore。

**codex exec 的 JSONL 输出示例**（首次）：
```jsonl
{"type":"thread.started","thread":{"id":"thread_abc123","object":"thread"}}
{"type":"turn.started","turn":{"id":"turn_1"}}
{"type":"item.completed","item":{"id":"msg_123","content":[{"type":"output_text","text":"Hello world"}]}}
{"type":"turn.completed","turn":{"id":"turn_1","status":"completed"}}
{"type":"done","usage":{"input_tokens":100,"output_tokens":50}}
```

**session 续接** (resume)：
```bash
codex exec resume thread_abc123 --json --full-auto
```
注意：`resume` 是 `codex exec` 的**子命令**，不是 `codex` 的直接 flag。提示词在 resume 之后：
```bash
codex exec resume thread_abc123 "新的提示词" --json --full-auto
```

### 权限模式

| 场景 | CC flag | Codex flag |
|------|---------|------------|
| 全自动 | `--permission-mode bypassPermissions` | `--full-auto` |
| 审批 | `--permission-mode default` | （无 `--full-auto`） |

### MCP 配置格式

Codex 使用 TOML 格式的 `config.toml`，不是 JSON 的 `.mcp.json`。

```toml
[mcp_servers.slack]
command = "node"
args = ["E:\\path\\to\\slack-socket-mcp.mjs"]

[mcp_servers.slack.env]
MCP_SENDER_ONLY = "1"
SLACK_BOT_TOKEN = "xoxb-..."
SLACK_APP_TOKEN = "xapp-..."

# 关键：headless 模式必须设这个，否则 MCP 工具被自动取消
default_tools_approval_mode = "approve"
```

**社区踩坑**：不加 `default_tools_approval_mode = "approve"`，headless `codex exec` 遇到 MCP 工具调用时自动 cancel，视为"用户取消了 MCP 工具调用"。

### 环境变量

Codex 需要 `OPENAI_API_KEY`（或 ChatGPT 登录 token）。Gateway 需确保这个变量能传到 codex 子进程。

```env
OPENAI_API_KEY=sk-...
```

### 事件解析

```typescript
class CodexEventParser implements EventParser {
  private resultText = "";

  feed(line: string): void {
    const evt = JSON.parse(line);
    switch (evt.type) {
      case "thread.started":
        this.onSessionId?.(evt.thread.id);
        break;
      case "turn.started":
        this.onProgress?.("🤔 Codex 思考中…");
        break;
      case "item.completed":
        for (const block of evt.item.content || []) {
          if (block.type === "output_text") this.resultText += block.text;
          if (block.type === "tool_use") {
            this.onProgress?.(toolLabel(block.name));
          }
        }
        break;
      case "turn.completed":
        // 最终结果已收集完毕
        break;
    }
  }

  getResultText(): string { return this.resultText.trim(); }
}
```

## 验收标准

- [ ] `codex exec "say hello" --json --full-auto` 能正确 spawn，解析 `thread.id` 和输出文本
- [ ] `codex exec resume <tid> "reply" --json --full-auto` 能正确续接
- [ ] MCP config 生成 TOML 格式，含 `default_tools_approval_mode = "approve"`
- [ ] Codex 的 MCP 工具调用不被自动取消
- [ ] Codex 输出包含 Slack 工具调用（如 `slack_channel_history`）时正确显示进度标签
