<!-- 原名: v4-unified-approval.md, 2026-06-16 从中迁移 -->
# Unified Approval — CC Stream + Codex

> 状态: 设计完成，Codex 部分待实现 | Issue: #84

## 统一基础设施（已完成）

| 组件 | 状态 |
|------|------|
| `permissionTracker` | ✅ 4-scope (once/session/always/deny) + auto-approval cache |
| `buildApprovalBlocks` | ✅ 4-button Slack Block Kit UI |
| `socket-manager` block_actions | ✅ Approve/Deny handler |
| SessionIdentity-aware cache | ✅ Cross-profile isolation |

## CC Stream Approval（已实现）

```
Claude stream-json → permission_request event
  → gateway onPermission callback
  → buildApprovalBlocks → Slack 4 buttons
  → user clicks → stdin write permission_response
  → Claude continues
```

## Codex Approval（当前 + 方案）

### 当前 (Sprint 3)

| 模式 | Flag | 行为 |
|------|------|------|
| 默认 | `--dangerously-bypass-approvals-and-sandbox` | 跳过所有审批 |
| 交互 | `--ask-for-approval=on-request` | Codex 自己管理审批 |
| 开关 | `GATEWAY_INTERACTIVE_PERMISSIONS=1` | 自动切换 |

### v4 方案

Codex 的 approve 通过 stdin/stdout 交互。当 `--ask-for-approval=on-request` 生效时，Codex 通过 stdin 等待确认。Gateway 与 Codex 的 piped stdin 双向通信——类似 CC stream-json 模式。

```
Codex → stdout: tool approval request
  → gateway parse → Slack 4 buttons
  → user clicks
  → gateway stdin write → Codex continues
```

### 关键技术差异

| | CC | Codex |
|------|-----|-------|
| 协议 | stream-json (typed events) | TBD (needs investigation) |
| stdin | 保持打开, JSON write | 可能在 approve 时阻塞 |
| 格式 | `{"type":"permission_response",...}` | Codex CLI internal format |

### 实现计划 (v4)

1. 研究 Codex `--ask-for-approval=on-request` 的 stdin/stdout 协议
2. 写 M0 Spike fixture
3. 实现 Codex approve parser + gateway integration
4. 统一 CC + Codex 审批文档
