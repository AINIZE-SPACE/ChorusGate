# Issue Tracking - ChorusGate STORY-9 Code Review (xiaoma / 小马)

**Generated:** 2026-06-13
**Branch:** `v3/story-8-claude-stream-json`
**Reviewer:** xiaoma (小马)
**Review Doc:** [REVIEW-STORY9-2026-06-13-xiaoma.md](./REVIEW-STORY9-2026-06-13-xiaoma.md)
**关联 Epic:** #40 (STORY-9 MCP Web API-only)
**关联 PR:** #39

---

## 概要

| 严重 | 发现 | 已修 | 待修 (本 PR) | 转 backlog |
| --- | ---: | ---: | ---: | ---: |
| P0 Critical | 2 | 0 | 2 | 0 |
| P1 High | 2 | 0 | 2 | 0 |
| P2 Medium | 2 | 0 | 0 | 2 |
| **总计** | **6** | **0** | **4** | **2** |

P0/P1 共 4 项需小克在本 PR 修完。P2 共 2 项转 sprint backlog，issue 仍由本表跟踪。

---

## Open — 本 PR 必修 (4 项)

### ISSUE-STORY9-P0-1: `.claude/mcp.json` 在本 PR 新增了 `MCP_SENDER_ONLY=1`
- **严重：** P0
- **文件：** `.claude/mcp.json:7`
- **症状：** 本 PR 把 server 从 `slack-socket` 改名为 `chorusgate` 时，主动 env 段新增了 `MCP_SENDER_ONLY: "1"` 一行。与 spec 验收第 6 条「文档不再把 `MCP_SENDER_ONLY` 作为主路径配置」直接矛盾。
- **修法：** 删 `.claude/mcp.json:7` 那一行（保留 SLACK_BOT_TOKEN / SLACK_APP_TOKEN）。改后与 `.claude/mcp.json.example` 一致。
- **测试：** `grep -n MCP_SENDER_ONLY .claude/mcp.json` → 0 处。
- **GitHub issue：** #41
- **状态：** Open

### ISSUE-STORY9-P0-2: `.claude/mcp.json` 用 Windows-only `cmd /c` 封装，与 `docs/feature-mcp-server.md` 文档不一致
- **严重：** P0
- **文件：** `.claude/mcp.json:3-4` vs `docs/feature-mcp-server.md`
- **症状：** 实际配置 `"command": "cmd", "args": ["/c", "chorusgate-mcp"]`，文档示例 `"command": "chorusgate-mcp", "args": []`。Mac/Linux 照文档抄会启动失败。
- **修法（二选一）：**
  - (A) 推荐：`.claude/mcp.json` 改成跨平台 `"command": "chorusgate-mcp"`，与文档对齐。`bin/chorusgate-mcp.mjs` 已有 shebang，Unix 可直执。
  - (B) 若 Windows-only 是硬约束，更新文档写明 Windows wrapper 并加跨平台 TODO 注释。
- **测试：** 方案 A — `cat .claude/mcp.json` 与 `docs/feature-mcp-server.md` 文档示例逐字段比对；非 Windows dry-run `chorusgate-mcp --help`。
- **GitHub issue：** #42
- **状态：** Open

### ISSUE-STORY9-P1-1: 既有 REPORT-STORY9 测试计划 T1 系列未覆盖 `.claude/mcp.json` 配置文件 — P0-1 漏掉的根因
- **严重：** P1
- **文件：** `docs/tests/plans/PLAN-STORY9-2026-06-13-delez.md`
- **症状：** T1-1 ~ T1-7 全部针对 `src/`，无一条针对 `.claude/mcp.json` 或 `.claude/mcp.json.example`。T2-1 ~ T2-6 覆盖 README/INSTALL/architecture/gotchas 也未碰 `.claude/mcp.json`。spec 验收第 6 条明确"主路径配置"即 `.claude/mcp.json`，但被测试计划跳过。
- **修法：** PLAN 加：
  - T1-8: `.claude/mcp.json` 不含 `MCP_SENDER_ONLY` (`grep`)
  - T1-9: `.claude/mcp.json` 与 `.claude/mcp.json.example` server 列表一致
  - T2-7: `docs/feature-mcp-server.md` 配置示例与 `.claude/mcp.json.example` 字段一致
- **测试：** 三条新 case + 重跑 REPORT。
- **GitHub issue：** #43
- **状态：** Open

### ISSUE-STORY9-P1-2: `docs/feature-mcp-server.md` 工具表漏列第 8 个工具 `getSkillListTool`
- **严重：** P1
- **文件：** `docs/feature-mcp-server.md`「MCP Tools」表
- **症状：** 文档表 7 个工具；`src/index.ts` 工具数组实际 8 个（含本 PR 新加的 `getSkillListTool`）。doc drift。
- **修法：** doc 表加一行 `slack_get_skill_list`（或工具实际名）。
- **测试：** 数 `src/index.ts` tools 数组长度 vs 文档表行数，一致。
- **GitHub issue：** #44
- **状态：** Open

---

## Backlog — 转 sprint 后续 (2 项)

### ISSUE-STORY9-P2-1: `.claude/mcp.json` 含 `trello` server，但 `.claude/mcp.json.example` 没有
- **严重：** P2
- **修法：** example 加 trello 段（或从实际配置里删 trello）。
- **GitHub issue：** #45

### ISSUE-STORY9-P2-2: 三方配置文档不一致（实际 / example / feature doc）
- **严重：** P2
- **修法：** 单一 source of truth。
- **GitHub issue：** #46

---

## Resolved

(无 — 待小克修完后回填)

---

## 验证步骤 (小克改完自验)

1. `npm run typecheck` — 必须 0 error
2. `npm test` — 必须全绿 (61/61)
3. `grep -rn MCP_SENDER_ONLY .claude/ src/ bin/` — 必须 0 处
4. `cat .claude/mcp.json` 与 `docs/feature-mcp-server.md` 文档示例逐字段比对 — 一致
5. `cat .claude/mcp.json` 与 `.claude/mcp.json.example` diff — 仅敏感字段/注释差异
6. 数 `src/index.ts` tools 数组 vs `docs/feature-mcp-server.md` 工具表行数 — 一致

---

## Reviewer Sign-off

- [ ] P0/P1 修复方案已对齐小克
- [ ] 小克 verify 通过后由小马二次验收
- [ ] 合并到 dev → main

---

**Reviewer:** xiaoma (小马)
**生成时间:** 2026-06-13
