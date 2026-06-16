# Sprint 3 测试报告：Approval Loop 增强 (系统集成测试)

> 测试人：小马 (xiaoma) | 日期：2026-06-14 | **Verdict: ❌ CHANGES_REQUESTED**
> Plan: [PLAN-Sprint3-2026-06-14-xiaoma.md](../plans/PLAN-Sprint3-2026-06-14-xiaoma.md)
> Issue: [#32](https://github.com/AINIZE-SPACE/ChorusGate/issues/32) | PR: [#53](https://github.com/AINIZE-SPACE/ChorusGate/pull/53) ✓ OPEN
> 分支：`v3/story-8-claude-stream-json` (本地 = origin, 11 commits ahead of dev, 7704 additions, 121 files)

## 总评

**npm test 94/94 PASS, typecheck clean.** 4 大功能 (4-Button Approval / Auto-Approval Cache / SessionIdentity 集成 / .mcp.json 迁移) 自动化测例全绿. **6 P0 中 4 个已修 (#47 PR 开, #49 身份, #50 SessionIdentity, #51 env)**. 但 **仍有 2 个 P0 残留 (#48 假测试数, #52 配置漂移)** + 3 个 P1 (#8/#9/#11) 未修, 故 verdict **CHANGES_REQUESTED**.

---

## T1: 4-Button Approval (Hermes 风格) — PASS ✓

| ID | 检查项 | 结果 |
|----|--------|------|
| T1-1 | `buildApprovalBlocks` 返回 4 个 button | ✅ 4 buttons (allow_once/allow_session/allow_always/deny) |
| T1-2 | button action_id 正确 | ✅ `permission_allow_once` / `permission_allow_session` / `permission_allow_always` / `permission_deny` |
| T1-3 | button value 格式 `${scope}:${requestId}:${requesterUserId}` | ✅ 格式正确 |
| T1-4 | `waitForApproval` 按 scope 返回 | ✅ `'once' \| 'session' \| 'always' \| 'deny'` |
| T1-5 | 旧 `"approve"` / `"deny"` 兼容 | ✅ `mapScope` 兼容 |
| T1-6 | 超时 deny | ✅ 2 min timeout |
| T1-7 | `clear()` 取消所有 pending | ✅ resolve as `'deny'` |

`tests/permission-tracker.test.ts` 全部 4-button 测例 pass.

## T2: Auto-Approval Cache — PASS ✓ (含 P0 #50 已修)

| ID | 检查项 | 结果 |
|----|--------|------|
| T2-1 | "session" 注册后同 tool 同 session auto-approve | ✅ |
| T2-2 | "always" scope 同 tool 同 session auto-approve | ✅ |
| T2-3 | 不同 tool (Bash vs Write) 不互相影响 | ✅ |
| T2-4 | 不在 cache 中的 tool 返回 null | ✅ |
| **T2-5** | **P0 #50: SessionIdentity 含 projectDir — 不同 projectDir 不 auto-approve** | ✅ **FIXED** — `PendingPermission.sessionIdentity` field 存在; `cacheKey = ${sessionIdentity}:${toolName}` |
| **T2-6** | **P0 #50: SessionIdentity 含 profileId — 不同 profile 不 auto-approve** | ✅ **FIXED** — `sessionIdentity` 由 gateway 通过 `formatIdentityKey()` 拼装 |

**P0 #50 修复证据** (`src/permission-tracker.ts`):

```ts
// Lines 67-72: PendingPermission interface
interface PendingPermission {
  ...
  /** Session identity — scopes auto-approval to the right profile+provider. */
  sessionIdentity: string;
  ...
}

// Lines 218-227: cache key uses sessionIdentity
if (scope === "session" || scope === "always") {
  // session identity = `${profileId}:${providerId}:${channel}:${threadTs}`
  // "always" entries use a profile-level key for cross-session reuse
  const cacheKey = scope === "always"
    ? `${pending.requesterUserId}:${pending.toolName}`
    : `${pending.sessionIdentity}:${pending.toolName}`;
  this.autoApprovals.set(cacheKey, { ... });
}
```

Dev 也在 commit `1c66d09 fix(sprint-3): address P0 review findings #49 #50 #51 #52` 包含了这个修复.

## T3: `.mcp.json` 迁移 + 配置一致性 — PARTIAL (P0 #51 已修, #52 部分修, P1 未修)

| ID | 检查项 | 结果 |
|----|--------|------|
| T3-1 | `.mcp.json` 存在 | ✅ |
| **T3-2** | **P0 #51: `.mcp.json` chorusgate 块有 `env` (SLACK_BOT_TOKEN, SLACK_APP_TOKEN)** | ✅ **FIXED** — env block 已恢复 (commit `76c616e`) |
| **T3-3** | **P1 #11: `.mcp.json` 含 `MCP_SENDER_ONLY=1`** | ❌ **FAIL** — 仍缺失, STORY-9 闭环仍破 |
| **T3-4** | **P0 #52: 唯一 canonical MCP config** | ⚠️ **PARTIAL** — `.mcp.json` 和 `.claude/mcp.json` **现在内容完全相同** (`diff` 空), 但 2 个文件都存在, 仍非"唯一 canonical". 接受测试 `find -name "mcp*.json"` 仍返回 2 行 → FAIL |
| T3-5 | **P1 #8: trello pin version** | ❌ **FAIL** — 仍 `npx -y trello-mcp-server` (无 version pin) |
| T3-6 | **P1 #9: .env.example 含 TRELLO_API_KEY/TOKEN** | ❌ **FAIL** — `.env.example` 第 25 行是 `# TRELLO_API_KEY=*** TRELLO_TOKEN=*** ---- Gateway daemon ----` — 整行被 `#` 注释掉, **TRELLO_* 实际未定义**, 启动会报 missing env |
| T3-7 | doc 一致性 | ⚠️ **need re-review** — `59de99b docs(mcp): document MCP config — .mcp.json location, env var resolution, prod vs dev` 加了 doc, 但没核 |

**T3-4 详细证据** (`.mcp.json` vs `.claude/mcp.json`):

```bash
$ diff .mcp.json .claude/mcp.json
# (empty output — files are identical)

$ find . -name "mcp*.json" -not -path "*/node_modules/*" -not -path "*/.git/*"
./.mcp.json
./.claude/mcp.json
# 2 files — P0 #52 acceptance test (only one canonical) FAIL
```

**T3-6 详细证据** (`.env.example` line 25):

```bash
# ---- Trello MCP -------------------------------------------------------------
# Trello API key + token for Trello MCP integration (optional)
# TRELLO_API_KEY=*** TRELLO_TOKEN=*** ---- Gateway daemon ---------------------------------------------------------
```

整行是注释 (`#` 开头). 修复: 拆成 2 行, 去掉 `#` 注释符号:

```bash
TRELLO_API_KEY=
TRELLO_TOKEN=
```

## T4: 回归 — PASS ✓ (除 #48 假数)

| ID | 检查项 | 结果 |
|----|--------|------|
| T4-1 | `npm run typecheck` | ✅ exit 0, 0 error |
| T4-2 | `npm test` 全绿 | ✅ **94/94 PASS** (with uncommitted PlanTracker + Interrupt work) |
| **T4-3** | **P0 #48: handoff 67/67 vs actual** | ❌ **FAIL** — handoff 声称 67, **实际 94**. 差 27. 多次重跑均 94. |
| T4-4 | `tests/permission-tracker.test.ts` 4-button 测例 | ✅ 全 pass |
| T4-5 | `tests/claude-stream-integration.test.ts` permission cycle | ✅ 单独跑 pass; full suite 偶有 flake (1/5 概率), 但 isolated 跑稳定 |

**T4-2 实际数据** (重跑 2 次确认):

```
ℹ tests 94
ℹ pass 94
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

**T4-3 历史对比** (handoff 数字演变):

| 时刻 | 来源 | 数字 |
|---|---|---|
| 2026-06-14 10:00 (initial handoff) | dev Slack 消息 | "67/67" (假) |
| 2026-06-14 11:00 (my first review) | reviewer 跑 (test dir) | 60/61 (codex flake) |
| 2026-06-14 12:00 (my first review) | reviewer 跑 (dev dir + uncommitted) | 76/77 (PlanTracker fail) |
| **2026-06-14 14:00 (now)** | reviewer 跑 (dev dir, latest) | **94/94** (dev 期间加了 Interrupt + Plan + spawn refactor) |

P0 #48 仍是 open: handoff 数字 67 永远不准确, dev 以后要 re-state 真实数字.

## T5: 流程 & 身份 — 4/5 PASS ✓ (P0 #47, #49 已修)

| ID | 检查项 | 结果 |
|----|--------|------|
| **T5-1** | **P0 #47: Sprint 3 有 open PR** | ✅ **FIXED** — PR #53 OPEN, title "Sprint 3: Approval Loop 增强 + Interrupt + Plan + MCP fix (issue #32)", head=`v3/story-8-claude-stream-json`, base=`dev`, 121 files, 7704 additions, created 2026-06-14T04:16:49Z |
| T5-2 | 备选 PR check | ✅ |
| **T5-3** | **P0 #48: handoff test 数 vs actual** | ❌ **FAIL** — 67 vs 94 (见 T4-3) |
| **T5-4** | **P0 #49: Sprint 3 commits author = delez** | ✅ **FIXED** — `git log -3 --format='%an <%ae>'` 3 行全部 `delez <delez@163.com>` |
| **T5-5** | **P0 #49: git config = delez** | ✅ **FIXED** — `git config --get user.name` = `delez`, email = `delez@163.com` |

**T5-1 PR #53 详情**:

```json
{
  "additions": 7704,
  "baseRefName": "dev",
  "changedFiles": 121,
  "createdAt": "2026-06-14T04:16:49Z",
  "headRefName": "v3/story-8-claude-stream-json",
  "state": "OPEN",
  "title": "Sprint 3: Approval Loop 增强 + Interrupt + Plan + MCP fix (issue #32)"
}
```

注意: PR 范围超出 issue #32 (包含 Interrupt + Plan + spawn refactor), 这未必是问题但 spec scope drift 值得 mark.

## T6: Slack 通知 — PASS ✓

| ID | 检查项 | 结果 |
|----|--------|------|
| T6-1 | mention 用 `<@USER_ID>` 格式 | ✅ |
| T6-2 | 通知含"下一步负责人" | ✅ — 明确 mention 小克 (`<@U0B8VHLHJAX>`), 列出 5 步建议 |

---

## 总判定

### Verdict: ❌ CHANGES_REQUESTED

**理由:** 4/6 P0 已修, 但 2 个 P0 (#48 假测试数, #52 残留) + 3 个 P1 (#8/#9/#11) 未修. Sprint 3 不可合并.

### P0 状态汇总 (issue 跟踪)

| Issue | 标题 | 状态 |
|---|---|---|
| #47 | no PR open | ✅ **FIXED** (PR #53 开) |
| #48 | 假测试数 67/67 | ❌ **OPEN** (dev 需 re-state 真实数字) |
| #49 | 错身份 (xiaoma) | ✅ **FIXED** (delez 全程) |
| #50 | Auto-approval 忽略 SessionIdentity | ✅ **FIXED** (cacheKey 用 sessionIdentity) |
| #51 | .mcp.json 丢 env | ✅ **FIXED** (env block 恢复) |
| #52 | 3-way config drift | ⚠️ **PARTIAL** (2 文件内容相同, 但 2 文件并存; 需删一个) |

### P1 状态

| Issue | 标题 | 状态 |
|---|---|---|
| #8 | trello `npx -y` 不 pin | ❌ **OPEN** |
| #9 | .env.example TRELLO_* 行被注释掉 | ❌ **OPEN** (需拆 2 行) |
| #11 | MCP_SENDER_ONLY=1 缺失 | ❌ **OPEN** (STORY-9 闭环仍破) |

### P0 残留需要修的

1. **#52 (canonical config)**: 选 1 个, 删另一个. 建议: 删 `.claude/mcp.json` (保留 `.mcp.json` 作 Claude Code standard). 或者反向: 删 `.mcp.json`, 把内容回迁 `.claude/mcp.json`. 文档 `docs/feature-mcp-server.md` 也需同步.
2. **#48 (测试数)**: 未来 handoff 需 cite 真实 `npm test` 输出 (本次 94/94).

### P1 残留需要修的

1. **#8**: 把 `npx -y trello-mcp-server` 改成 pin version, e.g. `npx -y trello-mcp-server@1.2.3` 或 install 本地
2. **#9**: 修 `.env.example` 第 25 行, 拆成 2 行无注释
3. **#11**: 给 `.mcp.json` 和 `.claude/mcp.json` 都加 `MCP_SENDER_ONLY: "1"` 在 chorusgate env 块

---

## 与 code review 的关系

| Code review P0 | 对应 T case | 一致? |
|---|---|---|
| #47 无 PR | T5-1 | ✅ PASS (now) |
| #48 假测试数 | T4-3, T5-3 | ❌ OPEN (持续) |
| #49 错身份 | T5-4, T5-5 | ✅ PASS (now) |
| #50 SessionIdentity | T2-5, T2-6 | ✅ PASS (now) |
| #51 .mcp.json 丢 env | T3-2 | ✅ PASS (now) |
| #52 config drift | T3-4 | ⚠️ PARTIAL (现在 2 文件内容相同, 但未删 1) |

测试与 review 一致: 4 P0 (#47/#49/#50/#51) 测试 PASS, 2 P0 (#48/#52) 仍 open.

## 下一步

**dev (小克) 需要修:**
1. 删 1 个 MCP config 文件 (T3-4) — 关 #52
2. 修 `.env.example` TRELLO 行注释 (T3-6) — 关 #9
3. pin trello version (T3-5) — 关 #8
4. 加 MCP_SENDER_ONLY=1 (T3-3) — 关 #11
5. 未来 handoff cite 真实测试数 — 标记 #48 为 "process" 而非 "code"

**所有 5 步修完后, 小克 re-ping 小马 (我) re-review.**

---

**Tester:** xiaoma (小马) | **Verdict:** ❌ CHANGES_REQUESTED | **Date:** 2026-06-14
**Pass rate:** 94/94 tests, typecheck clean | **Open:** 2 P0 (#48, #52) + 3 P1 (#8, #9, #11)
