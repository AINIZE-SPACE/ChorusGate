# ChorusGate Project Daily Report - 2026-06-14

> 小马 (评审+测试) 视角
> 项目: AINIZE-SPACE/chorusgate (前身 slack4ccmcp)
> 命名规范: `REPORT-{version}-{YYYY-MM-DD}-{reviewer}.md`

---

## 1. 项目快照

| 项 | 值 | 备注 |
| --- | --- | --- |
| 默认分支 | `dev` @ `86be75b` | 2026-06-13 MERGE PR #39 后状态 |
| 进行中分支 | `v3/story-8-claude-stream-json` @ `64829f1` | 2026-06-14 23:13 Sprint 3 完整迭代报告后状态 |
| 开放 PR | PR #53 Sprint 3 工作 | 头版很大，需二次深 review |
| 项目名 | ChorusGate (前 slack4ccmcp) | pkg/manifest/bin 已 rename; Slack app display_name 仍 ClaudeCodeApp |
| 测试基线 | typecheck clean；`npm test` 本轮超时 | 早前记录为 106/106 pass；收口前需重跑或拆分定位 hang |
| 工作树 | `?? .claude/skills/chorusgate-env-vars/`, `?? docs/reports/REPORT-v3-2026-06-14-delez.md` | 今天新增日报和项目级 skill |

## 2. 今日活动 (按时间)

| 活动 | 交付 | 链接/位置 |
| --- | --- | --- |
| 迭代 3 测试 (本地) | typecheck 0 err + 60/60 → 106/106 (story-8 HEAD 实测) | local |
| M2 P0/P1 修复验收 (9 项) | 9/9 修法落码 + 测试覆盖 (来自 REVIEW-v3-2026-06-13 文档) | `docs/tests/REVIEW-v3-2026-06-13-delez.md` |
| GitHub 项目状态发现 | PR #39 MERGED (前认知是 OPEN); PR #53 是新活; 4 个 M2 follow-up issues (#36-#41) 全 CLOSED | REST 拉 issues / pulls / compare |
| 5 个 github-* skill 升级 | REST-first + silent-mode + LF | `D:\Users\delez\AppData\Local\hermes\skills\github\*` |
| 新 skill `silent-agent-workflow` (跨项目) | 8316 字节, 7 条不弹窗硬规则 + 决策树 | 同上 |
| 新 skill `chorusgate-env-vars` (项目级) | 4101 字节, 反例库 + 测试守门 + PR review checklist | `.claude/skills/chorusgate-env-vars/SKILL.md` |
| 日终收口 | Sprint 3 迭代报告 commit + 日报补全 + skill 规则校准 | `docs/reports/sprint-3-report.md`, 本文件, `.claude/skills/chorusgate-env-vars/SKILL.md` |
| GitHub auth setup | GITHUB_TOKEN 落到 `~/.hermes/.env` (chmod 600) | persistent, 跨 session 复用 |
| PR #53 review 提交 | 顶评 1 条 (COMMENT 事件, 因 token 是 PR author 拒 request-changes) | https://github.com/AINIZE-SPACE/ChorusGate/pull/53#pullrequestreview-4492971885 |

## 3. 发现 (按严重度)

### P0 - STORY-9 #41 closure 仍被违反 (1 处)

| 位置 | 内容 | 修法 |
| --- | --- | --- |
| `.mcp.json:10` | `"MCP_SENDER_ONLY": "1"` 仍在 env block | delete this line, grep 确认无 source 读它 |

**状态**: 已知 (用户在 #41 closure 时没删); 已写进 PR #53 顶评.

### P1 - Env var 早绑 bug 6 处 (M2 review 后漏的 follow-up)

ESM 静态 import 求值早于 `bootstrap()/loadEnv()`, 顶层 `const X = process.env.Y || default` 永远拿不到 `.env` 里的值. `1d7f1c1` 修了 `CLAUDE_PERMISSION_MODE` (7 处 inline), **没顺手扫全文 grep 同款**.

| 文件 | 行 | 反例 | 是否在 PR #53 diff |
| --- | --- | --- | --- |
| `src/providers/claude.ts` | 27 | `const CLAUDE_BIN = process.env.CLAUDE_BIN \|\| "claude"` | NOT in diff (pre-existing) |
| `src/providers/claude-stream.ts` | 44 | `const CLAUDE_BIN = ...` | NOT in diff |
| `src/providers/codex.ts` | 28 | `const CODEX_BIN = ...` | NOT in diff |
| `src/gateway.ts` | 51 | `const CLAUDE_CWD = ...` | NOT in diff |
| `src/gateway.ts` | 55 | `const REPLY_TIMEOUT_MS_LONG` | NOT in diff |
| `src/gateway.ts` | 73 | `const PROGRESS_ENABLED = ...` | NOT in diff |
| `src/gateway.ts` | 94 | `const STREAM_MODE = ...` | NOT in diff |

**修法** (同 `1d7f1c1` 模式): 删 const, 改 inline `process.env.X || default` 或函数内局部 const 共享.

**Regression test 影响**:

- `tests/reply-engine.test.ts:29-47` 设 `process.env.CLAUDE_BIN = nonexistent-claude-binary` 想让 spawn ENOENT fail-fast, 但因为 `claude.ts:27` / `claude-stream.ts:44` 是顶层 const, **这个 test 不会触发 ENOENT** - 跟测试意图相反, 在装了真 `claude` 的开发机会跑通. 修 env var bug 之后这个 test 才会真的 work.
- `tests/profile-config.test.ts:65-68` 测 `GATEWAY_CLAUDE_CWD` **能** 工作, 因为 `profile-config.ts` 的 `env()` 函数在调用时读 (PR #53 已修对).

### P2 - a4f05c1 partial fix

`gateway.ts:52` 顶层 `const REPLY_TIMEOUT_MS` 没删, 同时 `processEvent` 内有 inline `_replyTimeoutMs` 读 env. 全文 `REPLY_TIMEOUT_MS` 7 处使用, 5 顶层 2 inline, 双源并存. 维护者困惑.

**修法**: 删顶层 const, 全文统一一个来源 (函数内局部 const 共享).

### 已验证为真修的 Sprint 3 修复 (不需再 flag)

- `d43bfb1d` / `98a927e6` / `afdda47e` - P0 review fixes #49 #50 #51 #52 (identity rebase, auto-approval SessionIdentity key, env block restore, config unification)
- `f1c2287c` - spawn helpers 提取 (P2-2, P3-2)
- `2958e022` - permission dedup (P2-6)
- `9f34195f` - Windows backslash escaping (P3-4)
- `1a4ff8c3` - modal handler log (P3-5)
- `fdebfea8` / `dc0c3d4d` - InterruptManager 4 unit tests (含 race condition 覆盖)

## 4. 失败 / 阻塞 / 未做

### 阻塞

- **Inline review comments 422** - 8 个 env var const 行 NOT in PR #53 diff hunks (PR 没动那些行), GitHub API 拒. 唯一能行内评论的是 `.mcp.json:10` (在 diff). 已在顶评覆盖.
- **`npm test` 超时** - 2026-06-14 23:23 本地 `npm run typecheck` 通过；`npm test` 在 240s 超时，需拆成单文件定位是否为测试 hang 还是慢集成用例。

### 未做 (deferred, 等用户决策)

- env var 6 处实际修 + 写测试 + 提 commit 进 PR #53 (前一轮我推荐过, 用户没明确回)
- 删除 #4492970518 "Test" 占位 review (DELETE 也 422, 同样限制)
- 发 Slack 通知到 #所有-ainize (C0AHL7U33EE) - sprint-handoff skill 推荐, 用户没回
- 镜像 patched skills 到 `E:\my_project\ainize\dev-e2e-skills\domains\dev\` (按项目规则, 跨项目 skill 改动要同步; 本会话工具受限, 等下次)
- PR #53 头版 50 commit 没逐文件深读, 只 grep + spot-check (量大, 后续 sprint 收尾时再做深 review)

## 5. 教训 (留在 memory + skill)

### 上轮 M2 P0-3 trap (本人)

我"通过"了 P0-3 鉴权 fix, 只 grep 看到 `if (userId !== result.requesterUserId) return;` 就过. 实际 `handleAction()` 早就 `resolve(granted: true)` 了 promise, Claude 已收到审批. fix 是 UI cleanup, 不是 auth. 用户自己 #36 重发现, 修在 2b50780. **`github-code-review` Section 0** 已 codify 这个 lesson, 之前没贯彻, **下次 review 必先 load 这个 section 作为前置 checklist**.

### 今轮环境陷阱

- WSL `~` = `/home/delez`, Windows Python `~` = `D:\Users\delez`, **不互通** (反复 2-3 轮)
- skill_manage 写 .sh 到 Windows FS 出来 CRLF, bash source 爆 (`$'\r': command not found`), 需 `tr -d '\r'` 转 LF
- `node -e` / `python -c` 几乎必弹 safety popup
- 跨 FS path: Python 走 `D:\` 绝对, terminal bash 走 `/mnt/d/Users/delez/...`

## 6. 明天 / 下一步 (按优先级)

1. **修 env var 6 处 + 删 `.mcp.json:10` MCP_SENDER_ONLY=1 + 写 7 个 inline test** - 一个 commit 进 PR #53, 标题 `fix(env): inline-read 6+1 env vars, drop MCP_SENDER_ONLY, regression tests`
2. **拆分重跑测试** - 先定位 `npm test` 240s 超时原因，再恢复 106/106 全量基线
3. **PR #53 二次 review (深读, 含 interrupt / 4-button approval / plan tracker 逐文件)** - 50 commit, 之前只 spot-check
4. **镜像 patched skill 到 dev-e2e-skills/domains/dev** (按项目规则)
5. **Slack 通知发到 C0AHL7U33EE** (迭代 3 评审 + PR #53 review posted)

## 7. 元数据

- **作者**: delez911 (delez) - 项目作者 + Slack App bot 拥有者
- **审稿**: 小马 (本人, agent 角色) - 顶评已发
- **下一审稿人**: delez (自己), 是否需要第二审稿人账号?
- **关联 PR**: #53 (active), #39 (merged)
- **关联 issues (closed)**: #36 #37 #38 #41 #42 #43 #44 #45 #46 #47 #48 #49 #50 #51 #52 - Sprint 3 全 P0/P1 闭环
