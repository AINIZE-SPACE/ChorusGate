# Test Plan — M3/M4 测试请求 (ChorusGate Sprint 3)

**Generated:** 2026-06-13
**Author:** delez (小马)
**Stated Branch:** `v3/story-8-claude-stream-json`
**Stated Work:** STORY-3/4/6/7 + bug fix `38086f9`
**Related Issues:** #24 (STORY-3), #25 (STORY-4), #27 (STORY-6), #28 (STORY-7), #30 (Decision)

---

## ⚠️ 阻塞 — 分支与声明不一致

在执行测试前，对照"声明内容"与"分支实际内容"做 sanity check，发现**严重不匹配**：

| 声明项 | 声称 | 实际（`v3/story-8-claude-stream-json` @ `4a38535`） |
| --- | --- | --- |
| Stories 范围 | STORY-3/4/6/7 (M3/M4) | 分支内容是 **STORY-8 (M2 Claude 双向 stream-json)** |
| Bug fix commit | `38086f9` SessionIdentity key 迁移 | **所有 git 历史中均无此 SHA**（`git log --all | grep` 无结果） |
| SessionIdentity | 已实现 | `grep -r SessionIdentity src/ tests/` → **0 处** |
| `GATEWAY_PROFILES` | 已实现 | `grep -r GATEWAY_PROFILES` → **0 处** |
| `/cc_new --project <dir>` | 已实现 | `grep -rn "cc_new\|--project" src/ bin/` → **0 处** |
| `SLACK_BOT_TOKEN_CC` 后缀 | 已支持 | `.env.example` 仍是单一 `SLACK_BOT_TOKEN=***` |
| 测试数 | 60/60 通过 | 实际 **44/44 通过**（8 个 .test.ts 文件） |

**因此：** 4 个 M3/M4 测试点（单 profile 向后兼容 / `GATEWAY_PROFILES=cc,codex` / resume SessionIdentity / `/cc_new --project`）在当前分支上**没有可测对象**。`git diff main..v3/story-8-claude-stream-json --stat` 显示本分支仅 5875+/773-，且全部集中在 `src/providers/*` (Claude/Codex Provider) + `src/reply-engine.ts` + `src/permission-tracker.ts` + `src/socket-manager.ts` 的 stream-json 支持。

**对应 GitHub issue 状态（通过 `gh issue view` 确认，2026-06-13）：**

| Issue | 标题 | State |
| --- | --- | --- |
| #24 | [Feature] 多 Slack App Socket Mode — 多 SocketModeClient 实例 | OPEN |
| #25 | [Feature] 会话级多项目支持 — sessionStore.projectDir | OPEN |
| #27 | [Feature] 多 Agent/多 App 配置系统 — GATEWAY_PROFILES | OPEN |
| #28 | [Feature] Codex Slack MCP Tools — TOML 配置生成 | OPEN |
| #30 | [Decision] Use cc/codex Slack profiles with independent Socket Mode tokens | OPEN |

5 个相关 issue **全部 OPEN**，没有任何"已合并 PR"或"close 引用"。

---

## 测试范围（声明，本计划原本想测的）

按 zederer 声明的 4 个测试点：

| # | 测试点 | 验收命令 | 期望 |
| --- | --- | --- | --- |
| T1 | 单 profile 启动 → 行为与 v2 完全一致 | `npm start` + 旧 .env（无 `GATEWAY_PROFILES`） | socket manager 走单实例路径 |
| T2 | `GATEWAY_PROFILES=cc,codex` → 两个 Socket Mode 独立 | `GATEWAY_PROFILES=cc,codex npm start` | `Map<appId, SocketModeClient>` 大小 = 2 |
| T3 | resume 不会报 "No conversation found" | session store 写入旧格式 key → 调用 `load()` → 验证 key 改写 | key 迁移到新 `SessionIdentity` 格式 |
| T4 | `/cc_new --project E:\other-dir` → 下条消息用新 cwd | 模拟 Slack slash command payload → 验证 `reply-engine` 收到 `projectDir` | spawn `claude -p` 时 cwd 为指定目录 |

---

## 方法学

1. **环境与基线** — `git status` / `git log --oneline -10` / `npm install` / `npm run typecheck` / `npm test`
2. **声明核对** — 用 `grep` 搜索关键标识符（SessionIdentity / GATEWAY_PROFILES / cc_new / --project / 38086f9），与 zederer 描述逐项对照
3. **GitHub issue 状态核对** — `gh issue view <N>` 确认 #24/#25/#27/#28/#30 状态
4. **分支内容核对** — `git diff main..HEAD --stat` 列出所有变更文件，验证 story-3/4/6/7 范围代码
5. **若环境/代码匹配** — 执行 T1-T4 集成测试（mock Slack 事件 / 写测试 .ts 文件）
6. **若不匹配（当前情况）** — 停止，提交 blocker 报告，等 zederer 澄清

---

## 风险区

- **R1 — 分支混用**：zederer 可能误把 M2/story-8 分支当作 M3/M4 分支移交（最可能）  
- **R2 — 未 push**：M3/M4 work 在本地 `feature/...` 分支，未 push 到 origin
- **R3 — push 到错目标**：push 到了 `AINIZE-SPACE/chorusgate` 而非 `AINIZE-SPACE/slack4ccmcp`（或反之）
- **R4 — 测试数对不上**：60/60 与实际 44/44 偏差，可能 zederer 在自己的开发机跑了**未 push 的新测试** + 旧的 M2 baseline

---

## 下一步

等 zederer 澄清后，二选一：
- **A)** 给出真正的 M3/M4 分支名 → 我切过去重跑 4 测试点
- **B)** 确认 M3/M4 还没开始 → 我把当前可验证的 M2/story-8 baseline 写成独立报告

---

## 备注：M2/story-8 当前分支的健康状态（部分验证）

- `npm run typecheck` — **clean** ✓
- `npm test` — **44/44 pass** (8 个 .test.ts)
- 不依赖未实现的 M3/M4 功能
- 上一次完整代码评审见 `docs/tests/REVIEW-v3-2026-06-13-delez.md` (M2 Claude stream-json)，P0/P1 全部本 PR 修完
