# v3 设计评审回复

> 评审日期：2026-06-12 | 状态：已完成修复

## 评审结论

方案方向可行。4 个 P0 设计缺口已修复，新增 M0 验证 Spike 里程碑。

## 修复明细

### 1. Codex JSONL 字段 + 权限标志 (P0) ✅

| 项 | 旧 | 新 |
|----|-----|-----|
| Session ID 字段 | `thread.id` | `thread_id`（UUID 格式，M0 实测） + `thread.id`（兼容） |
| 权限标志 | `--full-auto` / `--ask-for-approval never` | M0 实测：当前 `codex exec` 不支持 `--ask-for-approval`，Phase 1 不传审批 flag |
| 文档 | v3-story-2-codex-provider.md | 已修复 |
| 跟踪 | [#23](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/23) | 已加评论 |
| 决策单 | — | [#29](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/29) |

### 2. Per-profile Slack runtime 重构 (P0) ✅

单例清单已记录，STORY-3 先拆单例再扩展：

| 单例 | 文件 |
|------|------|
| `webClient` | `slack-clients.ts:7` |
| `socketClient` | `socket-manager.ts:23` |
| `botUserId` | `socket-manager.ts:28` |
| `onEventCallback` | `socket-manager.ts:24` |
| `onSlashCallback` | `socket-manager.ts:25` |

| 文档 | v3-story-3-multi-slack-app.md | 已修复 |
| 跟踪 | [#24](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/24) | 已加评论 |
| 决策单 | — | [#30](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/30) |

### 3. Session key 结构化 (P0) ✅

| 旧 key | 新 key |
|--------|--------|
| `channel:C0B8V9LV8CT` | `cc:claude:channel:C0B8V9LV8CT:E:\project-a` |

新 key 维度：`profileId:providerId:scopeKey:projectDir`

| 文档 | v3-story-4-multi-project.md | 已修复 |
| 跟踪 | [#25](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/25) | 已加评论 |

### 4. Per-profile MCP token 注入 (P1) ✅

| 旧 | 新 |
|----|-----|
| `process.env.SLACK_BOT_TOKEN`（全局） | `profile.botToken`（per-profile 注入） |
| CC 和 Codex 共享 sender config | 各生成独立的 MCP config |

| 文档 | v3-story-7-codex-slack-tools.md | 已修复 |
| 跟踪 | [#28](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/28) | 已加评论 |
| 决策单 | — | [#31](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/31) |

### 5. 新增 M0 验证 Spike 里程碑

| 文档 | v3-epic.md | 已更新 |
|------|------------|--------|
| 内容 | 真实 codex exec --json 固化 JSONL/resume/MCP fixture；以本机 CLI 输出为准 | |

## 新增 GitHub Issues

| Issue | 标题 | 类型 |
|-------|------|------|
| [#29](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/29) | Codex gateway runtime uses实测 `codex exec --json` JSONL 契约 | 决策单 |
| [#30](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/30) | Use cc/codex Slack profiles with independent Socket Mode tokens | 决策单 |
| [#31](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/31) | Phase 1 Codex is gateway-only; keep MCP server Claude Code first | 决策单 |

## 里程碑调整

```
M0 → M1 ✅ → M2 🔥 → M3 → M4
 ↓      ↓        ↓
JSONL   Provider  Claude stream-json
固化    抽象层    双向管道 + approve/deny
        Codex     (从 M4 提前)
        Session
```

### 第二次调整 (2026-06-12)：M2 提到 Claude stream-json

发现 `claude -p --input-format stream-json --output-format stream-json --replay-user-messages` 支持双向 JSON 管道，不需要 Claude SDK。原 M4 审批控制面提前到 M2：
- M2: Claude stream-json 双向控制面 (#34)
- M3: 多 Slack App (#24, #27)
- M4: 多项目 + Slack 工具 (#25, #28)
- M5: 远期（状态机、git worktree）
```
