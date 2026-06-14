# Sprint 3 测试方案：Approval Loop 增强 (系统集成测试)

> 测试人：小马 (xiaoma) | 日期：2026-06-14
> Issue: [#32](https://github.com/AINIZE-SPACE/ChorusGate/issues/32) | PR: 待开 (见 T5-2)
> 分支：`v3/story-8-claude-stream-json` @ `face15c` (3 commits: 4c50188, f1a0613, face15c)
> 测试模式：系统集成测试 (方案 → 用例 → 脚本 → 执行 → 报告)

## 测试目标

验证 Sprint 3 Approval Loop 增强 4 大功能的 *系统集成* 行为：

1. **4-Button Approval** (Hermes 风格) — Allow Once / Allow Session / Always Allow / Deny
2. **Auto-Approval Cache** — session 级别同工具后续不弹窗
3. **SessionIdentity 集成** — 多 profile + 多项目 session 隔离 (P0 #50)
4. **`.mcp.json` 迁移** — token 通过 env 注入，统一新标准 (P0 #51, #52)

并对照代码 review 6 个 P0 发现的 5 类可测项 (#47/#48 不可测, #49/#50/#51/#52 可测)。

## 测试范围

### T1: 4-Button Approval (Hermes 风格)

| ID | 检查项 | 方法 | 对应 issue |
|----|--------|------|-----------|
| T1-1 | `buildApprovalBlocks` 返回 4 个 button (Allow Once / Allow Session / Always Allow / Deny) | 自动化测试 | — |
| T1-2 | 4 个 button 的 `action_id` 是 `permission_allow_once` / `permission_allow_session` / `permission_allow_always` / `permission_deny` | 自动化测试 | — |
| T1-3 | 4 个 button 的 `value` 格式是 `${scope}:${requestId}:${requesterUserId}` | 自动化测试 | — |
| T1-4 | `waitForApproval` 按 button scope 返回 `'once' \| 'session' \| 'always' \| 'deny'` | 自动化测试 | — |
| T1-5 | 旧 `"approve"` / `"deny"` action_value 仍兼容 (`mapScope` fallback) | 自动化测试 | — |
| T1-6 | 超时自动 deny | 自动化测试 | — |
| T1-7 | `clear()` 取消所有 pending (resolve as `'deny'`) | 自动化测试 | — |

### T2: Auto-Approval Cache

| ID | 检查项 | 方法 | 对应 issue |
|----|--------|------|-----------|
| T2-1 | 第一次 "session" 批准后, 同 tool 同 session 的下一次请求 auto-approve | 自动化测试 | — |
| T2-2 | "always" scope 注册后, 同 tool 同 session 的下一次请求 auto-approve (scope=always) | 自动化测试 | — |
| T2-3 | **同 tool, 不同 tool name** (Bash vs Write) 不互相影响 | 自动化测试 | — |
| T2-4 | **`checkAutoApproval` 返回 null 当 tool name 不在 cache 中** | 自动化测试 | — |
| T2-5 | **P0 #50: auto-approval key 必须包含 SessionIdentity** — 同 channel/threadTs 但 *不同 projectDir* 不应 auto-approve | **新测** | #50 |
| T2-6 | **P0 #50: auto-approval key 必须包含 SessionIdentity** — 同 channel/threadTs 但 *不同 profileId* 不应 auto-approve | **新测** | #50 |

### T3: `.mcp.json` 迁移 + 配置一致性

| ID | 检查项 | 方法 | 对应 issue |
|----|--------|------|-----------|
| T3-1 | `.mcp.json` 存在 at project root | `ls` | — |
| T3-2 | **P0 #51: `.mcp.json` chorusgate 块有 `env` 字段 (SLACK_BOT_TOKEN, SLACK_APP_TOKEN)** | `grep` | #51 |
| T3-3 | **P0 #51 补充: `.mcp.json` chorusgate 块有 `MCP_SENDER_ONLY: "1"`** (regresses STORY-9 #40) | `grep` | #11 |
| T3-4 | **P0 #52: 只有一个 canonical MCP config** — `find . -name "mcp*.json" -not -path "*/node_modules/*"` 唯一 | `find` | #52 |
| T3-5 | `.mcp.json` trello entry 不写死 `npx -y` (pin 到具体 version 或本地 install) | 人工审查 | #8 |
| T3-6 | `.env.example` 含 `TRELLO_API_KEY` 和 `TRELLO_TOKEN` 占位 | `grep` | #9 |
| T3-7 | `docs/feature-mcp-server.md` 描述的 MCP config 路径与实际 canonical 文件一致 | 人工审查 | — |

### T4: 回归 — typecheck + npm test

| ID | 检查项 | 方法 | 对应 issue |
|----|--------|------|-----------|
| T4-1 | `npm run typecheck` exit 0, 零 error | `tsc --noEmit` | — |
| T4-2 | `npm test` 在 dev dir (含 uncommitted PlanTracker) 全绿 | `npm test` | — |
| T4-3 | **P0 #48: test 总数与 handoff 声明的 67 一致** — 实际数应可重现 | 跑 `npm test`, parse `ℹ tests N` | #48 |
| T4-4 | `tests/permission-tracker.test.ts` 4-button 测例全 pass | `node --test` | — |
| T4-5 | `tests/claude-stream-integration.test.ts` permission cycle 测例 pass | `node --test` | — |

### T5: 流程 & 身份 (P0 #47, #48, #49)

| ID | 检查项 | 方法 | 对应 issue |
|----|--------|------|-----------|
| T5-1 | **P0 #47: Sprint 3 有 open PR** — `gh pr list --state open --head v3/story-8-claude-stream-json` 返回非空 | `gh pr list` | #47 |
| T5-2 | **P0 #47 备选: 接受"无 PR" 但要求开新 PR** — `gh pr list` 至少有任意 open PR 标记 Sprint 3 | `gh pr list` | #47 |
| T5-3 | **P0 #48: handoff 声明的 test 数 (67/67) 与实际 `npm test` 输出一致** | 跑 + diff | #48 |
| T5-4 | **P0 #49: Sprint 3 commits author 是 dev (delez), 不是 reviewer (xiaoma)** | `git log -3 --format='%an <%ae>'` | #49 |
| T5-5 | **P0 #49: dev dir `git config user.name` 是 delez** | `git config --get user.name` | #49 |

### T6: Slack mrkdwn 格式 + 通知验证 (SLA / 流程)

| ID | 检查项 | 方法 | 对应 issue |
|----|--------|------|-----------|
| T6-1 | Review 通知 mention 用 `<@USER_ID>` 格式 (不是 `@名字`) | 人工审查 | — |
| T6-2 | 通知明确写了"下一步负责人" (per `[[review-handoff-ownership]]` 规则) | 人工审查 | — |

## 执行命令 (脚本)

> 所有命令在 `E:\my_project\ainize\ChorusGate_dev` 跑, 除非注明.

```bash
# ===== T1-T2: 单元 + 集成自动化测试 (Node native test runner) =====
cd E:/my_project/ainize/ChorusGate_dev
npm test 2>&1 | tee /tmp/sprint3-npmtest.log
# 预期: tests ≥ 60, fail ≤ 1 (codex MCP config flaky in full suite; PlanTracker "1/2 完成" fail in uncommitted work)

# T1-1..T1-7 覆盖在 tests/permission-tracker.test.ts
node --import tsx --test tests/permission-tracker.test.ts 2>&1
# 预期: 全 pass

# T1-4 兼容 + T2-1..T2-4 同文件
# T2-5, T2-6 (SessionIdentity 隔离) — 当前测试**不存在**, 需新加 (对应 P0 #50)

# T2-5 P0 #50 verification (grep)
grep -n "checkAutoApproval" src/permission-tracker.ts
# 当前实现: key = `${pending.channel}:${pending.threadTs}:${pending.toolName}`
# 期望: 包含 `formatIdentityKey()` 调用, 或 sessionKey 来自 SessionIdentity
# P0 #50 状态: 当前实现忽略 profileId/providerId/projectDir → FAIL

# T2-5 P0 #50 verification (SessionIdentity integration)
grep -n "formatIdentityKey" src/permission-tracker.ts
# 预期: 1+ match (当前 0 match → FAIL)

# ===== T3: .mcp.json 配置 =====
ls -la .mcp.json .claude/mcp.json .claude/mcp.json.example 2>&1

# T3-2: P0 #51 — .mcp.json 有 env 块
grep -A6 '"chorusgate"' .mcp.json | grep -E "SLACK_BOT_TOKEN|SLACK_APP_TOKEN"
# 预期: 2 match; 当前 0 match → FAIL (P0 #51)

# T3-3: P0 #11 — .mcp.json 有 MCP_SENDER_ONLY=1
grep "MCP_SENDER_ONLY" .mcp.json
# 预期: 1+ match; 当前 0 match → FAIL (P1 #11)

# T3-4: P0 #52 — 只有一个 canonical MCP config
find . -name "mcp*.json" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>&1
# 预期: 单行 (例如只 `./.mcp.json`); 当前 2 行 (.mcp.json + .claude/mcp.json) → FAIL (P0 #52)

# T3-5: trello pinned version
grep -A3 '"trello"' .mcp.json | head -10
# 预期: args 含 `@version` 或本地路径; 当前 `npx -y trello-mcp-server` → FAIL (P1 #8)

# T3-6: .env.example TRELLO 占位
grep -E "TRELLO_(API_KEY|TOKEN)" .env.example
# 预期: 2 match; 当前 0 match → FAIL (P1 #9)

# T3-7: doc 一致性
grep -E "\.mcp\.json|\.claude/mcp\.json" docs/feature-mcp-server.md | head -5
# 人工审查: doc 必须描述与 T3-4 同一个 canonical 文件

# ===== T4: 回归 =====
npm run typecheck 2>&1
# 预期: 0 error, exit 0

# T4-3: handoff 数字 vs 实际
HANDOFF_CLAIM=67
ACTUAL=$(npm test 2>&1 | grep -oE "ℹ tests [0-9]+" | head -1 | grep -oE "[0-9]+")
echo "Handoff claim: $HANDOFF_CLAIM; Actual: $ACTUAL"
# 当前: Handoff=67, Actual=77 (with PlanTracker) or 61 (branch only) → FAIL (P0 #48)

# ===== T5: 流程 & 身份 =====
# T5-1, T5-2: PR open check
gh pr list --repo AINIZE-SPACE/ChorusGate --state open --json number,title,headRefName
# 预期: 至少 1 PR 与 Sprint 3 相关 (含 "Approval Loop" 或 "Sprint 3" 字样)
# 当前: 0 PR → FAIL (P0 #47)

# T5-4: commit author
cd E:/my_project/ainize/ChorusGate_dev
git log -3 --format='%an <%ae>' face15c 4c50188 f1a0613
# 预期: 3 行都是 delez <delez@163.com>; 当前 3 行都是 xiaoma <xiaoma@chorusgate-review.local> → FAIL (P0 #49)

# T5-5: git config
cd E:/my_project/ainize/ChorusGate_dev
git config --get user.name
git config --get user.email
# 预期: name=delez, email=delez@163.com
# 当前: name=xiaoma, email=xiaoma@chorusgate-review.local → FAIL (P0 #49)

# ===== T6: Slack 通知 (人工) =====
# T6-1, T6-2 — 审查通知消息 (在 Slack thread 1781404960.505909)
# 预期: 所有 mention 用 <@USER_ID>, 明确"下一步负责人"
```

## 准入/退出标准

- **准入:** Sprint 3 commits 4c50188 / f1a0613 / face15c 已在 origin (`face15c == origin/v3/story-8-claude-stream-json`)
- **退出:** T1-T6 全部通过, 或失败项已映射到 P0/P1 GitHub issues (#47-#52)
- **当前预期 verdict:** **CHANGES_REQUESTED** — 至少 T2-5/T2-6/T3-2/T3-3/T3-4/T4-3/T5-1/T5-4/T5-5 FAIL, 全部已对应 GH issues

## 与 code review 的关系

本测试方案 *不重复* code review 已发现的 6 P0 finding 的 *人工审查* 部分; 而是 *自动化* 重跑关键路径, 提供 **代码 review 的独立验证**。

| Code review finding | 对应测试 case |
|---|---|
| #47 无 PR | T5-1, T5-2 |
| #48 测试数假 | T4-3, T5-3 |
| #49 错身份 | T5-4, T5-5 |
| #50 auto-approval 忽略 SessionIdentity | T2-5, T2-6 |
| #51 .mcp.json 丢 env | T3-2 |
| #52 3-way config drift | T3-4 |
| #11 MCP_SENDER_ONLY 缺失 (P1) | T3-3 |
| #8 npx -y 不 pin (P1) | T3-5 |
| #9 TRELLO_* 缺 .env.example (P1) | T3-6 |

---

**接下来:** 执行命令 → 记录结果 → 写 REPORT-Sprint3-2026-06-14-xiaoma.md (含 verdict).
