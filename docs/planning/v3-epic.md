# v3 EPIC: ChorusGate 多 Agent 协作 Channel 网关

> 状态：规划中 | 目标版本：v3.0.0

## 一句话目标

将 gateway 从“单 Claude Code Slack bot”扩展为“多 AI agent（Claude Code + Codex + 后续 runtime）+ 多 channel/app + 多项目”的通用协作 channel → agent 网关。

---

## EPIC 拆分

| Story | 标题 | 优先级 | 依赖 |
|-------|------|--------|------|
| [STORY-1](./v3-story-1-provider-abstraction.md) | Agent Provider 抽象层 | P0 | — |
| [STORY-2](./v3-story-2-codex-provider.md) | Codex Provider 实现 | P0 | STORY-1 |
| [STORY-3](./v3-story-3-multi-slack-app.md) | 多 Slack App Socket Mode | P0 | STORY-1 |
| [STORY-4](./v3-story-4-multi-project.md) | 会话级多项目支持 | P1 | STORY-1 |
| [STORY-5](./v3-story-5-session-model.md) | 统一 Session 模型（CC + Codex） | P0 | STORY-1, STORY-2 |
| [STORY-6](./v3-story-6-config-system.md) | 多 Agent/多 App 配置系统 | P0 | STORY-3, STORY-4 |
| [STORY-7](./v3-story-7-codex-slack-tools.md) | Codex Slack MCP Tools | P1 | STORY-2 |
| [STORY-8](./v3-story-8-claude-stream-json.md) | Claude 双向 stream-json 控制面 | P0 | STORY-1 |
| [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32) | Slack approval/control loop | P1 | STORY-1, STORY-5 |
| [#33](https://github.com/AINIZE-SPACE/chorusgate/issues/33) | Session worktree isolation | P1 | STORY-4, STORY-5 |

---

## 里程碑

### M0：验证 Spike（评审新增）
- 真实运行 `codex exec <prompt> --json`
- 固化 JSONL fixture（确认 `thread_id` 顶层 UUID 字段格式）
- 固化 resume fixture：`codex exec resume <tid> <prompt> --json`
- 固化 MCP tool-call fixture（含 tool_use 事件格式）
- 产物：`tests/fixtures/codex-*.jsonl`
- 详见 [#29](https://github.com/AINIZE-SPACE/chorusgate/issues/29)

### M1：双 Agent 核心（STORY-1, 2, 5）
- Per-profile Slack runtime 重构（拆单例）
- Provider 抽象层完成
- Claude Code provider（现有逻辑迁移）
- Codex provider（`codex exec` spawn，`thread_id` 解析）
- Session key 结构化改造（profileId + providerId + scopeKey + projectDir）

### M2：Claude 双向 stream-json 控制面（新 STORY-8，提前于多 Slack App）

> :zap: **日程提前**。发现 `claude -p --input-format stream-json --output-format stream-json --replay-user-messages` 支持双向 JSON 管道——stdin 不关闭，可回写 approve/deny 响应。不需要 Claude SDK npm 包。

- `ClaudeStreamProvider`：替代当前 `ClaudeProvider` 的单向 `claude -p` spawn
- stdin 保持打开，发送 JSON 消息（user prompt、approve/deny 响应）
- stdout 解析 JSON 事件（permission_request、stream_event、result）
- Slack interactive approve/deny：`permission_request` → Slack 按钮 → 用户点击 → stdin 回写
- `--replay-user-messages` 回显用户消息到输出流
- 跟踪: [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32)

### M3：多 Slack App（STORY-3, 6）
- 多 SocketModeClient 实例
- `GATEWAY_PROFILES=cc,codex` 配置系统
- Per-profile token 注入 MCP config
- Codex is already present as a provider, but app-level first-class support
  still requires isolated manifest/prefix/lifecycle wiring.

### M4：多项目 + Slack 工具（STORY-4, 7）
- 会话级 project cwd
- Codex Slack MCP Tools（gateway-only）

### M5：远期控制面增强
- 消息状态机和断线恢复
- Session 级 git worktree 隔离（远期降级，见 #33）
- 服务化安装补齐

---

## 关键架构决策（待确认）

1. **一个 gateway 进程 vs 多进程**：统一进程多 provider（推荐，共享 Socket Mode 管理）
2. **Slack app → provider 映射**：1:1（一个 app 对应一个 agent），按 token 后缀区分
3. **多项目范围**：会话级（每个 session 可绑定不同 cwd），不引入 workspace 概念
4. **Codex session ID**：首次 `codex exec` 从 JSONL 解析 `thread_id`（UUID 格式，已 M0 实测确认），回写 sessionStore
5. **CC Pocket 参考边界**：复用 Slack 作为 UI/control plane，不引入自建 WebSocket；借鉴 approval loop、offline queue、worktree isolation 和 service lifecycle。
