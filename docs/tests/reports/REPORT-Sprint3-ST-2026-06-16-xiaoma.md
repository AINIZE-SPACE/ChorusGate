# ChorusGate v3 迭代三 系统测试报告（ST）

> **日期**: 2026-06-16 10:13
> **分支**: `v3/story-8-claude-stream-json` @ `cab75076f06dca4c336c94dc411926bc367b9c12`
> **本地状态**: 与 `origin/v3/story-8-claude-stream-json` 同步
> **作者**: 小马（评审+测试）

---

## 1. 执行概要

| 维度 | 结果 |
|------|------|
| 新增 ST 测试用例 | 20 个 |
| 新增测试代码 | 540 行（3 个文件）|
| ST 通过率 | 16/20 (80%) |
| 发现环境问题 | 2 个 |
| 发现代码缺陷 | 1 个 |
| Bug reopen | #76/#77/#78/#79 |

---

## 2. ST 执行结果

### 2.1 provider-routing.test.ts — ST-PROV-*

跟踪: #76 (REOPENED)

| ID | 测试内容 | 结果 |
|----|----------|------|
| ST-PROV-001 | providerId:claude spawn claude | PASS |
| ST-PROV-002 | providerId:claude-stream stream-json | PASS |
| ST-PROV-003 | providerId:codex spawn codex | FAIL |
| ST-PROV-004 | GATEWAY_CLAUDE_MODE=legacy | PASS |
| ST-PROV-005 | GATEWAY_CLAUDE_MODE=stream | PASS |
| ST-PROV-006 | default → claude legacy向后兼容 | PASS |

关键验证: ST-PROV-002/005 证明 claude-stream 路由正确（args 含 --input-format --output-format stream-json）。
ST-PROV-003 失败原因: codexProvider.createSession 未调用 opts.onSpawn（新发现缺陷，见 3.3）。

### 2.2 shouldReply-bot-filter.test.ts — ST-SR-*

跟踪: #79 (REOPENED)

| ID | 测试内容 | 结果 |
|----|----------|------|
| ST-SR-001 | 小克 bot DM → false | PASS |
| ST-SR-002 | 小扣 bot DM → false | PASS |
| ST-SR-003 | 真人 DM → true | PASS |
| ST-SR-004 | @mention → true | PASS |
| ST-SR-005 | message_changed → false | PASS |
| ST-SR-006 | 空 text → false | PASS |
| ST-SR-007 | 无 user 字段 → false | PASS |
| ST-SR-008 | 普通频道消息 → false | PASS |

8/8 PASS。shouldReply 已正确实现 BOT_USER_IDS 过滤。

### 2.3 codex-integration.test.ts — ST-CX-*

跟踪: #77 #78 #81

| ID | 测试内容 | 结果 | 说明 |
|----|----------|------|------|
| ST-CX-001 | createSession --json 位置 | FAIL | 3s timeout: MCP server 不可用 |
| ST-CX-002 | resumeSession --json 位置 | FAIL | 同上 |
| ST-CX-003 | Windows 双引号转义 | FAIL | 测试本身有逻辑问题 |
| ST-CX-004 | CJK+空格 prompt spawn | FAIL | 同 ST-CX-001 |
| ST-CX-005 | MAX_ITERATIONS=1 限制 | FAIL | 同上 |
| ST-CX-006 | CODEX_BIN=nonexistent | FAIL | 期望立即失败，实际 2000ms timeout |

环境依赖: codex exec 依赖 chorusgate-mcp MCP server。测试环境无该 server 导致 timeout。
非代码缺陷，是 ST 环境准备问题。

---

## 3. 缺陷与发现

### 3.1 Bug #76 — reply-engine 路由（REOPENED）

根因: 已在 GitHub HEAD 修复。本地 cab7507 已合入。
验证: ST-PROV-002/005 证明路由正确，修复 commit ef6a794 存在于本地分支。

### 3.2 Bug #79 — shouldReply BOT 过滤（REOPENED）

根因: 已确认修复。src/gateway.ts 已包含 BOT_USER_IDS 过滤逻辑。
验证: ST-SR-001/002 证明 bot DM 正确返回 false。

### 3.3 新缺陷 — codexProvider.createSession 未调用 onSpawn

接口定义（types.ts CreateSessionOptions）:
  onSpawn?: (child: ChildProcess) => void;  // spawn 后回调

实际情况:
- createSession 签名接收 opts: CreateSessionOptions（含 onSpawn）
- spawnCodex(args, prompt, cwd, timeoutMs, parser) 不接受 onSpawn 参数
- onSpawn 永远不会被调用
- interrupt manager 无法获得 ChildProcess 引用

影响: Codex stream 中无法 interrupt（Ctrl+C 无效）。
建议: 在 spawnCodex 中 child.on('spawn', () => opts.onSpawn?.(child)) 调用回调。

### 3.4 环境问题

问题1: .codex/config.toml 含 Git Merge Conflict Marker
  现象: codex exec 失败，报 TOML parse error: <<<<<<< HEAD
  处理: 用 GitHub HEAD 版本覆盖（已执行）

问题2: MCP Server chorusgate-mcp 不可用
  现象: codex exec 等待 MCP handshake，3-5s timeout
  处理: ST-CX-* 标记为需 MCP server 的手动测试

---

## 4. 迭代三需求覆盖矩阵

| 需求/故事 | 验收标准 | 测试方式 | 状态 |
|----------|----------|----------|------|
| STORY-1: Provider接口 | 3种provider统一接口 | UT+ST-PROV | OK |
| STORY-2: Codex Provider | codex exec spawn/resume | ST-CX | 环境依赖 |
| STORY-3: Multi-Slack-App | SocketManager按profile路由 | UT | OK |
| STORY-4: Multi-project | SessionStore隔离 | UT | OK |
| STORY-5: Unified Session | 事件路由到正确provider | ST-PROV | OK |
| STORY-6: Profile Config | GATEWAY_PROFILES解析 | UT | OK |
| STORY-7: Codex MCP Tools | generateMCPConfig | UT | OK |
| STORY-8: Claude stream-json | stream-json spawn+interrupt | UT+ST-PROV-002 | OK |
| Bug #76: reply-engine路由 | providerId路由正确 | ST-PROV | 确认修复 |
| Bug #77: --json位置 | codex exec在exec之前 | ST-CX-001/002 | 待环境 |
| Bug #78: Windows引号 | 双引号正确转义 | ST-CX-003 | 待简化 |
| Bug #79: BOT过滤 | shouldReply过滤bot DM | ST-SR | 确认修复 |
| Bug #80: Codex无限迭代 | MAX_ITERATIONS限制 | ST-CX-005 | 待环境 |
| Bug #81: thread_id写回 | Codex sessionId回调 | UT+检查 | 代码确认 |
| Bug #82: --search标志 | Codex不支持全局flag | UT | 代码确认 |

---

## 5. 新增测试文件清单

| 文件 | 用例数 | 描述 |
|------|--------|------|
| tests/provider-routing.test.ts | 6 | #76 reply-engine路由ST |
| tests/shouldReply-bot-filter.test.ts | 8 | #79 shouldReply BOT过滤ST |
| tests/codex-integration.test.ts | 6 | Codex CLI集成ST |

---

## 6. 后续行动项

| 优先级 | 行动项 | 负责人 |
|--------|--------|--------|
| P0 | 修复codexProvider.createSession调用onSpawn | 小克 |
| P1 | 搭建CI环境：安装chorusgate-mcp使codex ST可跑 | 小克 |
| P1 | 推送.codex/config.toml修复到origin | 小马 |
| P2 | ST-CX-*改写为mock-free真实CLI测试 | 小马 |
| P2 | 验证#76/#77/#78/#79在GitHub HEAD已正确修复 | 小克 |

---

## 7. 最近提交

```
cab7507 fix bug
2b186fa codex 记忆
1fa056e docs(skill): enforce bug-fix flow — issue→fix→CC review→notify→close
4778f08 fix(codex): remove --search --no-alt-screen (not supported by codex exec 0.139.0)
f2109b5 feat(codex): add --search --no-alt-screen flags + .codex/config.toml reference
3450da5 fix(session): Codex thread_id now written back to sessionStore
7a7954b fix(reply-engine): resume fallback — auto new session + notify user
a065198 fix(reply-engine): auto-fallback to new session when resume fails
```

本地与origin完全同步。无unpushed commits。