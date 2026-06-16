# ChorusGate v3 迭代三 集成系统测试方案（ST）

> **日期**: 2026-06-15
> **作者**: 小马（评审+测试）
> **分支**: `v3/story-8-claude-stream-json` (本地 a6e0ea3，GitHub 299100b4)
> **目标**: 迭代三结束后完整 ST 覆盖验收，特别是 Codex 支持 + CC-Stream/CX 方案

---

## 一、需求与设计回顾

### 1.1 迭代三完成清单

| Story | Issue | 产出 | 状态 |
|-------|-------|------|------|
| M0 Spike | #29 | codex fixture, verify-codex-cli.mjs | ✅ |
| STORY-1 Agent Provider 抽象 | #22 | `AgentProvider` 接口 + `EventParser` 抽象 | ✅ |
| STORY-2 Codex Provider | #23 | `codex exec --json` spawn + JSONL 解析 | ✅ |
| STORY-3 多 Slack App | #24 | `SocketManager` 多实例 | ✅ |
| STORY-4 多项目 | #25 | `SessionIdentity` 结构化 key | ✅ |
| STORY-5 统一 Session 模型 | #26 | CC UUID + Codex thread_id | ✅ |
| STORY-6 配置系统 | #27 | `GATEWAY_PROFILES` per-profile env | ✅ |
| STORY-7 Codex MCP Tools | #28 | per-profile token 注入, TOML config | ✅ |
| STORY-8 Claude Stream | #34 | `claude-stream.ts` 双向 stream-json | ✅ |
| STREAM-8 Interrupt | #54/#57 | `InterruptManager` interrupt + queue | ✅ |
| STREAM-8 Approval | #32 | 4-Button Approval + Plan Tracker | ✅ |
| Approval Auth Fix | #36 | auth check before resolve promise | ✅ |

### 1.2 Provider 架构（三链路）

```
reply-engine.generateReply(opts)
  └─ opts.providerId / GATEWAY_CLAUDE_MODE
      ├─ "claude"       → ClaudeProvider (legacy one-shot, claude -p)
      ├─ "claude-stream"→ ClaudeStreamProvider (bidirectional, --input-format stream-json)
      └─ "codex"        → CodexProvider (codex exec --json, JSONL)
```

### 1.3 已知 Bug（需 ST 覆盖）

| # | 描述 | 优先级 | Fix commit | ST 缺失根因 |
|---|------|--------|-----------|-------------|
| #76 | reply-engine 不路由 Codex | P0 | ef6a794 | 无 providerId switch 测试 |
| #77 | codex resume `--json` 位置错误 | P1 | 7a1fdb1 | 无 resumeSession 真实 CLI 测试 |
| #78 | Windows `"` 转义缺失 | P0 | 36225dd | 无 Windows shell 真实 spawn 测试 |
| #79 | BOT_USER_IDS 自触发循环 | P0 | 16fe3b5 | 无 shouldReply bot 过滤 ST |
| #81 | Codex thread_id 未写回 sessionStore | P0 | 3450da5 | 无 Codex resume 回归测试 |
| #80 | Codex 无限迭代 | P1 | (config.toml) | 无 MAX_ITERATIONS 超时 ST |
| #82 | codex exec 不支持全局 flag | P2 | 4778f08 | flag 实测脚本缺失 |

---

## 二、ST 测试矩阵

### 2.1 Provider 路由（覆盖 #76）

**目标**: 验证 `generateReply({providerId})` 正确路由到对应 provider

| 用例 ID | 输入 | 预期 | 验证点 |
|---------|------|------|--------|
| ST-PROV-001 | `{providerId:"claude"}` | 调用 ClaudeProvider | `claude -p` spawn，CLAUDE_BIN |
| ST-PROV-002 | `{providerId:"claude-stream"}` | 调用 ClaudeStreamProvider | `--input-format stream-json` flag |
| ST-PROV-003 | `{providerId:"codex"}` | 调用 CodexProvider | `codex exec --json` spawn |
| ST-PROV-004 | 无 providerId + `GATEWAY_CLAUDE_MODE=legacy` | 默认 claude | legacy one-shot path |
| ST-PROV-005 | 无 providerId + `GATEWAY_CLAUDE_MODE=stream` | claude-stream | bidirectional path |
| ST-PROV-006 | 无 providerId + `GATEWAY_CLAUDE_MODE=未设置` | claude legacy | backward compat |

**实现方案**:
```typescript
// tests/provider-routing.test.ts
test("generateReply routes to codex by providerId", async () => {
  const events: string[] = [];
  const child = { kill: () => {}, on: () => {} };
  const result = await generateReply("hello", {
    providerId: "codex",
    onSpawn: (c) => events.push(`spawn:${c.spawnfile}`),
  });
  // Verify codexProvider was selected (not claudeProvider)
  assert.match(events[0], /codex/);
});
```

### 2.2 Codex Create + Resume（覆盖 #77 #81 #78）

**目标**: 验证 Codex 生命周期（create → resume → thread_id 回写）

| 用例 ID | 输入 | 预期 | 验证点 |
|---------|------|------|--------|
| ST-CX-001 | `createSession("hello")` | thread_id 非空，无 `unexpected argument` | `--json` flag 位置正确 |
| ST-CX-002 | `createSession → resumeSession` | 第二条消息走 resume，无 🆕 | thread_id 正确回写 |
| ST-CX-003 | prompt 含 `"双引号"` 中文 | args 数量正确，无 Windows 解析错误 | `"` 转义逻辑 |
| ST-CX-004 | prompt 含 CJK + 空格 | CLI 调用成功 | Windows cmdline 安全 |
| ST-CX-005 | MAX_ITERATIONS=1 超时 | 返回 timeout error | 超时生效 |
| ST-CX-006 | `CODEX_BIN=nonexistent` | 错误信息含 "spawn" | 错误路径 ENOENT |

**实现方案**:
```typescript
// tests/codex-integration.test.ts
// 真实 CLI 调用，不是 mock
test("codex exec createSession --json flag position correct", async () => {
  // 使用 scripts/verify-codex-cli.mjs 的 fixture 逻辑
  // 验证 codex 命令行参数格式
});

test("codex resumeSession --json before positional args", async () => {
  // 验证: codex exec resume --json <thread_id> <prompt>
  // 不是: codex exec resume <thread_id> <prompt> --json
});

test("codex thread_id written back to sessionStore", async () => {
  // 首次 create → parse thread_id from JSONL
  // 第二次消息 → verify sessionStore has real thread_id, not random UUID
});
```

### 2.3 CC-Stream 双向审批（覆盖 #32 #34）

**目标**: 验证 `ClaudeStreamProvider` 的 stdin 不关闭 + 审批回写

| 用例 ID | 输入 | 预期 | 验证点 |
|---------|------|------|--------|
| ST-CC-001 | `createSession` with INTERACTIVE_PERMISSIONS=true | stdin 保持打开 | 不 close stdin 直到 session.close() |
| ST-CC-002 | `system.permission_request` 事件 | `sendPermissionResponse` 回写 stdin | approve/deny 双向通道 |
| ST-CC-003 | `createSession` (legacy one-shot) | stdin 立即关闭 | backward compat with ClaudeProvider |
| ST-CC-004 | `generateReplyStream` 被调用 | 返回 `{child, sendUserMessage}` | bidirectional API |
| ST-CC-005 | `buildApprovalBlocks` timeoutMs 参数 | 正确传递 | P1-2 regression |

**实现方案**:
```typescript
// tests/claude-stream-integration.test.ts
test("claude-stream bidirectional: stdin stays open during session", async () => {
  const stdinWrites: string[] = [];
  const mockStdin = new Writable({
    write(chunk, enc, cb) { stdinWrites.push(chunk.toString()); cb(); }
  });
  // Verify stdin is NOT ended immediately after spawn
  // 而是等到 session.close() 才 end
});

test("permission_request triggers onPermissionRequest callback", async () => {
  // Simulate JSONL: {"type":"system","subtype":"permission_request",...}
  // Verify sendPermissionResponse was called with {approved: true/false}
});
```

### 2.4 Gateway Interrupt（覆盖 #54 #57）

**目标**: 验证 InterruptManager interrupt + queue 模式

| 用例 ID | 输入 | 预期 | 验证点 |
|---------|------|------|--------|
| ST-INT-001 | `GATEWAY_BUSY_MODE=interrupt` + 新消息 | 当前 child.kill("SIGTERM") | 进程被终止 |
| ST-INT-002 | `GATEWAY_BUSY_MODE=interrupt` + 30s 内重复消息 | busy ack 只发一次 | debounce 生效 |
| ST-INT-003 | `GATEWAY_BUSY_MODE=queue` + 新消息 | 消息排队，不 kill | 队列模式 |
| ST-INT-004 | interrupt 后再发消息 | 排队消息被处理 | queue drain |
| ST-INT-005 | 进程已退出时 interrupt | 无 crash，no-op | edge case |
| ST-INT-006 | SIGTERM 5s 无响应 | 升级 SIGKILL | escalation timer |

**已有覆盖**: `tests/interrupt-integration.test.ts` (262 行)，需验证：
- 真实 child_process + slow-script.mjs fixture
- SIGTERM/SIGKILL 信号记录
- debounce 时间戳

### 2.5 Approval Auth（覆盖 #36）

**目标**: 验证 auth check 在 resolve promise 之前

| 用例 ID | 输入 | 预期 | 验证点 |
|---------|------|------|--------|
| ST-AUTH-001 | requesterUserId !== action_user | promise 不 resolve | `if (userId !== result.requesterUserId) return` |
| ST-AUTH-002 | requesterUserId === action_user | promise resolve，审批生效 | 正常审批流程 |
| ST-AUTH-003 | 无 action_value 的 interactive | 不 crash | edge case |
| ST-AUTH-004 | 审批超时 | `buildApprovalBlocks` timeoutMs 正确 | P1-2 regression |

**实现方案**:
```typescript
// tests/permission-tracker.test.ts 扩展
test("approval: wrong user cannot resolve others request", async () => {
  const tracker = new PermissionTracker();
  const deferred = tracker.createDeferred();
  tracker.pending.set("msg123", { deferred, requesterUserId: "U_REAL", ... });
  
  // 模拟: U_WRONG 用户点了按钮
  const action = { user: { id: "U_WRONG" }, value: encode("U_REAL|tool_id|approve") };
  tracker.handleBlockAction(action, {});
  
  assert.equal(deferred.status, "pending"); // 未 resolve
  assert.equal(tracker.pending.has("msg123"), true); // 仍在队列
});
```

### 2.6 shouldReply Bot 过滤（覆盖 #79）

**目标**: 验证 `shouldReply()` 正确过滤 bot 消息

| 用例 ID | 输入 | 预期 | 验证点 |
|---------|------|------|--------|
| ST-SR-001 | bot DM (U0B8VHLHJAX) | `shouldReply() === false` | BOT_USER_IDS filter |
| ST-AUTO-002 | bot DM (U0BAGFVD8VB) | `shouldReply() === false` | 第二个 bot ID |
| ST-SR-003 | 人类 DM (U0AHDRREVPD) | `shouldReply() === true` | 正常 DM 回复 |
| ST-SR-004 | @mention 任何用户 | `shouldReply() === true` | mention 始终回复 |
| ST-SR-005 | `subtype=message_changed` | `shouldReply() === false` | 过滤编辑事件 |
| ST-SR-006 | 空文本消息 | `shouldReply() === false` | empty text filter |

### 2.7 Slack link_names 回归（覆盖 #59 #60）

**目标**: 验证所有 `chat.postMessage` 含 `link_names:true`

| 用例 ID | 验证点 |
|---------|--------|
| ST-SLACK-001 | `slack_reply` 工具调用含 link_names:true |
| ST-SLACK-002 | `slack_send_message` 工具调用含 link_names:true |
| ST-SLACK-003 | gateway progress 消息含 link_names:true |
| ST-SLACK-004 | approval 消息含 link_names:true |

**已有覆盖**: `tests/link-names-regression.test.ts` (98 行)

### 2.8 Windows Shell 转义（覆盖 #78）

**目标**: 验证 `spawnCodex` Windows 分支引号转义

| 用例 ID | 输入 | 预期 | 验证点 |
|---------|------|------|--------|
| ST-WIN-001 | prompt = `说"你好"` | args 数量=1，无解析错误 | `\"` 转义 |
| ST-WIN-002 | prompt = `echo a & echo b` | 两个命令都执行 | `^` 转义 |
| ST-WIN-003 | CODEX_BIN 含空格路径 | 正确引用 | `"${CODEX_BIN}"` |
| ST-WIN-004 | `spawnCodex` on Windows | shell=true, cmd 构建正确 | 非 Unix 路径 |

---

## 三、测试执行方案

### 3.1 测试分层

```
UT (Unit Test)
  └─ 纯函数逻辑，无 I/O
  └─ 例: permission-tracker.test.ts, plan-tracker.test.ts

ST (System Integration Test)
  └─ 真实 CLI spawn，不 mock child_process
  └─ 例: interrupt-integration.test.ts, codex-args.test.ts

E2E (End-to-End)
  └─ 真实 Slack 事件 → 真实 gateway 进程 → 真实 Slack 回复
  └─ 例: 在 dev 环境人工冒烟测试
```

### 3.2 ST 执行命令

```bash
# 前提: 项目根目录，npm install 完成
cd E:/my_project/ainize/ChorusGate_test

# 全部 ST（跳过网络依赖测试）
npm test -- --test-name-pattern ".*integration.*|.*codex.*|.*provider.*|.*interrupt.*"

# 仅 Codex ST
npm test -- --test-name-pattern "ST-CX|codex"

# 仅 Interrupt ST
npm test -- --test-name-pattern "ST-INT|interrupt"

# 仅 Approval Auth ST
npm test -- --test-name-pattern "ST-AUTH|permission"

# 仅 shouldReply ST
npm test -- --test-name-pattern "ST-SR|shouldReply"

# 生成覆盖率报告
npm test -- --coverage --test-name-pattern "ST-"
npx c8 report
```

### 3.3 CI 集成（GitHub Actions）

```yaml
# .github/workflows/st.yml
name: System Integration Tests

on:
  pull_request:
    paths:
      - 'src/**/*.ts'
      - 'tests/**/*.ts'
  push:
    branches: [dev, 'v3/**']

jobs:
  st:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm test -- --test-name-pattern "integration|codex|interrupt|provider"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN_TEST }}
          CODEX_BIN: codex

  codex-cli:
    runs-on: windows-latest  # Windows ST 必须在 Windows runner
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: node scripts/verify-codex-cli.mjs
      - run: npm test -- --test-name-pattern "ST-WIN|codex"
        env:
          CODEX_BIN: codex
```

---

## 四、补齐清单（Gap Analysis）

### 4.1 缺失的测试文件（需新建）

| 文件 | 覆盖 | 优先级 | 负责人 |
|------|------|--------|--------|
| `tests/provider-routing.test.ts` | ST-PROV-001~006 (#76) | P0 | 小克 |
| `tests/codex-integration.test.ts` | ST-CX-001~006 (#77 #81 #78) | P0 | 小克 |
| `tests/claude-stream-bidirectional.test.ts` | ST-CC-001~005 (#32) | P1 | 小克 |
| `tests/shouldReply-bot-filter.test.ts` | ST-SR-001~006 (#79) | P0 | 小克 |
| `tests/approval-auth.test.ts` | ST-AUTH-001~004 (#36) | P0 | 小克 |

### 4.2 缺失的 fixture

| 文件 | 用途 |
|------|------|
| `tests/fixtures/codex/create-resume-sequence.jsonl` | Codex create → resume 完整 JSONL 序列 |
| `tests/fixtures/codex/thread-id-written-back.jsonl` | 验证 thread_id 回写的 JSONL |
| `tests/fixtures/claude-stream/permission-request.jsonl` | `system.permission_request` 事件序列 |
| `tests/fixtures/claude-stream/bidirectional.jsonl` | stdin 保持打开的双向序列 |

### 4.3 缺失的 env var 测试

| 文件 | 覆盖 |
|------|------|
| `scripts/verify-codex-cli.mjs` | 已在 PR #53（50+/0-）|
| `tests/codex-args.test.ts` | 已在 PR #53（50+/0-）|

---

## 五、测试报告模板

```markdown
# ST 执行报告 — [日期]

## 环境
- OS: [Windows/Linux]
- Node: [版本]
- 分支: [commit SHA]
- CODEX_BIN: [路径]

## 执行结果

| 用例 ID | 结果 | 耗时 | 备注 |
|---------|------|------|------|
| ST-PROV-001 | PASS/FAIL | Xms |  |
| ST-CX-001 | PASS/FAIL | Xms |  |

## 覆盖率

| 模块 | 行覆盖 | 分支覆盖 |
|------|--------|---------|
| src/reply-engine.ts | XX% | XX% |
| src/providers/codex.ts | XX% | XX% |
| src/gateway.ts | XX% | XX% |

## 发现的问题

| # | 描述 | 严重度 | 状态 |
|---|------|--------|------|
| 1 |  | P0/P1/P2 | open/closed |

## 结论

- [ ] ST 全部通过
- [ ] 可以合入 dev
```

---

## 六、依赖关系

```
需求/设计
  │
  ├─ #22 AgentProvider 接口     ──→ ST-PROV-001~006
  ├─ #23 Codex Provider         ──→ ST-CX-001~006
  ├─ #34 Claude Stream          ──→ ST-CC-001~005
  ├─ #32 Approval               ──→ ST-AUTH-001~004
  ├─ #54 Interrupt              ──→ ST-INT-001~006
  ├─ #36 Auth check             ──→ ST-AUTH-001~004
  ├─ #59 link_names             ──→ ST-SLACK-001~004
  ├─ #76 Provider routing bug   ──→ ST-PROV-003
  ├─ #77 --json position bug    ──→ ST-CX-001
  ├─ #78 Windows escaping bug   ──→ ST-WIN-001~004 + ST-CX-003
  ├─ #79 Bot filter bug         ──→ ST-SR-001~002
  └─ #81 thread_id 回写 bug     ──→ ST-CX-002

ST 执行
  │
  ├─ provider-routing.test.ts   (新建)
  ├─ codex-integration.test.ts  (新建)
  ├─ claude-stream-bidirectional.test.ts (新建)
  ├─ shouldReply-bot-filter.test.ts (新建)
  ├─ approval-auth.test.ts      (扩展现有)
  └─ interrupt-integration.test.ts (已有，需验证)
```

---

## 七、风险与备注

1. **Codex CLI 依赖**: ST-CX 系列依赖真实 `codex` CLI 安装，需在 CI 加 `codex-cli` setup step
2. **Windows ST**: `ST-WIN-*` 必须在 Windows runner 执行，Linux 无法复现 cmdline 解析差异
3. **Slack token**: E2E 测试需要测试 workspace 的 bot token，建议在 CI secrets 管理
4. **本地分支落后**: 本地 `a6e0ea3` 落后 GitHub `299100b4`，补测前需先 fetch 合并 fix commits
5. **Bot self-reply (#79)**: `shouldReply()` 的 ST 需 mock `StoredEvent` 构造不同场景

---

*本方案由小马（评审+测试）编写，迭代三结束后执行*
*关联 issues: #76 #77 #78 #79 #80 #81 #82 #32 #34 #54 #57 #59 #60 #36*
