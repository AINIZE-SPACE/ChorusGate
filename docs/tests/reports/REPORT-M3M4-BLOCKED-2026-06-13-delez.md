# Test Report — M3/M4 测试 BLOCKED

**Date:** 2026-06-13
**Reviewer:** delez (小马)
**Stated Branch:** v3/story-8-claude-stream-json @ 4a38535
**Stated Work:** STORY-3/4/6/7 + bug fix 38086f9
**Verdict:** BLOCKED — 分支内容与声明严重不匹配，无法执行 4 个 M3/M4 测试点

---

## 1. TL;DR

zederer 声称已完成 Sprint 3 M3/M4（STORY-3/4/6/7）+ bug fix 38086f9，请求测试验证 4 个点。
我对照声明与实际分支内容，发现**声明的功能在当前分支中全部不存在**：

- 关键标识符（SessionIdentity / GATEWAY_PROFILES / /cc_new --project / SLACK_BOT_TOKEN_CC）在 src/ 和 .env.example 中 **0 处命中**
- git log --all | grep 38086f9 → **无结果**
- 5 个相关 issue（#24, #25, #27, #28, #30）全部 **OPEN** 状态
- 测试数 60/60 与实际 44/44 偏差

**结论：要么分支 push 错位置，要么 M3/M4 work 还在本地未 push。** 我不会假装测试不存在的功能，不会编造 4 个测试点的通过/失败结果。

---

## 2. 已执行的客观验证

### 2.1 环境

| 项 | 值 |
| --- | --- |
| 工作目录 | E:\my_project\ainize\ChorusGate_Test |
| 分支 | v3/story-8-claude-stream-json (tracking origin/v3/story-8-claude-stream-json) |
| HEAD | 4a38535 Rename project to ChorusGate and generalize multi-agent gateway |
| 远端 | https://github.com/AINIZE-SPACE/ChorusGate.git |
| Node modules | npm install 重新安装（128 packages, 16s） |

### 2.2 基线（声明的 60/60 vs 实际 44/44）

    $ npm run typecheck
    > tsc --noEmit
    (clean, no output)

    $ npm test
    ℹ tests 44
    ℹ pass 44
    ℹ fail 0
    ℹ duration_ms 1973.75

8 个 .test.ts 文件全部通过：claude-stream-integration / claude-stream-parser / claude-stream-session / event-store / permission-tracker / reply-engine / session-store / socket-manager-block-actions

**delta：** 声明 60/60，实际 44/44，差 16 个测试。可能解释：
- (a) zederer 在开发机加了 16 个新测试但未 push（最可能）
- (b) 老的 60/60 包含 sprint-2 测试，sprint-3 重构后删了 16 个

### 2.3 关键标识符搜索（核心证据）

    $ grep -rn SessionIdentity src/ tests/
    (no matches)

    $ grep -rn GATEWAY_PROFILES src/ tests/ .env.example
    (no matches)

    $ grep -rn cc_new --project src/ bin/
    (no matches)

    $ grep -rn PROFILES src/
    (no matches)

    $ grep -rn multiApp src/
    (no matches)

### 2.4 .env.example 内容（确认无多 profile 支持）

    # Slack App Token (xapp-...) — for Socket Mode WebSocket connection
    SLACK_APP_TOKEN=***
    # Slack Bot Token (xoxb-...) — for Web API calls
    SLACK_BOT_TOKEN=***

文件中只有单一的 SLACK_APP_TOKEN / SLACK_BOT_TOKEN，无 _CC / _CODEX 后缀，无 GATEWAY_PROFILES 行。

### 2.5 分支变更范围（vs main）

    src/providers/claude-parser.ts              |  49 +++
    src/providers/claude-stream-parser.ts       | 133 ++++++
    src/providers/claude-stream.ts              | 407 +++++++++++++++++
    src/providers/claude.ts                     | 234 ++++++++++
    src/providers/codex-parser.ts               |  96 ++++
    src/providers/codex.ts                      | 166 +++++++
    src/providers/types.ts                      | 132 ++++++
    src/reply-engine.ts                         | 372 +++++-----------
    src/session-commands.ts                     |  106 +++--
    src/session-store.ts                        |  49 ++-
    src/socket-manager.ts                       |  86 +++-
    test-timeout.mjs                            | 214 +++++++++
    tests/claude-stream-integration.test.ts     | 247 +++++++++++
    tests/claude-stream-parser.test.ts          | 157 ++++++
    tests/claude-stream-session.test.ts         |  77 ++++
    tests/permission-tracker.test.ts            | 162 +++++++
    tests/reply-engine.test.ts                  | 208 +++++++++
    80 files changed, 5875 insertions(+), 773 deletions(-)

变更集中在 src/providers/* (STORY-1/2/8) + stream-json 相关。没有任何：
- src/socket-manager.ts 的多 SocketModeClient 重构（仅 +86 行，是 stream-json 适配）
- src/session-store.ts 的 SessionIdentity 改造（仅 +49 行）
- src/session-commands.ts 的 --project flag（+106 行是 slash command 路由）

### 2.6 GitHub issue 状态（2026-06-13 通过 gh 核实）

| Issue | 标题 | State |
| --- | --- | --- |
| #24 | [Feature] 多 Slack App Socket Mode — 多 SocketModeClient 实例 | OPEN |
| #25 | [Feature] 会话级多项目支持 — sessionStore.projectDir | OPEN |
| #27 | [Feature] 多 Agent/多 App 配置系统 — GATEWAY_PROFILES | OPEN |
| #28 | [Feature] Codex Slack MCP Tools — TOML 配置生成 | OPEN |
| #30 | [Decision] Use cc/codex Slack profiles with independent Socket Mode tokens | OPEN |

5 个 issue 全部 OPEN，关联 PR = 0。

---

## 3. 4 个 M3/M4 测试点 — 全部 NOT TESTABLE

| # | 测试点 | 状态 | 原因 |
| --- | --- | --- | --- |
| T1 | 单 profile 启动 → 向后兼容 | 部分可测 | GATEWAY_PROFILES 不存在 → 单 profile 是当前唯一路径，等于无变化。可跑 npm start 验证基线，但测的是 M2 (story-8) 不是 M3 |
| T2 | GATEWAY_PROFILES=cc,codex → 两 Socket Mode 独立 | NOT TESTABLE | socket-manager.ts 仍是单例 let socketClient: SocketModeClient \| null，没有 Map<appId, ...> |
| T3 | resume 不报 No conversation found | NOT TESTABLE | SessionIdentity 类型不存在，session-store.ts 没有 key migration 逻辑 |
| T4 | /cc_new --project <dir> | NOT TESTABLE | session-commands.ts 没有 --project flag 解析，slash command router 不知道这个参数 |

---

## 4. 修复指引（zederer 后续动作）

请 zederer 三选一：

### 选项 A — M3/M4 已在另一个分支
- 给出真实分支名（v3/story-3-* / v3/story-4-* / feature/... / 等等）
- 确认 git push 已执行
- 我 git fetch --all 后切过去重跑 4 测试点

### 选项 B — M3/M4 实际未完成
- 接受 M2 (story-8) baseline (44/44 + typecheck clean) 是当前可交付的
- 我把未达测试目标作为 blocker 反馈，不会编造测试通过报告
- 等 M3/M4 实做后再走一次测试流程

### 选项 C — push 错仓库 / 本地未 push
- 检查 git remote -v 是否指向正确的 AINIZE-SPACE/ChorusGate
- 检查 git reflog | grep 38086f9 是否能找回丢失的 commit
- 若有，git push origin <correct-branch> 后告诉我

---

## 5. 我**没**做的事（避免误解）

- ❌ 没编造 T1-T4 的通过/失败结果
- ❌ 没在 Slack 上 @-mention 用户说测试通过
- ❌ 没把 #24 #25 #27 #28 #30 issue 关闭
- ❌ 没创建新的 REVIEW-M3M4-*.md（不是 code review，是 test pass，但根本测不了）
- ❌ 没修改 zederer 任何代码

我只做了机械验证（grep / git log / gh issue view / npm test），没做任何主观判断 — 全部是 git 真实输出。

---

## 6. 附：M2 (story-8) 实际可交付状态（顺便报告）

- npm run typecheck — clean ✓
- npm test — 44/44 pass ✓
- 上次 code review 报告 docs/tests/REVIEW-v3-2026-06-13-delez.md 显示 M2 全部 P0/P1 (9 项) 已修，P2/P3 (11 项) 转 backlog
- 可考虑：把 M2 合并到 dev → main，与 M3/M4 解耦推进

---

**Reporter:** 小马 (delez)  
**Date:** 2026-06-13  
**Status:** BLOCKED — 等待 zederer 澄清分支
