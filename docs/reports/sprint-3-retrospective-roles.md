# ChorusGate v3 迭代回顾：按角色复盘

> **日期**: 2026-06-13 ~ 2026-06-16
> **分支**: `v3/story-8-claude-stream-json`
> **角色**: 小克（开发）/ 小马（评审+测试）/ 小扣（Codex 管理）
> **关联**: [sprint-3-retrospective.md](./sprint-3-retrospective.md)（小马评估视角）

---

## 一、迭代目标 vs 实际交付

**目标**: 把 ChorusGate 从"单 Claude Code Slack bot"扩展为"多 AI agent + 多 Slack App + 多项目"的通用协作网关。

**实际交付**:

| 里程碑 | 计划 | 结果 |
|--------|------|------|
| M0 验证 Spike | 真实运行 `codex exec --json` 并固化 fixture | ✅ 完成，Codex JSONL/resume/MCP fixture 就绪 |
| M1 双 Agent 核心 | Provider 抽象 + Codex Provider + 统一 Session | ✅ 完成 |
| M2 Claude 双向 stream-json | 双向 JSON 管道 + 4-Button Approval | ✅ 完成 |
| M3 多 Slack App | SocketManager 多实例 + `GATEWAY_PROFILES` | ✅ 完成 |
| M4 多项目 + Slack 工具 | SessionIdentity + per-profile token 注入 | ✅ 完成 |

**量化结果**:
- 52 个 issue 关闭（含 12 项 P0/P1 安全/质量修复）
- 23+ commits
- 100+ 测试用例通过（UT）
- ST 20 用例，16/20 PASS (80%)
- TypeScript 零错误
- 沉淀技能 2 个（chorusgate-st-windows + chorusgate-bug-reopen）
- 新识别待修 P0 bug 2 个（load-env find-up + codex onSpawn）

---

## 二、角色分工复盘

### 2.1 小克 — 开发主力

**承担工作**:
- 实现 `AgentProvider` 抽象层（`src/providers/types.ts`）
- 实现 `ClaudeStreamProvider` 双向 stream-json（`src/providers/claude-stream.ts`）
- 实现 `CodexProvider` JSONL spawn + resume（`src/providers/codex.ts`）
- 实现 `SocketManager` 多 Slack App 实例
- 实现 `SessionIdentity` 结构化 key
- 4-Button Approval UI + `permissionTracker`
- InterruptManager 中断/队列
- 修复 stream-json 4bug（#88~#91）
- 修复 onSpawn 回调（#81，commit b1c2deb）
- 独立 Slack App manifest（#83）+ 统一审批方案（#84）

**做得好的**:
- 大型功能拆分清晰：先抽象接口，再补实现，最后补测试
- 安全修复响应快：#76~#79 reopen 后 24h 内确认 fix 在 GitHub HEAD
- stream-json 双向管道 + 4-button approval 一次性完成（#88~#91）
- 主动设计降级方案（`StreamUpdate` 统一接口）应对 Codex CLI 能力缺口

**待改进**:
- **partial fix 习惯**: env var 改了但未全文扫描同模式，导致残留
- **测试入口覆盖不足**: `shouldReply`、routing options 等入口函数长期无集成测试，#76/#79 因此漏测
- **Windows shell 转义**: #78 backslash-doublequote、#69 cmd metacharacter 都是事后补漏

**给小克的下轮纪律**:
1. 任何 env bug fix 必须满足：改前 `rg`、改后 `rg`、回归测试覆盖
2. 新增/修改入口函数必须同时新增从真实入口触发的 ST
3. 涉及 spawn/CLI flag 的修改，必须验证子命令 flag 位置

---

### 2.2 小马 — 评审 + 测试

**承担工作**:
- 编写并执行 Sprint 3 ST 计划（20 用例，16/20 PASS）
- 重新打开并验证 #76~#79 4 个 bug（确认 fix 在 GitHub HEAD）
- 产出评估报告：REVIEW-v3-2026-06-13、BugReopen 报告、ST 报告
- 发现 #81 codexProvider.onSpawn 未调用（新 P0）
- 发现 load-env `find-up` 遍历 bug（新 P0）
- 清理 `.codex/config.toml` merge conflict marker
- 沉淀 `chorusgate-st-windows` + `chorusgate-bug-reopen` 技能

**做得好的**:
- 评估视角独立：能从 PR diff 外发现"不在 diff 内"的隐患（env var 顶层 const、入口函数零覆盖）
- 工具链 resilience 强：WSL DNS 不稳定 + terminal 损坏时，切换到 GitHub REST API + Python subprocess 继续工作
- 把 bug 反模式抽象成可复用技能（fake binary、env var 早绑规范）
- 发现 4 类测试 Anti-Patterns 并写入 skill（routing silently ignored / CLI subcommand flag / Windows shell quoting / gateway entry 无 ST）

**待改进**:
- **ST 环境依赖**: `codex-integration.test.ts` 6/6 失败因为 MCP server 未启动，环境依赖未解耦
- **假阴**: provider-routing ST 因 #81 失败，但 #81 是代码 bug 而非测试设计问题 → ST 本身没错，但报告未区分"环境 bug"和"代码 bug"
- **测试超时定位慢**: `npm test` 240s 超时未能快速定位是 hang 还是慢用例

**给小马的下轮纪律**:
1. 每个 ST 用例必须标注"需要真实 CLI" vs "fake binary 即可"，并在 CI 中分组
2. 报告区分"代码缺陷"和"环境依赖"，避免混淆
3. 环境依赖（MCP server）必须有启动脚本或 mock 降级方案

---

### 2.3 小扣 — Codex 管理（本会话）

**承担工作**:
- 主持 Sprint 3 收尾：回顾、技能沉淀
- 读取并整合多份报告（小马评估、delez 日报、ST 报告、BugReopen 报告）
- 按 `reflection-skill-evolution` 分层规则决定技能归属（project-local vs 个人技能）
- 更新/新建项目技能，把可复用模式写入个人 skills

**做得好的**:
- 直接复用现有技能框架（`skill-creator`、`sprint-handoff`），不另造流程
- 把"管理动作"本身也输出为可追溯文档与技能
- 识别 load-env find-up bug 并 defer v4（P0）

**待改进**:
- 介入时间偏晚：env var、入口测试等问题在开发中后期才集中暴露
- 对小克的过程检查点不足：未在早期强制"改前 rg / 改后 rg"
- 跨 runtime 记忆同步依赖人工：小马的 session、小克的 project memory、小扣的 skill 尚未自动对齐

**给小扣的下轮纪律**:
1. 每个 story 启动时先 load `chorusgate-st-windows` + `sprint-handoff`，作为前置 check
2. 每个安全/Env bug fix 必须 review"改前 rg 截图 + 改后 rg 截图"
3. 迭代中点增加一次"入口函数 ST 覆盖"检查，不等到收尾

---

## 三、跨角色协作瓶颈

| 瓶颈 | 影响 | 改进方案 |
|------|------|----------|
| 本地分支落后于 GitHub HEAD | #76~#79 reopen，fix commit 已在远端但本地未合并 | 每日启动时先 `git fetch` + 比对 HEAD；WSL DNS 不稳时切 REST API |
| env var 规范知而不行 | 同一类 bug 反复出现 | 把 `chorusgate-env-vars` 设为开发前置必 load 技能 |
| 入口函数缺少 ST | routing、shouldReply 等 bug 漏到 ST | 新增"新增入口必加 ST"门禁 |
| MCP server 环境依赖 | ST-CX-* 无法跑 | 提供 `npm run test:integration` 启动脚本或降级 mock |
| 工具链阻塞 | terminal workdir bug + execute_code 安全弹窗双杀 | Python subprocess workaround，WSL DNS 不稳时用 REST API |

---

## 四、技能沉淀清单

### 已存在（v3 期间沉淀）
- `.claude/skills/sprint-handoff` — 开发完成交接流程
- `chorusgate-env-vars` — ESM 环境下 env var 安全读取规范

### 本次新建/更新
- `chorusgate-st-windows` — terminal 损坏时用 Python subprocess 跑 ST（PATH 注入、tsx 路径、GitHub REST API 后备）
- `chorusgate-bug-reopen` — closed bug 实为未修复时的标准流程（GitHub REST 验证 -> 对比本地 -> 发 comment -> Slack 通知）

### 抽到 summit-saw domain
- `summit-saw/domains/dev/chorusgate-st-windows` — 可迁移到其他 Windows+Node 项目
- `summit-saw/domains/dev/chorusgate-bug-reopen` — 可迁移到其他 GitHub 项目

---

## 五、下迭代（v4）关键行动

| 优先级 | 行动 | 负责角色 |
|--------|------|----------|
| P0 | load-env `find-up` 避免遍历到相邻项目 `.env` | 小克 |
| P0 | 完成 #81 `opts.onSpawn` 修复并 push（b1c2deb 待 rebase） | 小克 |
| P0 | 清理剩余 env var 顶层 const | 小克 |
| P1 | MCP server 启动脚本 / mock 降级 | 小克 |
| P1 | 拆分 `npm test` 并定位 240s 超时根因 | 小马 |
| P1 | Codex 双向批准协议研究（v4 #84） | 小克 + 小马 |
| P2 | 跨 runtime skill 同步机制（自动 mirror） | 小扣 |

---

**生成日期**: 2026-06-16
**作者**: 小马（评审+测试角色）
