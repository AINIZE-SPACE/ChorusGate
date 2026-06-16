 # ChorusGate v3 迭代回顾：按角色复盘

 > **日期**: 2026-06-13 ~ 2026-06-16
 > **分支**: `v3/story-8-claude-stream-json` → 即将合并入 `dev`
 > **角色**: Claude Code（开发）/ Hermes（测试）/ Codex（管理，即本会话）
 > **关联**: [sprint-3-retrospective.md](./sprint-3-retrospective.md)（小马评估视角）

 ---

 ## 一、迭代目标 vs 实际交付

 **目标**: 把 ChorusGate 从“单 Claude Code Slack bot”扩展为“多 AI agent + 多 Slack App + 多项目”的通用协作网关。

 **实际交付**:

 | 里程碑 | 计划 | 结果 |
 |--------|------|------|
 | M0 验证 Spike | 真实运行 `codex exec --json` 并固化 fixture | ✅ 完成，Codex JSONL/resume/MCP fixture 就绪 |
 | M1 双 Agent 核心 | Provider 抽象 + Codex Provider + 统一 Session | ✅ 完成 |
 | M2 Claude 双向 stream-json | 双向 JSON 管道 + 4-Button Approval | ✅ 完成（原计划 M4，提前到 M2） |
 | M3 多 Slack App | SocketManager 多实例 + `GATEWAY_PROFILES` | ✅ 完成 |
 | M4 多项目 + Slack 工具 | SessionIdentity + per-profile token 注入 | ✅ 完成 |

 **量化结果**:
 - 52 个 issue 关闭（含 12 项 P0/P1 安全/质量修复）
 - 23+ commits
 - 100+ 测试用例通过
 - TypeScript 零错误
 - 沉淀项目技能 2 个，新识别需沉淀技能 2-3 个

 ---

 ## 二、角色分工复盘

 ### 2.1 Claude Code — 开发主力

 **承担工作**:
 - 实现 `AgentProvider` 抽象层（`src/providers/types.ts`）
 - 实现 `ClaudeStreamProvider` 双向 stream-json（`src/providers/claude-stream.ts`）
 - 实现 `CodexProvider` JSONL spawn + resume（`src/providers/codex.ts`）
 - 实现 `CodexEventParser` 实时 `onText` / `onMetrics` 回调（#86）
 - 实现 `SocketManager` 多 Slack App 实例
 - 实现 `SessionIdentity` 结构化 key
 - 4-Button Approval UI + `permissionTracker`
 - InterruptManager 中断/队列

 **做得好的**:
 - 大型功能拆分清晰：先抽象接口，再补实现，最后补测试
 - 遇到 Codex CLI 能力缺口（无 token 级流、无 cost 字段）时，主动设计降级方案（`StreamUpdate` 统一接口）
 - 对安全修复响应快：P0-3 权限逃逸、P0-2 重复审批、P0-1 session 状态不一致均在 24h 内闭环

 **待改进**:
 - **env var 早绑 bug 反复出现**: `1d7f1c1` 只修了 `CLAUDE_PERMISSION_MODE` 7 处，未全文 `rg` 扫同模式，导致 #P2-1 等 6+ 处残留
 - **partial fix 习惯**: `a4f05c1` 加了 inline 读 `REPLY_TIMEOUT_MS`，却未删顶层 `const`，造成双源并存
 - **测试入口覆盖不足**: `shouldReply`、routing options 等入口函数长期无集成测试，#76/#79 因此漏测
 - **Windows shell 转义**: #78 backslash-doublequote、#69 cmd metacharacter 都是事后补漏

 **给 Claude Code 的下轮纪律**:
 1. 任何 env bug fix 必须满足：改前 `rg`、改后 `rg`、回归测试覆盖
 2. 新增/修改入口函数必须同时新增从真实入口触发的 ST，不能只靠 UT
 3. 涉及 spawn/CLI flag 的修改，必须验证子命令 flag 位置（如 `resume` 与 `--json` 顺序）

 ---

 ### 2.2 Hermes — 测试与评估

 **承担工作**:
 - 编写并执行 Sprint 3 ST 计划（20 用例，16/20 PASS）
 - 重新打开并验证 #76-#79 4 个 bug
 - 产出评估报告：REVIEW-v3-2026-06-13、BugReopen 报告、ST 报告
 - 沉淀 `chorusgate-env-vars` 项目技能（env var 早绑规范）
 - 升级 5 个 `github-*` skill 为 REST-first + silent-mode
 - 创建跨项目技能 `silent-agent-workflow`

 **做得好的**:
 - 评估视角独立：能从 PR diff 外发现“不在 diff 内”的隐患（env var 顶层 const、#41 MCP_SENDER_ONLY 残留）
 - 工具链 resilience 强：WSL DNS 不稳定时切换到 GitHub REST API + bearer token 继续工作
 - 把测试反模式抽象成可复用技能（fake binary、env var 早绑）

 **待改进**:
 - **ST 环境依赖**: `codex-integration.test.ts` 6/6 失败因为 MCP server 未启动/不可用，环境依赖未解耦
 - **测试超时定位慢**: `npm test` 240s 超时未能快速定位是 hang 还是慢用例
 - **假阳/假阴**: provider-routing ST 因 #81 失败，但 #81 是代码 bug 而非测试设计问题

 **给 Hermes 的下轮纪律**:
 1. 每个 ST 用例必须标注“需要真实 CLI” vs “fake binary 即可”，并在 CI 中分组
 2. 引入 per-test timeout 与 case-level 日志，避免 runner 卡死时无法二分定位
 3. 环境依赖（MCP server）必须有启动脚本或 mock 降级方案

 ---

 ### 2.3 Codex（本会话）— 管理与整合

 **承担工作**:
 - 主持 Sprint 3 收尾：回顾、技能沉淀、domain 抽取
 - 读取并整合多份报告（小马评估、delez 日报、ST 报告、BugReopen 报告）
 - 按 `reflection-skill-evolution` 分层规则决定技能归属（project-local vs summit-saw domain）
 - 更新/新建项目技能，把可复用模式写入 summit-saw domain

 **做得好的**:
 - 直接复用现有技能框架（`skill-creator`、`sprint-handoff`、`reflection-skill-evolution`），不另造流程
 - 分层决策保守：先项目本地孵化，再评估是否进 domain，避免过早推广
 - 把“管理动作”本身也输出为可追溯文档与技能

 **待改进**:
 - 介入时间偏晚：env var、入口测试等问题在开发中后期才集中暴露
 - 对 Claude Code 的过程检查点不足：未在早期强制“改前 rg / 改后 rg”
 - 跨 runtime 记忆同步依赖人工：Claude Code 的 project memory、Hermes 的 session、Codex 的 skill 尚未自动对齐

 **给 Codex 的下轮纪律**:
 1. 每个 story 启动时先 load `chorusgate-env-vars` + `sprint-handoff`，作为前置 check
 2. 每个安全/Env bug fix 必须 review“改前 rg 截图 + 改后 rg 截图”
 3. 迭代中点增加一次“入口函数 ST 覆盖”检查，不等到收尾

 ---

 ## 三、跨角色协作瓶颈

 | 瓶颈 | 影响 | 改进方案 |
 |------|------|----------|
 | 本地分支落后于 GitHub HEAD | #76-#79  reopen，fix commit 已在远端但本地未合并 | 每日启动时先 `git fetch` + 比对 HEAD；WSL DNS 不稳时切 REST API |
 | env var 规范知而不行 | 同一类 bug 反复 3 次 | 把 `chorusgate-env-vars` 设为开发前置必 load 技能 |
 | 入口函数缺少 ST | routing、shouldReply 等 bug 漏到 ST | 新增“新增入口必加 ST”门禁 |
 | MCP server 环境依赖 | ST-CX-* 无法跑 | 提供 `npm run test:integration` 启动脚本或降级 mock |
 | 跨 runtime 记忆不同步 | Hermes 沉淀的 skill 与 Codex/Claude Code 项目技能重复 | 按 summit-saw 分层：base 进 summit-saw，adapter 留 runtime，project-local 留仓库 |

 ---

 ## 四、技能沉淀清单

 ### 已存在（v3 期间沉淀）
 - `.agents/skills/chorusgate-env-vars` — ESM 环境下 env var 安全读取规范
 - `.agents/skills/sprint-handoff` — 开发完成交接流程

 ### 本次新建/更新
 - `.agents/skills/chorusgate-stream-adapter` — 多 agent runtime 统一流式抽象（StreamUpdate）
 - `.agents/skills/chorusgate-approval-interrupt` — 4-Button Approval + Interrupt 安全控制
 - 更新 `chorusgate-env-vars`：补充当前 HEAD 反例与最新 commit 证据

 ### 抽到 summit-saw domain
 - `summit-saw/domains/dev/agent-gateway-retrospective.md` — 跨项目的多 agent 网关协作复盘与模式

 ---

 ## 五、下迭代（v4）关键行动

 | 优先级 | 行动 | 负责角色 |
 |--------|------|----------|
 | P0 | 清理剩余 env var 顶层 const（gateway.ts / codex.ts / claude.ts / claude-stream.ts） | Claude Code |
 | P0 | 完成 #81 `opts.onSpawn` 修复并 push | Claude Code |
 | P0 | load-env `find-up` 避免遍历到相邻项目 `.env` | Claude Code |
 | P1 | 拆分 `npm test` 并定位 240s 超时根因 | Hermes |
 | P1 | MCP server 启动脚本 / mock 降级 | Hermes |
 | P1 | Codex 双向批准协议研究（v4 #84） | Claude Code + Hermes |
 | P2 | 跨 runtime skill 同步机制（自动 mirror） | Codex |

 ---

 **生成日期**: 2026-06-16
 **作者**: Codex（管理角色）
