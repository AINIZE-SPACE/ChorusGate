<!-- ChorusGate Claude/Codex 流式执行统一方案 -->
# Claude vs Codex 非交互执行与流式能力整体方案

> 状态：🟡 设计稿 | 目的：回答“Codex `exec` 能否实现 Claude M3 同等功能”并给出统一抽象方案
> 基线文档：
> - [v3-story-8-claude-stream-json-m3.md](./v3-story-8-claude-stream-json-m3.md)
> - `src/providers/claude-stream.ts`、`src/providers/codex.ts`
> - Codex CLI v0.139.0+ `--help` 实测

## 1. 结论先行

**Codex `codex exec` 无法直接等价实现 Claude M3 的完整流式能力。**

- 不支持 `--output-format stream-json`、`--include-partial-messages`、`--include-hook-events`。
- `codex exec --json` 输出的是**回合级（turn-level）JSONL 事件**，不是 token 级增量。
- Extended Thinking / reasoning 只体现在最终 `turn.completed.usage.reasoning_output_tokens`，不暴露 reasoning 文本流。
- 但可以在 ChorusGate 内部做一层**统一抽象**：Claude 提供高保真增量，Codex 提供回合级降级增量，gateway 按需消费。

## 2. CLI 能力对比

| 能力 | Claude Code CLI (`claude -p`) | Codex CLI (`codex exec`) | 说明 |
|------|------------------------------|--------------------------|------|
| 非交互模式 | `-p` (print) | `exec` | 都已支持 |
| JSON/JSONL 输出 | `--output-format stream-json` / `--output-format json` | `--json` | Claude 是 NDJSON 事件流；Codex 是 JSONL 事件流 |
| token 级增量 | ✅ `--include-partial-messages` | ❌ 无 | Codex 无法逐 token 接收 |
| content block 事件 | ✅ `content_block_start/delta/stop` | ❌ 无 | Codex 事件模型不同 |
| Extended Thinking / reasoning 流 | ✅ `thinking_delta` | ⚠️ 仅有最终 `usage.reasoning_output_tokens` | 看不到 reasoning 过程文本 |
| Hook 生命周期事件 | ✅ `--include-hook-events` | ❌ 无对应参数 | Codex 只有 `--dangerously-bypass-hook-trust` |
| 模型选择 | ✅ `--model` | ✅ `-m/--model` | 双方都支持 |
| session 续接 | ✅ `--resume <id>` | ✅ `exec resume <id>` | 双方都支持 |
| 审批交互 | ✅ `permission_request` + stdin 回写 | ⚠️ 只能依赖 CLI 自带 `--ask-for-approval` | gateway 难以介入 |
| 成本指标 | ✅ `result.cost_usd` | ❌ 无 cost 字段 | Codex 只有 token 数 |
| 工具调用中间过程 | ✅ `content_block_delta.input_json_delta` | ⚠️ 只有 `item.completed` 最终结果 | Codex 工具参数不流式 |

## 3. Codex `exec` 逐项评估“上述功能”能否实现

### 3.1 实时打印思考过程（Extended Thinking）

- **Claude**：`--include-partial-messages` + `content_block_delta.thinking_delta` 可逐 token 捕获。
- **Codex**：不能。`codex exec --json` 只能拿到 `turn.completed.usage.reasoning_output_tokens`，无法获取 reasoning 文本。
- **结论**：Codex 端无法做“实时思考”展示；最多在最终展示“本次 thinking token 数”。

### 3.2 实时打印正文回复

- **Claude**：`content_block_delta.text_delta` 逐 token 更新。
- **Codex**：不能逐 token。但 `item.completed` 事件在单条 agent_message 完成时立即输出，可作为**粗粒度实时更新**。
- **结论**：Codex 能做到“消息完成即更新”，做不到“逐字打字机效果”。

### 3.3 Hook 生命周期事件

- **Claude**：`--include-hook-events` 直接输出 `hook_event`。
- **Codex**：无此能力。
- **结论**：Codex 端无法获取 Hook 事件，只能记录 `item.completed` 中 `tool_use` 的调用/结果。

### 3.4 成本与 Token 指标

- **Claude**：`result` 事件含 `cost_usd` / `input_tokens` / `output_tokens`。
- **Codex**：`turn.completed` 含 `usage`（`input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens`），**不含 cost**。
- **结论**：Codex 可展示 token 数，无法展示金额。

### 3.5 模型选择

- **Claude**：`--model <model>`。
- **Codex**：`-m/--model <model>`，也可通过 `-c model="o3"` 配置。
- **结论**：双方都支持，可统一由 `opts.model` 或环境变量透传。

## 4. 统一抽象层设计

在 `src/providers/types.ts` 中定义通用流式更新接口，让 gateway 不必关心底层是 Claude 还是 Codex。

```typescript
export type StreamUpdateKind =
  | "session_id"      // session/thread id 已确认
  | "progress"        // 粗粒度进度（如“思考中… / 工具调用中…”）
  | "block_start"     // 新 content block 开始（Claude）
  | "block_stop"      // content block 结束（Claude）
  | "text"            // 正文文本增量/片段
  | "thinking"        // thinking/reasoning 文本增量（Claude）
  | "tool_call"       // 工具调用开始或完成
  | "tool_param"      // 工具参数片段（Claude input_json_delta）
  | "hook"            // Hook 生命周期事件（Claude）
  | "metrics"         // cost/token 指标
  | "done";           // 流结束

export interface StreamUpdate {
  kind: StreamUpdateKind;
  payload: unknown;
  /** provider 来源，便于调试 */
  providerId?: string;
}
```

### 4.1 Claude 侧映射

| Claude 事件 | StreamUpdate |
|------------|--------------|
| `system/init` | `session_id` |
| `system/permission_request` | 仍走 M2 回调，不在流里暴露给用户 |
| `content_block_start(type=text)` | `block_start` |
| `content_block_delta.text_delta` | `text` |
| `content_block_start(type=thinking)` | `block_start` + `progress` |
| `content_block_delta.thinking_delta` | `thinking` |
| `content_block_delta.input_json_delta` | `tool_param` |
| `content_block_stop` | `block_stop` |
| `assistant` 中 `tool_use` | `tool_call` + `progress` |
| `hook_event` | `hook` |
| `result` | `metrics` + `done` |

### 4.2 Codex 侧映射

| Codex 事件 | StreamUpdate |
|-----------|--------------|
| `thread.started` | `session_id` |
| `turn.started` | `progress` ("🤔 Codex 思考中…") |
| `item.completed` + `agent_message.text` | `text` |
| `item.completed` + `tool_use` | `tool_call` + `progress` |
| `turn.completed` + `usage` | `metrics` |
| stream close | `done` |

> Codex 不生成 `thinking`、`block_start/stop`、`hook`、`tool_param` 等事件；gateway 消费时应按“可选存在”处理。

## 5. Codex Provider 改进建议

基于当前 `src/providers/codex.ts` 与 `codex-parser.ts`，做以下最小改动：

1. **解析 `turn.completed.usage`**
   - 提取 `input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens`。
   - 通过 `onMetrics` / `onStreamUpdate({ kind: "metrics" })` 暴露。

2. **把 `item.completed` 当“粗粒度 text 增量”**
   - 在解析到 `agent_message.text` 时，立即触发 `onStreamUpdate({ kind: "text", payload: text })`。
   - 这样 gateway 可以实时更新 Slack，虽然颗粒度比 Claude 大。

3. **支持 `--model`**
   - 当 `opts.model` 或 `process.env.CODEX_MODEL` 存在时，追加 `-m <model>` 或 `-c model="<model>"`。

4. **不追求 Hook 事件**
   - Codex 无此能力，不强行模拟；仅记录 `tool_use` 到日志。

5. **保留 `--json` 为主输出格式**
   - 继续用 `--json` 获取 JSONL。
   - 可额外用 `-o/--output-last-message` 作为最终文本兜底，但当前 `item.completed` 已足够。

## 6. Claude M3 设计回顾

Claude 侧继续按 [v3-story-8-claude-stream-json-m3.md](./v3-story-8-claude-stream-json-m3.md) 实施：

- 新增 `--include-partial-messages`、`--include-hook-events`、`--model`。
- 扩展 `ClaudeStreamParser` 处理 `content_block_*`、`hook_event`、`result` metrics。
- Gateway 按统一 `StreamUpdate` 消费。

## 7. Gateway 展示策略（统一）

Gateway 只关心 `StreamUpdate`，不感知 provider：

| Update | 展示行为 | 备注 |
|--------|---------|------|
| `progress` | 更新 Slack 消息顶部的状态文本 | 两方都可用 |
| `text` | 追加到正文 buffer，按防抖刷新 Slack | Claude 细粒度，Codex 粗粒度 |
| `thinking` | 若 `CLAUDE_SHOW_THINKING=true` 则折叠展示 | 仅 Claude |
| `tool_call` | 显示“🔧 调用 <tool>”进度 | 两方都可用 |
| `tool_param` | 默认不展示，可进 debug 日志 | 仅 Claude |
| `hook` | 默认不展示，可进 diagnostics | 仅 Claude |
| `metrics` | 最终消息末尾追加 token/cost 脚注 | Claude 全指标，Codex 仅 token |
| `done` | 结束流，刷新最终消息 | 两方都可用 |

这样设计的优点是：**Codex 用户看不到“思考块”，但仍能感受到实时进展和最终指标；Claude 用户获得完整体验。**

## 8. 实施任务清单

- [ ] 1. `src/providers/types.ts`：新增 `StreamUpdate`、`StreamUpdateKind`、`onStreamUpdate`。
- [ ] 2. `src/providers/claude-stream-parser.ts`：把新事件映射为 `StreamUpdate`。
- [ ] 3. `src/providers/claude-stream.ts`：根据环境变量追加 `--include-partial-messages` / `--include-hook-events` / `--model`。
- [ ] 4. `src/providers/codex-parser.ts`：
  - 解析 `turn.completed.usage`；
  - 在 `item.completed` 时触发 `text`/`tool_call` update；
  - 在 `thread.started` 时触发 `session_id` update。
- [ ] 5. `src/providers/codex.ts`：
  - 支持 `opts.model` / `CODEX_MODEL`；
  - 把 `onStreamUpdate` 绑定到 parser。
- [ ] 6. `src/reply-engine.ts` / `src/gateway.ts`：
  - 统一消费 `onStreamUpdate`；
  - 实现防抖刷新、thinking 展示、metrics 脚注。
- [ ] 7. 测试：
  - 新增 `codex-usage.jsonl` fixture；
  - 验证 Codex parser emits 正确的 `StreamUpdate`；
  - 验证 Claude parser emits 完整的 M3 update；
  - 验证 gateway 对缺失 kind 的降级处理。

## 9. 风险与兼容性

| 风险 | 影响 | 缓解 |
|------|------|------|
| Codex CLI JSONL schema 变化 | parser 崩溃 | 防御性解析：未知字段忽略、类型窄化 |
| Codex 无 cost 字段 | 无法展示金额 | 只展示 token；或后续通过 OpenAI API 单独计费 |
| Codex 无 thinking 文本 | 功能不对等 | 产品层面说明“Codex 仅显示 reasoning token 数” |
| Codex 审批不可接管 | 安全性受限 | 默认使用 `--dangerously-bypass-approvals-and-sandbox`，或未来改用 Codex 自带 `--ask-for-approval=on-request` |
| 统一抽象引入额外复杂度 | 维护成本 | 类型清晰、`kind` 枚举完备，单测覆盖降级路径 |

## 10. 总结

- **Claude `claude -p --output-format stream-json --include-partial-messages ...`** 可以做完整的 token 级流式、thinking、hook、cost 指标。
- **Codex `codex exec --json`** 做不到同等能力，但已提供足够的回合级事件（`thread.started`、`turn.started`、`item.completed`、`turn.completed`）来支撑一套**降级但可用的统一流式抽象**。
- 推荐在 ChorusGate 中引入 `StreamUpdate` 统一接口：Claude 高保真实现，Codex 降级实现，gateway 统一消费。
