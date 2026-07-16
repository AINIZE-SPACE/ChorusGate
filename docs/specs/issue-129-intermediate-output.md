# Spec: #129 输出中间过程

> **Issue**: [#129](https://github.com/AINIZE-SPACE/ChorusGate/issues/129)
> **Type**: Story / P1
> **Analyst**: 小马
> **Date**: 2026-07-17

## 1. 问题分析

### 1.1 需求描述

1. 执行任务时，有中间关键结果时输出**过程摘要信息**（而不只是一个概要标题如"📖 读取频道消息中…"）
2. 消息尾部一直显示"（已编辑）"--如果改成 append stream 模式，就不显示"（已编辑）"了

### 1.2 当前代码行为

**文件**: `src/gateway.ts` L470-524

当前进度更新机制：
```typescript
// 1. 创建 placeholder 消息 "⏳ 处理中…"
const ph = await web.chat.postMessage({ text: "⏳ 处理中…", ... });
placeholderTs = ph.ts;

// 2. onProgress 回调 -> updatePlaceholder -> chat.update 覆盖整条消息
const updatePlaceholder = (text: string, force = false): void => {
  if (!placeholderTs || progressDone) return;
  // throttle 1.5s
  await web.chat.update({ channel, ts: placeholderTs, text });
};
```

**问题 1**: `onProgress` 只传一个 label 字符串（如 "📖 读取频道消息中…"），不包含中间结果内容。`onTextDelta` 虽然更新 placeholder 但只显示最后 500 字符的文本碎片。

**问题 2**: 每次 `chat.update` 覆盖原消息 -> Slack 标记"（已编辑）"。这是因为每次都是 update 操作，不是 append。

### 1.3 StreamUpdate 已有基础设施

`#86` 已实现统一 `StreamUpdate` 回调体系（`src/providers/types.ts`）：

```typescript
export type StreamUpdateKind =
  | "session_id" | "progress" | "block_start" | "block_stop"
  | "text" | "thinking" | "tool_call" | "tool_param"
  | "hook" | "metrics" | "done";
```

但目前 gateway 的 `onProgress` 只用 `progress` kind 的 label 做标题更新。`text` kind 只在 `onTextDelta` 中被截取 500 字符。中间结果内容没有被展示。

## 2. 设计方案

### 2.1 方案 A: Append Stream 模式（推荐）

**核心思路**: 不再 update 覆盖 placeholder，改为：
1. 进度标题继续 update（短标签如"📖 读取中…"，覆盖更新没关系）
2. **中间结果内容**作为新消息 append 到 thread（不再 edit）
3. 最终回复也作为新消息发送

**消息结构**:
```
Thread:
  ├─ [placeholder] ⏳ 处理中… -> 进度标题更新 (edit, 可接受)
  ├─ [progress msg 1] 📋 中间结果：找到 3 个相关 issue...
  ├─ [progress msg 2] 🔧 中间结果：已完成代码修改...
  └─ [final reply] 最终完整回复
```

**实现**:

```typescript
// 新增: 中间结果消息列表
const progressMessages: { ts: string; label: string }[] = [];
let lastProgressLabel = "";

// onProgress: 只更新 placeholder 标题
onProgress: (label: string) => {
  updatePlaceholder(label, true);
},

// 新增 onStreamUpdate handler: 处理中间结果
onStreamUpdate?: (update: StreamUpdate) => {
  switch (update.kind) {
    case "tool_call": {
      const { name, label } = update.payload as { name: string; label: string };
      // 工具调用完成时，如果有中间结果文本，追加新消息
      break;
    }
    case "text": {
      // 积累文本，当达到一定长度或遇到换行时，作为中间结果发送
      const text = update.payload as string;
      // 不在 placeholder 上显示碎片，而是积累后发新消息
      break;
    }
    case "metrics": {
      // 在 placeholder 上追加 metrics（可 edit，可接受）
      const m = update.payload as { inputTokens?: number; outputTokens?: number };
      updatePlaceholder(`${lastLabel}\n📊 tokens: in=${m.inputTokens} out=${m.outputTokens}`, true);
      break;
    }
  }
},
```

### 2.2 中间结果消息发送策略

```typescript
/**
 * 当 agent 产出中间关键结果时，append 新消息到 thread。
 * 触发条件:
 * - tool_call 完成 + 有 output_text
 * - agent_message 完成但不是最终结果（多轮 turn）
 * - thinking block 完成 + 有可展示的推理摘要
 */
async function appendProgressResult(
  web: WebClient,
  channel: string,
  threadTs: string | undefined,
  label: string,
  content: string,
): Promise<void> {
  const text = `**${label}**\n${content}`;
  await web.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    link_names: true,
  });
}
```

**截断策略**: 中间结果内容限制 1000 字符，超过则截取首尾各 500 字符 + "…"

### 2.3 "（已编辑）"消除方案

"（已编辑）"标签来自 Slack API 的 `chat.update`。两个选择：

| 方案 | 说明 | 优缺点 |
|------|------|-------|
| **A. 接受 edit 标签** | 进度标题继续 edit | 简单，已实现。"（已编辑）"只在进度消息上，不影响最终回复 |
| **B. Append 模式** | 进度也用新消息追加 | 无"（已编辑）"但消息多，thread 变长 |
| **C. 混合模式** | 标题 edit + 内容 append | 推荐：平衡 |

**推荐方案 C**: 
- placeholder 消息只显示当前工具标签（edit 可接受，因为是进度指示器）
- 中间关键结果用 append 新消息（无"已编辑"）
- 最终回复也用新消息发送（或覆盖 placeholder 的最后一版）

### 2.4 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `GATEWAY_PROGRESS_MODE` | `edit` | `edit`=当前模式, `append`=纯追加模式, `hybrid`=混合 |
| `GATEWAY_PROGRESS_APPEND_THRESHOLD` | `200` | 文本超过此长度才追加为独立消息 |
| `GATEWAY_PROGRESS_MAX_MESSAGES` | `5` | 最多追加多少条中间结果消息 |

### 2.5 消息流示意（hybrid 模式）

```
User @bot: 分析这个 PR

[placeholder msg - edit updates]
  ⏳ 处理中…
  → 📖 读取频道消息中…
  → 📂 查阅资料中…
  → 🔍 搜索代码中…

[append msg 1 - 中间结果]
  📋 已读取 PR diff，共修改 5 个文件:
  - src/gateway.ts (+45/-12)
  - src/reply-engine.ts (+23/-8)
  ...

[append msg 2 - 中间结果]  
  🔧 代码审查发现:
  1. [P2] timeout 未在 stream 模式重置
  2. [P3] 变量命名不一致
  ...

[final reply - 覆盖或新消息]
  ✅ PR 审查完成。总结：
  ...
```

### 2.6 验收标准

- [ ] 中间关键结果以独立消息发送（非 edit），无"（已编辑）"
- [ ] 进度标签（"📖 读取中…"）继续在 placeholder 上更新
- [ ] 最终回复消息无"（已编辑）"
- [ ] 中间结果消息有截断处理
- [ ] `GATEWAY_PROGRESS_MODE=edit` 时退回现有行为
- [ ] `npm run build` 通过

## 3. 优先级

**P1** - 用户体验提升。与 #130 (timeout reset) 有关联：stream 模式下持续输出中间结果时需要 timeout 重置。
