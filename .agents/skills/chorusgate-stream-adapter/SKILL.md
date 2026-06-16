---
name: chorusgate-stream-adapter
description: ChorusGate multi-agent stream adapter design. Use when adding a new AI agent runtime, unifying real-time updates across Claude Code and Codex, or reviewing provider/parser abstraction in src/providers.
---

# ChorusGate 多 Agent 流式适配器

> **一句话原则**: 用统一的 `StreamUpdate` 接口屏蔽不同 agent runtime 的事件差异；gateway 只消费 `StreamUpdate`，不感知底层是 Claude 还是 Codex。
>
> 来源: v3 STORY-8 设计文档 `docs/planning/v3-story-8-claude-codex-streaming-codex.md`
> 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34) / [#86](https://github.com/AINIZE-SPACE/chorusgate/issues/86)

## Trigger

当你需要以下任一操作时 load 本 skill：
- 新增一种 agent runtime（如 OpenClaw、Gemini CLI）
- 修改/新增 `src/providers/` 下的 provider 或 parser
- 调整 gateway 的实时消息展示、进度、metrics 逻辑
- 评审跨 agent 的流式输出是否一致

## 背景：为什么需要统一抽象

| Agent | 输出协议 | 粒度 | 特殊能力 |
|-------|----------|------|----------|
| Claude Code CLI | `stream-json` (NDJSON 事件) | token 级 | thinking、tool_param、hook、cost |
| Codex CLI | `codex exec --json` (JSONL 事件) | turn / item 级 | 无 token 流、无 cost、无 hook |

差异很大，但 gateway 只需要关心“用户看到什么”：
- 进度文本
- 正文增量
- 工具调用提示
- metrics（token / cost）
- 结束信号

## StreamUpdate 接口

```typescript
export type StreamUpdateKind =
  | "session_id"      // session/thread id 已确认
  | "progress"        // 粗略进度（如“思考中… / 工具调用中…”）
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
  providerId?: string;   // 便于调试
}
```

## 新增 Provider 的接入步骤

1. 在 `src/providers/types.ts` 实现 `AgentProvider` 接口
2. 实现 `EventParser`：把底层 JSONL/NDJSON 事件转换为 `StreamUpdate`
3. 在 provider 中暴露 `onStreamUpdate` 或等价回调
4. gateway 统一消费 `StreamUpdate`，按 kind 展示

## 最小实现示例

```ts
// 新 provider 的 parser
class MyAgentParser implements EventParser {
  onStreamUpdate?: (u: StreamUpdate) => void;

  feed(line: string): void {
    const evt = JSON.parse(line);
    if (evt.type === "session.start") {
      this.onStreamUpdate?.({ kind: "session_id", payload: evt.id });
    } else if (evt.type === "text") {
      this.onStreamUpdate?.({ kind: "text", payload: evt.text });
    } else if (evt.type === "done") {
      this.onStreamUpdate?.({ kind: "done", payload: null });
    }
  }
}
```

## 降级策略

Codex 无法产生 `thinking`、`block_start/stop`、`hook`、`tool_param` 等事件。gateway 消费时应按“**可选存在**”处理，不要假设所有 kind 都出现。

```ts
for (const update of updates) {
  switch (update.kind) {
    case "text":       /* 追加正文 */ break;
    case "thinking":   /* 若配置允许则折叠展示 */ break;
    case "metrics":    /* 追加脚注 */ break;
    case "done":       /* 刷新最终消息 */ break;
    // 其他 kind 默认忽略或进 debug 日志
  }
}
```

## Quality Bar

- [ ] 新 provider 不直接操作 Slack UI，只 emit `StreamUpdate`
- [ ] 缺失 kind 不会导致 gateway 崩溃
- [ ] parser 有单元测试覆盖核心事件映射
- [ ] 新增 kind 时同步更新 `StreamUpdateKind` 类型与 gateway 展示逻辑

## 关联文件

- `src/providers/types.ts` — 接口定义
- `src/providers/claude-stream-parser.ts` — Claude 事件映射
- `src/providers/codex-parser.ts` — Codex 事件映射（#86 加入 `onText`/`onMetrics`）
- `docs/planning/v3-story-8-claude-codex-streaming-codex.md` — 完整设计文档
