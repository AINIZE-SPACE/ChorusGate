# ChorusGate Sprint 3 回顾文档

> **日期**: 2026-06-13 ~ 2026-06-16
> **分支**: `v3/story-8-claude-stream-json` → `dev` → `main`
> **PR**: #53 (→dev), #92 (→main)

---

## 一、目标与成果

### 一句话目标

将 gateway 从"单 Claude Code Slack bot"扩展为"多 AI agent + 多 channel/app + 多项目"的通用协作网关。

### 关键数据

| 指标 | 数值 |
|------|------|
| Issues 创建/关闭 | 91 |
| Commits | 35+ |
| PR | 2 (#53 → dev, #92 → main) |
| 新增文件 | 20+ |
| 修改文件 | 40+ |
| 测试 | 全部通过, typecheck 零错误 |
| 代码行数 | +6000 / -2000 |

---

## 二、Story 交付清单

| Story | 内容 | 核心模块 |
|------|------|---------|
| STORY-1 | Agent Provider 抽象层 | `providers/types.ts`: `AgentProvider` 接口 |
| STORY-2 | Codex Provider | `providers/codex.ts`: `codex exec --json` spawn |
| STORY-3 | 多 Slack App Socket Mode | `profile-config.ts`, `SocketManager` 多实例 |
| STORY-4 | 会话级多项目 | `SessionIdentity` 结构化 key, `--project` flag |
| STORY-5 | 统一 Session 模型 | CC UUID + Codex thread_id, SessionStore 扩展 |
| STORY-6 | 多 Agent/多 App 配置 | `GATEWAY_PROFILES`, per-profile env vars |
| STORY-7 | Codex Slack MCP Tools | Per-profile token, TOML config 生成 |
| STORY-8 | Claude stream-json 控制面 | M2 双向 + M3 流式增量 |

---

## 三、架构演进

### 新增模块

```
src/
  profile-config.ts           # 多 profile 解析
  interrupt.ts                # busy-ack + kill + queue
  plan-tracker.ts             # Claude todo → Slack 进度
  providers/
    _spawn-helpers.ts         # 共享 spawn 工具
    claude-stream.ts          # 双向 stream-json
    claude-stream-parser.ts   # M2 审批 + M3 流式事件
```

### 重构模块

```
socket-manager.ts    → SocketManager 类 (单例 → 多实例)
slack-clients.ts     → createSlackClientSet() 工厂
session-store.ts     → SessionIdentity 结构化 key
gateway.ts           → 多 profile 路由 + interrupt + plan + 4-btn approval
permission-tracker.ts → 4 按钮 + auto-approval + dedup
```

### 关键架构决策

| 决策 | 选择 | 原因 |
|------|------|------|
| Profile 配置 | env vars | 轻量, 与现有 .env 一致 |
| Session 持久化 | Markdown | git 追踪, 人类可读 |
| MCP 配置路径 | `.mcp.json` (项目根) | Claude Code 标准 |
| Token 注入 | spawn env 继承 | 不生成临时文件 |
| Prompt 传递 | stdin | Windows shell 转义 |
| 审批实现 | Claude stream-json bidirectional | 无需 SDK |
| Codex 审批 | `--dangerously-bypass-approvals-and-sandbox` | headless 模式 |

---

## 四、Codex CLl 参数对齐（v0.139.0）

```
codex exec --cd <dir> -c max_iterations=10 --json
           --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
           (prompt via stdin)
```

| Flag | create | resume | 说明 |
|------|:---:|:---:|------|
| `--json` | ✅ | ✅ | JSONL 输出 |
| `--cd <dir>` | ✅ | ❌ | resume 不支持 |
| `-c max_iterations=N` | ✅ | ✅ | 防无限循环 |
| `--skip-git-repo-check` | ✅ | ✅ | 非 git 目录 |
| `--dangerously-bypass-approvals-and-sandbox` | ✅ | ✅ | headless |
| `--ephemeral` | ❌ | ❌ | 0.139.0 不支持 |
| `--search` | ❌ | ❌ | 仅全局 flag |
| `--no-alt-screen` | ❌ | ❌ | TUI 专用 |

---

## 五、CC Stream-json 能力矩阵

### M2（已完成）

| 特性 | 状态 |
|------|:--:|
| 双向 stdin/stdout | ✅ |
| permission_request → Slack 按钮 | ✅ |
| 4-button approval (once/session/always/deny) | ✅ |
| block_actions 处理 | ✅ |
| 新旧 provider 并存 flag 切换 | ✅ |

### M3（已完成）

| 特性 | 事件 | Slack 表现 |
|------|------|-----------|
| 增量流式 | `content_block_delta` | 实时更新占位 |
| 思考块 | `thinking_delta` | `onThinkingDelta` |
| 正文块 | `text_delta` | `onTextDelta` → Slack |
| 块追踪 | `content_block_start/stop` | 🧠/💬 状态 |
| 指标 | `result` | cost/tokens |
| CLI flag | `--include-partial-messages` | env opt-in |
| 拆包 | `stream_event` unwrap | 兼容两种格式 |

---

## 六、Bug 修复总览

### P0/P1 Review (12 项)

| # | 问题 | 修复 |
|---|------|------|
| P0-1 | `--session-id` vs `--resume` 混用 | 分路径处理 |
| P0-2 | 审批按钮 resolve 后仍可点击 | chat.update 替换 |
| P0-3 | 非发起者可审批 | action_value 编码 userId |
| P0-4 | 4 类测试覆盖缺失 | 集成测试补齐 |
| P1-1 | 命名歧义 | 文档化 |
| P1-2 | 审批超时硬编码 | 入参化 |
| P1-3 | 返回 `any[]` | typed interface |
| P1-4 | onPermissionRequest 竞态 | 构造时绑定 |
| P1-5 | close() 未调用 | finally 调用 |
| #36 | auth check after resolution | 先校验再 resolve |
| #57 | untracked SIGKILL timer | exit 事件清理 |
| #69 | cmd.exe metacharacter | & \| > < ^ % 转义 |

### P2/P3 Backlog (11 项)

全部清零：spawn 模板去重, requestId 解析, 文档化, @提及显示, dedup, typed interface, parser cast 移除, env cache 移除, shell quoting, modal handler 日志

### Stream-json Bug (4 项)

| # | 根因 | 修复 |
|---|------|------|
| #88 | one-shot provider 缺少 onResult → stdin 永不关闭 | 绑定 onResult |
| #89 | DM 用了 thread_ts → 跑到 thread 里 | DM 时 replyThreadTs=undefined |
| #90 | stream_event 拆包后喂给父 parser 的是 wrapper JSON | JSON.stringify(evt) |
| #91 | result text 为空时 placeholder 卡住 | 显示 ✅ 完成 |

---

## 七、技能体系

### 本次新建/强化

| 技能 | 文件 | 关键改进 |
|------|------|---------|
| sprint-handoff | `.claude/skills/sprint-handoff/SKILL.md` | 7 步强制流程 + CLI 实测规则 + Sprint 3 教训 |
| notification-templates | `summit-saw/domains/dev/` | 变量化, mention 规则, 频道铁律 |
| problem-diagnosis | `summit-saw/domains/dev/` | 11 个坑位速查 |
| requirement-driven | `summit-saw/domains/dev/` | GitHub Issue Backbone + 状态流转 |
| test-spawn-fake-binary | `summit-saw/domains/dev/` | fake binary 强制 ENOENT |
| chorusgate-env-vars | `.claude/skills/` | ESM env 安全规则 |
| deep-research | built-in | 5 路并行搜索 + 3-vote 验证 |

### Sprint 3 三条核心教训

1. **fixture 必须对齐真实输出** — `stream_event` 拆包经历 4 次 round-trip，因为测试 mock 了错误格式
2. **先提单再修，修完通知** — 必须走完整开发流程
3. **加日志，不靠猜** — `super.feed(rawLine)` vs `JSON.stringify(evt)` 差一行就挂了

---

## 八、三方研究

| 项目 | 分析文档 | 关键借鉴 |
|------|---------|---------|
| Hermes Agent | `docs/reference/hermes-agent-analysis.md` | StreamEvent 类型化, 4-btn approve, 多任务推送, PlatformAdapter |
| CC Pocket | `memory/ccpocket-reference-value.md` | Bridge→Slack 复用, 审批循环, worktree 隔离 |
| Codex CLI v0.139.0 | `codex --help` 实测 | 参数对齐, stdin prompt, 子命令 flag 差异 |

---

## 九、v4 规划

| Issue | 标题 | 优先级 |
|------|------|--------|
| #33 | Session worktree isolation | P1 |
| #84 | 统一 CC + Codex approve | P1 |
| #85 | M3 增量流式完成 | P1 ✅ |
| #86 | 统一 StreamUpdate 接口 | P1 |
| #6 | Expand Slack command surface | P2 |
| #7 | Feishu/Lark channel support | P2 |
| #8 | Multi-agent runtime adapters | P2 |
| #9 | Install/doctor lifecycle | P2 |

---

## 十、致谢

- **小马** (delez) — 全面代码评审，发现 20+ findings
- **Hermes Agent** — 开源架构参考
- **Claude Code** — MCP 生态 + stream-json 协议

---

**报告生成**: 2026-06-16
**下次迭代**: v4 规划中
