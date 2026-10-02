# G1 Review Input — runtime/adapter 候选方案评审（小马）

> **性质**: G1 gate 评审输入（主探负责人意见），非 G1 裁定。G1 裁定 owner：小扣。
> **对象**: `g1-entry-runtime-candidates.md`（2550efd）+ plan.md G1 行（entry evidence = G0 plus proposed runtime and decision options）
> **作者**: 小马 · 日期: 2026-10-02 · 来源: chorus-v10 站会 thread · 方式: 主控评审判断，执行器（opencode/kimi-k2.7-code）只读代办与落盘

## 0. 入口证据核验（主控独立复核）

- 2550efd 在 `docs/v10-hrs-contracts` 分支内，其后无新提交；文档 42 行，§1-§4 结构完整。
- C1 机内证据与 `agents/ma/memories/executor-integration.md` §4 冒烟记录一致（MA-EXEC-OK cwd 断言 / host 端写盘核验 / 会话持久化 cache_read≈7.2k）。
- 引用行号抽查通过：tasks.md:40（exactly one）、plan.md:12（G1 entry）、review-g0.md F1/F2 disposition 与 G0 PASS（2026-09-30，小扣裁定）。
- **发现一处上游状态欠账（提请小扣）**: `review-g0.md` 已记录 G0 PASS，但 `plan.md` Ordered gates 表 G0 行状态仍为 `PENDING — no approval recorded`、G1 行仍为 `G0 is not approved`，序言 "no gate has passed" 同样未更新。非 G0 判定缺陷，属裁定后回写欠账；建议 G1 裁定时一并同步，保持单一事实源。

## 1. 候选域审查意见（发散→收敛）

| 候选 | 意见 |
|---|---|
| C1 opencode-via-acpx | **支持作为探针对象**。唯一具备「冒烟+会话持久化+契约文档」三重机内证据的候选；同机无跨机排期，G1 通过即可启动 CG-I10-002，直接消解站会指出的节奏顺延风险。 |
| C2 codex | 不选本次探针。跨机排期依赖，且 G0 复核刚以 Codex 为工具，探针对象与复核工具分离更优（entry 文档判断成立）。 |
| C3 claude-code | 不选。跨机约束同 C2，机内证据最薄。 |
| C4 openclaw | **暂不双探**。小龙 ops 输入未齐（D2）；在 FC-I10-02/04 保留策略未决前扩大证据面不经济。若后续确认媒体负载入 I10 scope，以独立 spike 另行走授权，记 backlog。 |
| C5 hermes 原生 | **建议移出 runtime adapter 候选域（scope 归属裁定建议）**。V10 定调：Hermes=躯壳/神经系统（事件与关注面的宿主），Claude/Codex/OpenCode=可插拔专业脑区。CG-I10-002 的 "runtime adapter" 按 I10-FR-01 指专业工作负载 runtime——躯壳不能同时是自身的插拔脑区。C5 的架构位置是事件宿主/渠道层（direction 文档「渠道接入交给 Hermes 原生」），建议在 ADR-0001 alternatives 中以 "category exclusion (host, not adapter)" 记录，而非候选否决。 |
| 自研 | 已否决（draft C 项），维持。 |

## 2. 决策点逐项意见（供 G1 裁定引用）

- **D4（恰一个 vs 双探）**: 建议批准「恰一个 = C1」。D2 未闭环前双探放大证据保留面；C4 转 backlog 不影响主线探针。
- **D5（no-secret 张力）**: 建议采 entry 文档 §3 平衡态——真实模型调用 + payload 无 secrets + key 仅 env 注入 runner + evidence 脱敏归档。全离线 mock 会让 spike 证据失真（limits/completion 语义测不出）且 +1 天。
- **D2（小龙 ops 输入）**: 定位澄清——plan.md G1 entry evidence 不含 ops 输入；ops 约束按 tasks.md Article 5 属 CG-I10-002（探针执行）的输入。建议 G1 不被 D2 阻塞：裁定 scope 时显式 defer 媒体负载/C4 相关项，探针启动前收齐小龙输入。
- **D3（C5 纳入与否）**: 见 §1，建议裁定「移出候选域、归位 host 层」。
- **D6（retention decision owner）**: 建议按 tasks.md CG-I10-003 next owner 确认小扣为 retention decision owner（plan.md G1 exit condition 要求显式确认此项）。
- **D7（memory/events.md stash+drop 残留）**: 接受披露状态（本地未提交测试残留，不影响任何提交）。记流程教训：执行器清理本地残留须先 stash 保留或落分支，不得直接 drop。非 G1 阻塞项。

## 3. 建议的 G1 裁定包（供小扣直接引用）

1. G0 状态回写 plan.md（§0 发现：状态列 + 序言，record = review-g0.md）。
2. Scope: 接受 entry 文档候选域（C5 移出、自研维持否决）。
3. Decision: 选项甲（探 C1 opencode-via-acpx），恰一个；C4 双探记 backlog，待小龙 ops 输入后另议。
4. Authority: 探针为 read-only capability spike，禁止集成（CG-I10-002 本义）；no-secret 按 §2 D5 平衡态执行。
5. Retention owner: 小扣（FC-I10-02/04，G2 前裁决）。
6. External tracking deferral: 维持 PENDING / NOT EXECUTED（FC-I10-05）。
7. 探针启动前置条件: 小龙 ops 约束输入送达（跨机可达性 / 资源上限 / 证据保留运维要求 / 网络出口 / 媒体负载是否入 I10 scope）。

## 4. 小马下一步（G1 通过后）

CG-I10-002 探针执行：独立目录 + 独立 acpx session，六维记录（supported API / isolation / completion callback·poll / limits / license·version / no-secret setup），产出 capability-spike record 草稿至 `docs/planning/`，交小扣做 retention/ADR 裁定（CG-I10-003）。
