# Feature: 实时进度提示（Live Progress）

> 对应文件：`src/gateway.ts`（placeholder/heartbeat 逻辑）、`src/reply-engine.ts`（stream-json 解析）

---

## 问题背景

`claude -p` 第一个 token 通常需要 5–30 秒，网络差时更长。如果 gateway 什么都不发，用户不知道机器人是否收到了消息，体验很差（"它挂了还是在想？"）。

---

## 实现方案

### 1. 占位消息

收到事件、开始 spawn claude -p 之前，立刻发一条占位消息：

```
🤔 正在思考…
```

这条消息有 `ts`（时间戳），后续所有更新都用 `chat.update` 就地修改它，不产生额外消息。

### 2. 心跳轮换

每 6s 轮换一次通用文案（纯推理阶段没有工具事件时保持存在感）：

```
🤔 正在思考…  → 🔍 分析中…  → 🧩 整理中…  → 📊 汇总结果中…  → ✅ 审核结果中…
```

### 3. 真实工具事件覆盖

reply-engine 解析 `--output-format stream-json --verbose` 的 NDJSON 流，`tool_use` 事件 → 中文标签 → 覆盖当前心跳：

| 工具 | 标签 |
|------|------|
| `slack_channel_history` / `thread_replies` | 📖 读取频道消息中… |
| `slack_send_message` / `slack_reply` | ✍️ 发送消息中… |
| `slack_list_channels` / `get_user` | 📇 查询信息中… |
| `slack_add_reaction` | 👍 添加反应中… |
| `read` / `grep` / `glob` | 📂 查阅资料中… |
| `bash` | ⚙️ 执行命令中… |
| `websearch` / `webfetch` | 🌐 联网检索中… |
| `write` / `edit` | 📝 整理内容中… |
| 其他 | 🛠️ 处理中（<tool-name>）… |

### 4. 最终替换

claude -p 输出完毕 → `chat.update` 把占位消息替换为最终回复文本。如果 claude 失败，占位消息替换为 `:warning: 错误描述`。

### 5. 节流

`chat.update` 节流 1.5s，避免触发 Slack rate limit（`chat.update` 限速约 1 次/秒/channel）。

---

## stream-json 解析细节

reply-engine 按行解析 NDJSON（`\n` 分隔）：

```
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__slack__slack_channel_history",...}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"以下是频道最近消息..."}]}}
{"type":"result","result":"最终回复文本"}
```

- `type=assistant` + `content[].type=tool_use` → `onProgress(toolLabel(name))`
- `type=assistant` + `content[].type=text` → 累积到 `assistantText`（作为 fallback）
- `type=result` → `resultText`（优先使用）

**Why 两个 fallback**：`result` 事件是最准的（claude 的最终输出），但部分版本或模式下可能只有 assistant text。双重 fallback 保证总能拿到文本。

**Why `--verbose` 必须加**：`-p` 模式不加 `--verbose` 不发中间事件，只有最终 result。加了才有工具调用事件可解析。

---

## 关闭进度（GATEWAY_PROGRESS=0）

设 `GATEWAY_PROGRESS=0` 后：不发占位消息，不心跳，claude 跑完直接 `chat.postMessage` 最终结果。适合调试或希望消息记录干净的场景。

---

## Why 就地编辑而不是多条消息

替代方案是每个进度步骤发一条新消息，但这会产生 5–10 条系统噪声消息污染频道。就地编辑只有一条消息，用户体验更接近"思考气泡"。
