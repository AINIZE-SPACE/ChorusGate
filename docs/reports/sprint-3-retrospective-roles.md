# ChorusGate Sprint 3 — 按角色复盘

> **日期**: 2026-06-16 | **分支**: `v3/story-8-claude-stream-json` → `dev` → `main`

---

## 小克 (U0B8VHLHJAX) — 设计+开发

### 完成

- **STORY-1~8** 全链路实现：Provider 抽象 → Codex Provider → 多 Slack App → SessionIdentity → 配置系统 → Codex MCP → Claude stream-json
- **91 个 Issues** 从创建到关闭的完整生命周期
- **35+ commits**，20+ 新文件，40+ 文件修改
- Codex CLI v0.139.0 参数对齐（6 个实测 flag，3 个被排除）
- M3 流式增量：`--include-partial-messages` + `stream_event` 拆包

### 踩坑 Top 3

1. `stream_event` 拆包 4 次才修好 — fixture 没 mock 真实格式
2. `super.feed(rawLine)` vs `JSON.stringify(evt)` — 一行代码挂掉整个流式
3. SessionIdentity key 迁移 — `load()` 旧 key 未重写，session 全部丢失

### 改进

- 新功能必须先抓真实 CLI 输出写 fixture
- CLI flag 必先 `scripts/verify-codex-cli.mjs` 实测
- 修完 bug 必须走完整流程：提单→修→测→通知→关

---

## 小马 (U0B91BVKTL2) — 评审+测试

### 贡献

- **Code Review**: 发现 20 项 findings（P0 4项 + P1 5项 + P2 6项 + P3 5项）
- **回归验证**: 多次发现阻塞性 bug 并推动修复
- **Hermes Agent 集成**: 诊断并修复 Hermes 对 bot message 的过滤问题
- **Slack mention 通知排查**: 根因定位到 `link_names:true` + top-level text

### 反馈给开发

- 多次强调"先提单再修，修完通知"流程
- 指出 `unfurl_*` 是 placebo fix
- 要求 fixture 必须对齐真实 CLI 输出
- 要求 gateway 侧不能让人设硬编码

---

## 乐老板 (U0AHDRREVPD) — Master指挥家

### 输入

- Sprint 3 目标设定和优先级排序
- 多 gateway 实例并行需求（CC + Codex 同时运行）
- 身份分离决策：Gateway 不做人设，CLAUDE.md 归 CC，AGENTS.md 归 Codex
- 迭代收尾：Issue 清理、文档迁移、PR 合并

### 关键决策

1. Gateway = 代理层，不设身份——由 Provider 的人设文件决定
2. Codex 作为独立 Slack App（ChorusGate CX）运行，slash 前缀 `/cx_`
3. Sprint 3 完成后，剩余 v3 规划文档移至 `reference/v3-stories/`，待实现文档改名 v4 前缀

---

## 迭代协作总结

| 角色 | 产出 | 关键反馈 |
|------|------|---------|
| 小克 | 代码实现 | 需加强自测纪律 |
| 小马 | 评审+测试 | 流程执行力需提升 |
| 乐老板 | 方向+决策 | 架构边界清晰化 |

### 下迭代改进

- [ ] 开发自测：`npm test` + CLI verify 前置
- [ ] 流程纪律：提单→修→测→通知→关，一步不少
- [ ] 评审时效：代码推送后 4h 内完成 review
- [ ] 文档同步：新功能文档随代码一起提交
