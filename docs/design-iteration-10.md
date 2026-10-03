# 迭代 10 设计导航

> 本文档汇总 `docs/planning/iteration-10-sdd/` 九份文件的状态与未决问题，供维护者快速定位。

## SDD 包文件一览

| 文件 | 一句话内容 | 状态 |
| --- | --- | --- |
| `intent.md` | 产品意图、边界、非目标、预期成果 | 已纳入 G0 PASS |
| `constitution.md` | 项目宪法八条：证据优先、边界优先、来源引用、最小授权等 | 已纳入 G0 PASS |
| `spec.md` | I10-FR-01..06 需求、HRS 状态机、数据约束 | 已纳入 G0 PASS |
| `plan.md` | 门禁 G0..G5 定义、技术序列、评审证据格式 | G0 PASS / G1 CONDITIONAL PASS 已同步 |
| `tasks.md` | CG-I10-001..007 任务登记、依赖、验收标准 | 已纳入 G0 PASS |
| `review-g0.md` | G0 SDD 完整性评审记录（2026-09-30，PASS） | PASS |
| `review-g1.md` | G1 范围/契约评审记录（2026-10-02，CONDITIONAL PASS） | CONDITIONAL PASS |
| `g1-entry-runtime-candidates.md` | G1 入口：运行时/适配器候选与决策选项 | 已纳入 G1 |
| `g1-review-input-runtime-candidates-xiaoma.md` | 小马对候选的评审输入 | 已纳入 G1 |

## 门禁状态

| Gate | 评审者 | 状态 | 日期 |
| --- | --- | --- | --- |
| G0 — SDD 完整性 | 小扣 | **PASS** | 2026-09-30 |
| G1 — 范围/契约评审 | 小扣 | **CONDITIONAL PASS** | 2026-10-02 |
| G2 — 独立测试/集成评审 | 小马 | **PENDING** | — |
| G3 — 运维/本地交付评审 | 小龙 | **PENDING** | — |
| G4 — 实现授权 | 小扣 | **PENDING** | — |
| G5 — 独立验收 | 小马 → 小扣 | **PENDING** | — |

## 候选运行时决议（G1）

| 候选 | 处置 | 说明 |
| --- | --- | --- |
| **C1 — opencode-via-acpx** | **唯一入选探针** | CG-I10-002 的 exactly-one 候选；需验证其真实 HRS executor/adapter 身份与 execute/push completion 行为 |
| **C4 — OpenClaw** | **保留的正式 fallback** | HRS draft 指定主不可用时启用；C1 失败前不启动第二探针 |
| **C5 — Hermes native** | **不是 CG-I10-002 候选** | 其 channel/gateway 职责与专业 runtime 职责边界未决，待后续 scope 决策 |
| C2/C3 与自研 runtime | 不选 | 本地依据不足或引入跨机约束；自研已被 HRS draft 拒绝 |

## 任务登记状态（CG-I10-001..007）

| ID | 任务 | 状态 |
| --- | --- | --- |
| CG-I10-001 | 冻结 SDD 范围与来源 | **PENDING — HUMAN REVIEW REQUIRED**（G0 PASS 已记录） |
| CG-I10-002 | 选择/探针一个运行时适配器 | **PENDING**；blocked pending 小龙运维输入 |
| CG-I10-003 | 决定 ADR-0001 与数据/保留边界 | **PENDING**；依赖 CG-I10-002 + G2 |
| CG-I10-004 | 冻结契约/测试矩阵 | **PENDING**；依赖 ADR-0001 |
| CG-I10-005 | 授权有界实现信封 | **PENDING**；依赖 CG-I10-004 + G3 |
| CG-I10-006 | 实现并自验批准的切片 | **PENDING**；无实现授权 |
| CG-I10-007 | 独立测试与验收 | **PENDING**；依赖 CG-I10-006 |

## 未决关切（FC-I10-01..05）

| ID | 关切 | 责任 / 下一步 |
| --- | --- | --- |
| FC-I10-01 | 真实 runtime/adapter 未选定 | 小马 主探 C1，小龙 提供运维约束 |
| FC-I10-02 | evidence receipt 存储保留/隐私分类未决 | 小扣 在 ADR-0001/G2 前裁决 |
| FC-I10-03 | WakeAction → Attention 冲突优先级未定 | 小马 评审后 小扣 裁决 |
| FC-I10-04 | evidence receipt 命名空间策略未决 | 与 FC-I10-02 合并进入 ADR-0001 |
| FC-I10-05 | 外部跟踪（Trello → GitHub Issues）保持未执行 | 待单独授权的操作员执行并验证 |

## 状态同步说明

> 注：2026-10-03 与 `review-g0.md`、`review-g1.md` 状态同步——G0 `PASS`、G1 `CONDITIONAL PASS` 已记录；G2-G5、`CG-I10-002..007` 与外部跟踪仍为 `PENDING / NOT EXECUTED`（小马）。

## 来源

- `docs/planning/iteration-10-sdd/intent.md`
- `docs/planning/iteration-10-sdd/plan.md`
- `docs/planning/iteration-10-sdd/tasks.md`
- `docs/planning/iteration-10-sdd/review-g0.md`
- `docs/planning/iteration-10-sdd/review-g1.md`
