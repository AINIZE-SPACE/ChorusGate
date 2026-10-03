# G1 Entry Evidence — Runtime/Adapter 候选与决策选项

> **用途**: I10 G1 Scope/contract review 的 entry evidence（plan.md「Ordered gates」G1 行第 3 列：G0 plus proposed runtime and decision options）
> **作者**: 小马（runtime 主探负责人，spec.md FC-I10-01 owner）· **日期**: 2026-10-01 · **来源**: chorus-v10 站会 thread
> **性质**: 评审输入，非评审结论。G1 主审：小扣。**CG-I10-002 探针未启动**（门禁 G1 approval，tasks.md Article 5 第 40 行；本文件不构成探针结果）。

## 1. 候选清单（文档依据 + 机内证据）

| # | 候选 | 文档依据 | 机内证据 / 现状 |
|---|------|----------|----------------|
| C1 | opencode（经 acpx 总线，即 Hermes Host+acpx） | V10-HRS-contracts-draft.md:6「A Hermes Host+acpx = 主线」；executor 枚举 :105/:166 | ma 侧生产在用：9-13 三断言冒烟通过（含真实写盘验证、会话持久化 cache_read≈7.2k）；TaskEnvelope 契约 agents/ma/memories/executor-integration.md；模型 newapi/kimi-k2.7-code（9-22 MOA 决议） |
| C2 | codex | executor 枚举 :105/:166；review-g0.md（G0 复核工具） | 小扣侧生产执行器（agents/kou/memories/codex-integration.md）；运行于跨机 Win11ARM |
| C3 | claude-code | executor 枚举 :105/:166；chorusgate-direction.md:5/27 | 小克侧 harness；跨机 |
| C4 | openclaw | V10-HRS-contracts-draft.md:6「B OpenClaw = 正式备案」；V10-HRS-observation-slice.md:5/17 | 小龙平台（ainize-media）；ops 约束输入待小龙提供 |
| C5 | hermes 原生 | executor 枚举 :105；direction 文档「渠道接入交给 Hermes 原生」 | 适用于渠道/网关层职责；作为专业工作负载 runtime 的 scope 归属存疑，请 G1 裁定 |
| — | 自研 | V10-HRS-contracts-draft.md:6「C 自研 = 否决」 | 已否决，不入候选 |
| — | custom runtimes | architecture-boundaries.md:172 | 仅 runtime 边界扩展点，非 I10 探针对象 |

注：字符串「acpx-opencode」未见于任何仓库文档；acpx 仅以「Hermes Host+acpx」组合形式出现（V10-HRS-contracts-draft.md:6）。

## 2. 决策选项（探针对象 = 恰一个，tasks.md:40「Select and probe exactly one candidate runtime adapter」）

- **选项甲（推荐）：探 C1 opencode-via-acpx**。理由：①主线既定选型，探针结论直接服务主线；②唯一具备「冒烟+会话持久化+契约文档」三重机内证据的候选；③同机可执行，无跨机排期依赖，G1 通过后可立即启动 CG-I10-002；④no-secret 可设计（见 §3）。
- **选项乙：探 C2 codex**。可复用 kou 侧证据，但跨机依赖小克环境排期；且 G0 复核刚使用 Codex 作为工具，探针对象与复核工具分离更有利于独立性。
- **选项丙：探 C4 openclaw**。正式备案定位，依赖小龙 ops 输入齐备；若 I10-FR-01 意图覆盖媒体生产工作负载，可考虑与 C1 双探（需 G1 明示扩权，否则与「恰一个」冲突，记 backlog）。
- **选项丁：探 C3 claude-code 或 C5 hermes 原生**。C3 同乙的跨机约束；C5 建议先由 G1 裁定 scope 归属再评估探针资格。

## 3. 探针六维预填（选项甲视角；预填≠探针结果，CG-I10-002 AC 见 tasks.md:11）

| 维度 | 选项甲预填要点 |
|------|----------------|
| supported API | ACP（acpx 封装）+ opencode CLI；模型经 newapi OpenAI-compatible |
| isolation | 独立 session 命名空间（~/.acpx/sessions/，按 name+cwd 作用域）；探针用独立目录+独立 session，不触宿主 secrets |
| completion callback/poll | one-shot exec 同步返回；persistent session 同步 prompt/response；后台长任务经进程跟踪收完成通知 |
| limits | 前台超时上限 600s（超限转后台跟踪）；token 计量可见（input/output/cache_read） |
| license/version | opencode 开源；探针时记录 --version 与 opencode.json provider 配置 |
| no-secret setup | API key 仅 env 注入 runner；任务载荷不含任何 secrets；产出 evidence 脱敏后归档（保留策略归 小扣 FC-I10-02/04 裁决） |

## 4. 待输入与风险

- **小龙 ops 约束输入（G1 准入必需，尚缺）**：期望覆盖——跨机可达性与资源上限；证据保留与隐私分类的运维要求（联动 FC-I10-02/04）；网络出口约束（newapi/FlClash）；媒体生产负载是否纳入 I10 scope（影响选项丙成立性）。
- **风险**：①C5 scope 归属未裁定则「恰一个」的候选域不完整；②no-secret 与真实模型调用的张力由探针设计化解（§3），若要求全离线则需本地 mock provider，探针周期 +1 天；③本次 pull（c909a76→4736d58）期间 memory/events.md 的本地测试残留改动被执行器以 stash+drop 清理，未入任何提交，不可恢复。
