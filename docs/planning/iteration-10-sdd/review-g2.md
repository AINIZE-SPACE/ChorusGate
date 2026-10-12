# G2 Review — Independent Test/Integration Review (小马, 2026-10-12)

VERDICT: CONDITIONAL PASS — design-level legs confirmed; adapter-evidence leg deferred to CG-I10-002.

## Scope reviewed
spec.md, plan.md, tasks.md, g1-entry-runtime-candidates.md, g1-review-input-runtime-candidates-xiaoma.md, review-g1.md（只读评审，经执行器 opencode/newapi-kimi-k2.7-code 会话 ma-cg-i10-g2；主控抽查引文 7/7 与文件原文一致）。

## Confirmed (design-level)
1. 测试矩阵基线：spec.md:5-13 有界真实运行时 HRS 观察切片、Web 永不执行 runtime action，与 intent.md:20-29（ChorusGate 只做交接协调，不吸收运行时执行/记忆/调度）一致；矩阵范围成立。
2. 候选推理：C1 条件选中具备在用证据（g1-entry-runtime-candidates.md:11，9-13 三断言冒烟 + TaskEnvelope 契约 + k2.7-code 9-22 MOA）；C2/C3 排除在设计层成立（跨机依赖/本地证据薄；C2 兼 G0 评审工具有独立性顾虑）；C5 由 g1-review-input:22 与 review-g1.md:46 正确重分类为 host/channel 层，剔除出适配器候选域。
3. 回归范围与验收环境：受 FC-I10-01 门控（spec.md:49）——真实适配器探针完成前实现线不动，与 review-g1.md 条件一致。

## Conditions (G2 exit)
- C-A: CG-I10-002 capability-spike record 产出并验收（supported API / isolation / completion callback-poll / limits / license-version / no-secret setup，tasks.md:11 AC）；C1 与文档主线 `Hermes Host+acpx` 的 adapter identity 以可执行证据完成同一性对账（review-g1.md:16-21）。
- C-B: 小龙 operational constraints 落档（review-g1.md:68-72）——C-A 前置，当前关键路径。

## Blockers inherited (unchanged)
- B1 小龙 operational input 未落档（owner 小龙）— 关键路径
- B3 capability-spike record（owner 小马，被 B1 阻塞）
- B4 FC-I10-02/04 证据保留/隐私分类与命名空间决策（owner 小扣）
- B5 FC-I10-03 WakeAction-to-Attention 优先级（小马复核 → 小扣决策，spec.md:51）

## G3 routing note
C-A/C-B 解决前 G3 不开工（与 review-g1.md:72 一致）。
