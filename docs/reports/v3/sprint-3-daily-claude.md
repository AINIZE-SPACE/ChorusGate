# ChorusGate v3 迭代报告 — Sprint 3

> **日期**: 2026-06-13 ~ 2026-06-16
> **分支**: `v3/story-8-claude-stream-json`
> **目标**: 将 gateway 从单 Claude Code Slack bot 扩展为多 AI agent + 多 channel/app + 多项目的通用协作网关

---

## 一、迭代概览

| 指标 | 数据 |
|------|------|
| Issues 总创建 | 60+ |
| Issues 关闭 | **52** |
| Commits | 23 |
| 新增文件 | 20+ |
| 修改文件 | 30+ |
| 新增测试 | 30+ |
| 总测试用例 | 100+ (全部通过) |
| TypeScript 检查 | 零错误 |
| 技能沉淀/更新 | 7 个 |

---

## 二、Story 完成清单

### M0: 验证 Spike ✅

| Story | Issue | 产出 |
|------|------|------|
| M0 Spike | #29 | `tests/fixtures/codex-*.jsonl`, `claude-stream-*.jsonl` fixture |

### M1: 双 Agent 核心 ✅

| Story | Issue | 核心变更 |
|------|------|---------|
| STORY-1 Agent Provider 抽象层 | #22 | `src/providers/types.ts`: `AgentProvider` 接口 + `EventParser` 抽象 |
| STORY-2 Codex Provider | #23 | `src/providers/codex.ts`: `codex exec --json` spawn + JSONL 解析 |
| STORY-5 统一 Session 模型 | #26 | `SessionStore` 扩展: provider + projectDir 字段, CC UUID + Codex thread_id |

### M2: Claude 双向 stream-json ✅

| Story | Issue | 核心变更 |
|------|------|---------|
| STORY-8 Claude stream-json 控制面 | #34 | `src/providers/claude-stream.ts`: 双向 `--input-format stream-json --output-format stream-json` |
| — | #32 | 4-Button Approval (Hermes 风格), Task Plan 实时推送, Gateway Interrupt |

### M3: 多 Slack App ✅

| Story | Issue | 核心变更 |
|------|------|---------|
| STORY-3 多 Slack App Socket Mode | #24 | `SocketManager` 多实例, `createSlackClientSet()` 工厂 |
| STORY-6 配置系统 | #27 | `GATEWAY_PROFILES`, per-profile env vars, 单 profile 向后兼容 |

### M4: 多项目 + Slack 工具 ✅

| Story | Issue | 核心变更 |
|------|------|---------|
| STORY-4 会话级多项目 | #25 | `SessionIdentity` 结构化 key, `/cc_new --project <dir>`, `--project` flag |
| STORY-7 Codex MCP Tools | #28 | Per-profile token 注入, Codex TOML config, MCP 统一 |

### P0/P1 Review 修复 ✅ (12 项)

| # | 问题 | 修复 |
|---|------|------|
| P0-1 | 永远用 `--session-id` 而非 `--resume` | `createSession` 强制 `--session-id` |
| P0-2 | 审批按钮 resolve 后仍可点击 | `chat.update` 替换为确认文本 |
| P0-3 | 任何人可审批他人请求 | `action_value` 编码 requesterUserId, gateway 校验 |
| P0-4 | 缺失 4 类测试覆盖 | `claude-stream-integration`, `block-actions`, `permission-tracker` 扩展 |
| P1-1 | 命名歧义 | `claude-stream.ts` 文件头文档化 one-shot vs bidirectional |
| P1-2 | 审批超时硬编码 | `buildApprovalBlocks` 接受 `timeoutMs` 入参 |
| P1-3 | 返回 `any[]` | 定义 typed Block interface |
| P1-4 | onPermissionRequest 竞态 | 构造时绑定回调 |
| P1-5 | `close()` 未调用 | `finally { session.close() }` |
| #36 | auth check after resolution | 先校验 userId 再 resolve |
| #57 | untracked SIGKILL timer | exit 事件清理 timer |
| #69 | cmd.exe metacharacter | `& | > < ^ %` 转义 |

### P2/P3 Backlog ✅ (11 项)

| # | 项目 |
|---|------|
| P2-1 | `requestId` 含 `:` 解析 |
| P2-2 | spawn 模板去重 → `_spawn-helpers.ts` |
| P2-3 | permissionMode 参数化 (已通过调用时读 env 解决) |
| P2-4 | claudeStreamProvider 文档化 |
| P2-5 | 审批消息 @提及 显示 |
| P2-6 | permission_request 去重 |
| P3-1 | buildApprovalBlocks typed interface |
| P3-2 | streamToResult parser 强转移除 |
| P3-3 | MCP config env 缓存移除 |
| P3-4 | Windows shell 反斜杠 + cmd 特殊字符转义 |
| P3-5 | modal/submit handler 日志 |

### Bug 修复

| Issue | 问题 | 根因 | 修复 |
|------|------|------|------|
| #59 | Slack mention 不触发推送通知 | `link_names:true` 缺失 + `@name` 纯文本 | 全量 `link_names:true`, `<@U>` 格式, mention 放 `text` 顶层 |
| #49 | SessionIdentity key 迁移: resume 找不到 session | `load()` 旧 key 未迁移 | `formatIdentityKey()` 重写 |
| #50 | auto-approval 未按 SessionIdentity 隔离 | cache key 扁平 | `${sessionIdentity}:${toolName}` |
| #51 | createSession 对已有 session 仍用 `--session-id` | isResume 判断 | 已修 |
| #52 | 多个跨 profile 隔离 | sessionIdentity 匹配 | 已修 |

---

## 三、架构演进

### 新增模块

```
src/
  profile-config.ts        # 多 profile 解析 (GATEWAY_PROFILES=cc,codex)
  interrupt.ts             # InterruptManager: busy-ack + kill + queue
  plan-tracker.ts          # PlanTracker: Claude todo → Slack 任务进度
  providers/
    _spawn-helpers.ts      # 共享 spawn 工具 (P2-2)
    claude-stream.ts       # 双向 stream-json provider (M2)
    claude-stream-parser.ts # stream-json 事件解析器
  tools/
    get-skill-list.ts      # MCP: 列出项目技能
```

### 重构模块

```
socket-manager.ts   → SocketManager 类 (单例 → 多实例)
slack-clients.ts    → createSlackClientSet() 工厂
session-store.ts    → SessionIdentity 结构化 key
bootstrap.ts        → 多 profile 初始化
gateway.ts          → 多 profile 路由 + interrupt + plan + 4-btn approval
reply-engine.ts     → per-profile token + onSpawn + onPlanUpdate
permission-tracker.ts → 4 按钮 + auto-approval + dedup
```

---

## 四、技术决策记录

| 决策 | 选择 | 替代方案 |
|------|------|---------|
| Profile 配置格式 | env vars (`GATEWAY_PROFILES=cc,codex`) | YAML/JSON 配置文件 |
| Session 持久化 | Markdown (`memory/sessions.md`) | SQLite |
| MCP 配置位置 | `.mcp.json` (项目根) | `.claude/mcp.json` |
| Token 注入方式 | spawn env 继承 | 生成临时 config 文件 |
| Prompt 传递 | stdin (pipe) | argv |
| 审批实现 | Claude stream-json bidirectional | Claude SDK npm 包 |
| Shell 转义 | cmd.exe 双引号 + `^` 转义 | 仅双引号 |

---

## 五、技能体系沉淀

| 技能 | 类型 | 位置 |
|------|------|------|
| `sprint-handoff` | 项目技能 | `.claude/skills/` |
| `requirement-driven` | 全局技能 | `summit-saw/domains/dev/` |
| `notification-templates` | 全局技能 | `summit-saw/domains/dev/` |
| `problem-diagnosis` | 全局技能 | `summit-saw/domains/dev/` |
| `test-spawn-fake-binary` | 全局技能 | `summit-saw/domains/dev/` |
| `workflow-skills-evolution` | 全局技能 | `summit-saw/domains/dev/` |
| `reference-summit-saw` | 全局技能 | `summit-saw/domains/dev/` |

### 技能改进要点

- 模板**变量化**: `{TESTER}` `{REVIEWER}` `{CHANNEL_ID}` 替代硬编码
- **铁律**写入: 频道非 DM, `<@USER_ID>` 格式, mention 在顶层 text
- `problem-diagnosis`: 新增 6 个坑位速查
- `sprint-handoff`: 四步流程标准化

---

## 六、三方研究

| 项目 | 产出 | 关键借鉴 |
|------|------|---------|
| Hermes Agent | `docs/reference/hermes-agent-analysis.md` | StreamEvent 类型化, 分段机制, 4-btn approval, 多任务推送, PlatformAdapter |
| CC Pocket | `memory/ccpocket-reference-value.md` | Bridge→Slack 复用, 审批循环, worktree 隔离 |

---

## 七、反思与改进

### 踩坑 Top 6

| # | 坑 | 教训 |
|---|-----|------|
| 1 | SessionIdentity key 迁移 → session 全丢 | `load()` 必须 oldKey→newKey 迁移 |
| 2 | Slack mention UI 正确但没通知 | `link_names:true` + `<@ID>` 顶层 text + 频道非 DM |
| 3 | MCP 配置读不到 | 路径是 `.mcp.json` 不是 `.claude/mcp.json`, env 从 `settings.json` 来 |
| 4 | 通知发错频道/ID | 通知前必查 `[[project-team-channels]]` |
| 5 | `unfurl_*` 是 placebo | 用户实验验证后从技能移除 |
| 6 | ESM env freeze | 模块顶层读 `process.env` 在 `bootstrap()` 之前执行 |

### 后续改进

- [ ] 复杂重构前 checklist: 数据迁移、向后兼容、test coverage、typecheck
- [ ] 通知前自动读取 memory 验证频道和 ID
- [ ] 大重构每个 commit 后 push，避免 force-push
- [ ] P0/P1 fix 即时验证，不在本地堆积

---

## 八、剩余工作 (v4)

| Issue | 标题 |
|------|------|
| #33 | Session worktree isolation |
| #6 | Expand Slack command/control surface |
| #7 | Feishu/Lark channel support |
| #8 | Multi-agent runtime adapters (OpenClaw) |
| #9 | Install/uninstall/doctor lifecycle |
| #10 | Open-source readiness |

---

## 九、致谢

感谢 **小马** (delez) 的全面代码评审，发现 20 项 finding 并逐一验收修复。
感谢 **Hermes Agent** 开源项目提供的架构参考。
感谢 **Claude Code** 的 MCP 生态支持。

---

**报告生成**: 2026-06-14
**下次迭代**: v4 规划中
