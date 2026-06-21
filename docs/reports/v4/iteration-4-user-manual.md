# ChorusGate 迭代四功能用户手册

> 日期: 2026-06-21
> 面向读者: ChorusGate 使用者、维护者、迭代验收人员
> 覆盖功能: 测试命令、StreamUpdate、Codex sandbox、安全/限制说明

## 一、适用范围

本文说明迭代四完成后，使用者如何理解和操作新增/调整能力：

- 测试命令分层
- Claude/Codex 统一流式进度 `StreamUpdate`
- Codex 默认 sandbox 安全模式
- 常见验证命令与限制

本文不覆盖飞书/Lark、Session Host、完整 Worktree 生命周期等后续能力。

## 二、测试命令

迭代四后，项目测试命令分为三类：

| 命令 | 用途 | 建议场景 |
|------|------|----------|
| `npm test` | 默认测试，带 30s per-test timeout | 本地常规验证 |
| `npm run test:fast` | 快速测试，10s timeout，排除 ST 类测试 | 小改动快速检查 |
| `npm run test:integration` | 集成测试，60s timeout | 交付、回归、关闭 issue 前 |

推荐关闭 issue 或合并前运行：

```bash
npm run test:integration
```

## 三、StreamUpdate 功能说明

StreamUpdate 是 gateway 内部统一的流式事件接口，用于让不同 provider 以统一格式上报进度。

### 3.1 支持的事件

| 事件 | 含义 |
|------|------|
| `session_id` | provider 返回或确认 session |
| `progress` | 粗粒度进度，例如正在思考、调用工具 |
| `thinking` | Claude extended thinking 内容 |
| `text` | 回复文本增量或回合级文本 |
| `tool_call` | 工具调用信息 |
| `metrics` | token、cost 等统计信息 |
| `done` | 本轮回复完成 |
| `error` | 本轮回复失败 |
| `block_start` / `block_stop` | Claude block 生命周期 |

### 3.2 Claude 路径

Claude stream provider 支持高保真流式事件。启用后可看到更细粒度的进度、thinking、文本和 metrics。

常用环境变量：

| 变量 | 作用 | 默认 |
|------|------|------|
| `CLAUDE_STREAM_PARTIAL` | 启用 partial messages 参数 | `false` |
| `CLAUDE_STREAM_HOOK_EVENTS` | 启用 hook events 参数 | `false` |
| `CLAUDE_SHOW_THINKING` | 在 Slack 侧展示 thinking | `false` |
| `CLAUDE_SHOW_METRICS` | 在最终消息展示 token/cost | `false` |

示例：

```powershell
$env:CLAUDE_STREAM_PARTIAL = "true"
$env:CLAUDE_SHOW_THINKING = "true"
$env:CLAUDE_SHOW_METRICS = "true"
npm run gateway
```

### 3.3 Codex 路径

Codex CLI 不提供 Claude 等价的 token 级 thinking 或交互审批事件，因此 ChorusGate 采用降级实现：

- 支持回合级 `text`
- 支持工具调用类 `tool_call`
- 支持 `metrics`
- 支持 `done` / `error`
- 不保证提供 Claude 同粒度的 `thinking`

这属于设计内降级，不是缺陷。

## 四、Codex sandbox 安全模式

迭代四后，Codex 默认不再使用完全 bypass 模式，而是使用 workspace sandbox：

```text
-s workspace-write
```

含义：

| 行为 | 默认 sandbox |
|------|--------------|
| 读写当前 workspace | 允许 |
| 写系统目录或用户 home 之外敏感路径 | 应被限制 |
| 交互式逐工具审批 | 不支持 |
| 与 Claude 4-button approval 等价 | 不等价 |

如确需恢复旧行为，可显式设置：

```powershell
$env:GATEWAY_CODEX_APPROVAL_MODE = "bypass"
```

不建议在常规环境使用 bypass。

## 五、运行 gateway

常用命令：

```bash
npm run gateway
```

或通过 CLI：

```bash
npm start
npm run status
npm stop
```

Slack 侧仍通过现有 gateway bot 与 slash command 前缀使用：

```text
/cx_...
```

迭代四专用协作频道为：

```text
chorusgate_v4 = <#C0BB035G3DK>
```

## 六、验收检查

维护者在发布或交付前至少检查：

```bash
npm run test:integration
```

StreamUpdate 相关修改建议额外检查：

```bash
npx tsx --test --test-timeout=60000 --test-force-exit \
  tests/claude-stream-parser.test.ts \
  tests/claude-stream-session.test.ts \
  tests/claude-stream-integration.test.ts \
  tests/codex-provider.test.ts \
  tests/codex-integration.test.ts \
  tests/reply-engine.test.ts
```

如环境具备真实 Claude CLI/API key，可补跑：

```bash
node --import tsx --test --test-timeout=120000 --test-force-exit \
  tests/e2e-streamupdate.test.ts
```

## 七、已知限制

| 限制 | 说明 |
|------|------|
| Codex 真实 E2E 依赖本机安装 Codex CLI | 当前报告中仅验证 fixture 与 ENOENT 降级 |
| Slack 真实输出层未完全自动化 | 需要 token、Socket Mode 和运行中 gateway |
| Codex 不支持 Claude 等价审批 | 以 sandbox 替代交互式审批 |
| `CLAUDE_SHOW_THINKING` 可能增加 Slack 刷新量 | 建议在需要观察推理过程时再开启 |

## 八、故障排查

| 现象 | 优先检查 |
|------|----------|
| 测试卡住 | 是否使用了带 timeout 的 `npm test` 或 `npm run test:integration` |
| Codex 启动失败 | `CODEX_BIN` 是否存在，`codex --version` 是否可运行 |
| Codex 报 sandbox 限制 | 当前操作是否写出了 workspace；必要时调整工作目录，不建议直接 bypass |
| Claude 没有 partial 事件 | 是否设置 `CLAUDE_STREAM_PARTIAL=true`，CLI 是否支持对应参数 |
| Slack 没有实时刷新 | 检查 gateway 是否走 `generateReplyStream`，以及 Slack token/Socket Mode 是否正常 |
| Slack 回复内容很长 | gateway 会自动分片并保持在原 thread；若出现 `msg_too_long`，确认运行版本包含 `slack-message.ts` |
