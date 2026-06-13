# Review Report — STORY-9 (MCP Web API-only 收口)

**Date:** 2026-06-13
**Reviewer:** xiaoma (小马)
**Branch:** `v3/story-8-claude-stream-json` @ `f38eafa` (STORY-9 commit)
**PR:** #39 | **Epic Issue:** #40
**关联 test report:** `REPORT-STORY9-2026-06-13-delez.md` (Verdict: PASS)
**Verdict:** ❌ **CHANGES_REQUESTED** — 2 P0 + 2 P1 必修，P2 转 backlog

---

## 1. TL;DR

与既有 test report (delez, Verdict: **PASS**) **判定不一致**：本评审发现 **6 项缺陷 (P0×2 / P1×2 / P2×2)**，其中 **P0-1** 严重违反 STORY-9 收口目标 — `.claude/mcp.json` 在本 PR **主动新增**了 `MCP_SENDER_ONLY=1`。test plan 覆盖盲点 (T1 系列只扫 `src/`，从未检查 `.claude/`) 是 P0-1 漏判的根因。

**结论：dev (小克) 需修 P0-1 / P0-2 / P1-1 / P1-2 才能合 PR。**

---

## 2. 与 test report 差异

| 维度 | Test report (delez) | Review (xiaoma, 本报告) |
| --- | --- | --- |
| Verdict | ✅ PASS | ❌ CHANGES_REQUESTED |
| 缺陷数 | 0 | 6 (2 P0 + 2 P1 + 2 P2) |
| `.claude/mcp.json` 检查 | ❌ 未覆盖 | ✅ P0-1 命中 |
| spec 验收第 6 条 | 标"满足" | 实际**违反** |
| 测试基线 | 61/61 | 61/61 (一致) |

test report 的 PASS 是因 T1 系列测试用例**只覆盖 `src/`**，**未覆盖** `.claude/mcp.json` 配置文件本身 — 而 spec 验收第 6 条「文档不再把 `MCP_SENDER_ONLY` 作为主路径配置」中"主路径配置"指的就是该文件。覆盖盲点 → 真实 P0 漏判。

---

## 3. 发现汇总 (6 项，全部已提 GitHub issue)

| 严重 | 标题 | Issue | 状态 |
| --- | --- | ---: | --- |
| 🔴 P0-1 | `.claude/mcp.json` 新增 `MCP_SENDER_ONLY=1`，违反 STORY-9 收口 | #41 | 必修 |
| 🔴 P0-2 | `.claude/mcp.json` Windows-only `cmd /c` 与文档跨平台不一致 | #42 | 必修 |
| 🟠 P1-1 | test plan 覆盖盲点：T1 系列未扫 `.claude/mcp.json` (P0-1 漏判根因) | #43 | 必修 |
| 🟠 P1-2 | `feature-mcp-server.md` 工具表缺第 8 个 `getSkillListTool` | #44 | 必修 |
| 🟡 P2-1 | `.claude/mcp.json` 含 `trello` 但 `.example` 没有 | #45 | backlog |
| 🟡 P2-2 | 三方配置文档不一致 (actual / example / doc) | #46 | backlog |

- 详细 review: `docs/tests/REVIEW-STORY9-2026-06-13-xiaoma.md`
- 跟踪表: `docs/tests/ISSUES-STORY9-2026-06-13.md`
- Issue bodies: `docs/tests/issue-bodies/B` (6 文件)

---

## 4. 关键发现详解 (P0-1)

`.claude/mcp.json` 在本 PR 改 server 名 `slack-socket` → `chorusgate` 的同时，env 段**主动新增**了一行 。

**为何是 P0：**
1. **直接违反** STORY-9 spec 验收第 6 条「文档不再把 `MCP_SENDER_ONLY` 作为主路径配置」 — `.claude/mcp.json` 正是"主路径配置"
2. 当前 `src/index.ts` 已删 sender-only 代码分支（即便 env 不会激活行为），但**配置与代码收口目标矛盾**
3. 未来若加回 sender-only 行为，env 自动激活，破坏 Web API-only 边界
4. `.claude/mcp.json.example` 已无此字段 — **三方不一致**（实际 / example / 文档收口声明）

**修复：** 删该行。**验收：**  → 0 处。

（完整 diff 证据见 `docs/tests/REVIEW-STORY9-2026-06-13-xiaoma.md` P0-1 节）

---

## 5. 验证日志

```text
$ npm run typecheck
> tsc --noEmit
PASS

$ npm test
ℹ tests 61
ℹ pass 61
ℹ fail 0
ℹ duration_ms 989.4

$ grep -rn MCP_SENDER_ONLY src/ bin/      → 0 处
$ grep -rn MCP_SENDER_ONLY .claude/       → 1 处 (.claude/mcp.json:7)  ← P0-1
$ grep -rn MCP_SENDER_ONLY docs/          → 仅 spec + test artifacts (合规)

$ grep -n SocketMode|WebSocket src/index.ts   → 0 处
$ grep -rn slack_check_events src/            → 0 处
$ ls src/tools/check-events.ts                → 不存在 ✓
```

---

## 6. 下一步 (小克 action items)

- [ ] 修 P0-1：删 `.claude/mcp.json:7` `MCP_SENDER_ONLY` 行
- [ ] 修 P0-2：统一命令格式 (选 A 跨平台 `chorusgate-mcp` 或 B 文档同步 Windows)
- [ ] 补 P1-1：扩 PLAN + REPORT 覆盖 `.claude/mcp.json` (T1-8/T1-9/T2-7)
- [ ] 补 P1-2：`feature-mcp-server.md` 工具表加 `slack_get_skill_list`
- [ ] P2-1 / P2-2 转 sprint backlog
- [ ] 重跑  +  (需仍 61/61)
- [ ] 小马二次验收 → 合 dev → main

---

## 7. Reviewer Sign-off

- [x] P0/P1 已对齐小克 (issue #41–#44 已提)
- [ ] 小克 verify 通过后由小马二次验收
- [ ] 合 dev → main

---

**Reviewer:** xiaoma (小马)
**生成时间:** 2026-06-13
