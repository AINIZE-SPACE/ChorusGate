# PR #159 复评审报告 — V10 HRS 统一运行时契约（DRAFT v0.3）

- **PR**: AINIZE-SPACE/ChorusGate#159 `docs(v10): draft HRS unified runtime contract spec`
- **分支**: `docs/v10-hrs-contracts` · head `2d51fe5` · base `main` · 3 commits
- **评审人**: 小马 (hermes@ainize.space)
- **评审日期**: 2026-09-05（复评审 · 针对小克 09-04 收口 commit `2d51fe5`）
- **评审工具链**: 本机 git clone（fetch 校验远端 tip）+ `gh` API（PR/issue 状态核验）+ 契约文档全文精读。

---

## 1. 交付物真实性核验（sprint-handoff 纪律：通报 ≠ 证据）

| 通报项 | 远端核验结果 | 结论 |
|---|---|---|
| commit `2d51fe5` 09-04 落 §10 实现验收待办 | GitHub API: 存在，author=aicodeclaude，2026-09-04T01:27:15Z，`docs/planning/V10-HRS-contracts-draft.md` +6/-0 | OK |
| PR#159 head = `2d51fe5` | `gh pr view 159`: OPEN，headRefOid 完全一致 | OK |
| 基线 #145 profile 备份/自动恢复 | issue state=CLOSED (2026-08-20T00:32:19Z) | OK |
| 基线 #148 连接健壮性 | issue state=CLOSED (2026-08-20T04:27:03Z) | OK |
| 基线 #149 日报自动化 08-22 关单（非在开发中） | issue state=CLOSED (2026-08-22T01:08:55Z) | OK |
| diff 范围 | `main...branch` 累计仅 1 文件 +251 行，无越界文件 | OK |
| commit 时间线 | 3 commits（b98d847 08-31 / de11c59 09-02 / 2d51fe5 09-04），线性无 rebase 重写痕迹 | OK |

**所有通报项均有远端证据支撑，无 fake/unpushed commit。**

## 2. `2d51fe5` 收口内容核验（对照 09-03 首轮复评审 4 遗留项）

`2d51fe5` 在 §10 追加「实现验收待办（09-04 复评审收口新增）」块，4 项逐一对照：

| # | 09-03 首轮遗留项 | `2d51fe5` 落点 | 判定 |
|---|---|---|---|
| 1 | schema_version 字段 + 兼容升级规则 | 「schema_version 字段 + 兼容升级规则（读旧写新路径）」 | 已落 |
| 2 | 幂等/correlation + 双重完成路径收敛 | 「幂等/correlation（event_id/envelope_id 去重）与双重完成路径（既 push 又 poll 时的收敛规则）」 | 已落 |
| 3 | TaskEnvelope 状态机 | 「queued\|running\|waiting\|blocked\|succeeded\|failed\|cancelled\|lost 转移图 + 非法转移拒绝」 | 部分落账（见注） |
| 4 | ADR-0001 owner/替代方案/supersede | 「ADR-0001 owner 指派、替代方案记录、supersede 触发条件」 | 已落 |

**核验意见**：
- 收口方式正确：4 项标记「不阻塞 base 定稿；随第一个实现 PR 以 AC 逐项闭合」——与首轮意见定位一致（契约文档无需内联完整状态机图，AC 挂实现 PR 闭合）。
- 处理策略诚实：明确挂账 + 闭合路径，非静默丢弃。
- 改动范围严格：仅 +6 行，未触碰其他章节。
- 状态枚举两处一致：§3 与 §10 待办使用同一 8 状态枚举，命名无漂移。
- ⚠️ 部分收口注记：09-04 遗留清单第 3 项原文含两个子点——「TaskEnvelope 状态机」与「WakeAction↔Attention 冲突优先级」。`2d51fe5` 仅落了前者，后者未显式进入 §10 实现验收待办。判定：**不阻塞 base 定稿**（优先级规则本就属于实现期决策），但须在实现 PR 的 AC 中显式补入，防止实现期 WakeAction 与 Attention 映射冲突时无裁决依据。已在 PR 评论中要求小克确认。

## 3. 文档实质评审（全文 251 行精读）

### 3.1 通过项（相对 09-03 首轮已收敛）

| 项 | 说明 |
|---|---|
| §0.5 Non-Goals ×10 + P0/P1/P2 分期 | 「不重造 scheduler」「不复制 gateway 层」等防蔓延条款明确，边界可判定 |
| §0.6 现行实践映射 | cron 心跳四条件纪律 → Event/WakePolicy/Attention 手工版对应，给评审具体锚点 |
| §1 urgency 档位化 | P0 枚举 low/med/high/critical + source_reason，禁止 P0 上连续 0..1，P1 再连续化 |
| §4 expires 双保险 | 惰性读时判定(primary) + 心跳周期扫描(secondary)，satisfied 优先于 expired |
| §6 result_ref COS TTL | 注明 zkos 桶体积压力，P0 定默认保留期 |
| §8 双验 checklist | 能插/失败/受限要求可判定证据，back to spike 条款防带病定稿 |
| §7 最小闭环垂直切片 | Event→WakePolicy→TaskEnvelope→HarnessAdapter→Completion→Attention→Delivery 全链 |

### 3.2 残留观察（均不阻塞 base 定稿）

**OBS-1: `subject.project` 无命名空间约定**
- Event / TaskEnvelope / Commitment 三处 `subject.project` 均用 "payment" 示例值，无枚举/受控词表约束。
- 处置建议：P0 可不做；随实现 PR 明确 project 为自由字符串还是受控词表。若小克认可按「随实现 PR 闭合」处理，可在 §10 实现验收待办顺带补一行（非强制，不重新阻塞本 PR）。

**OBS-2: §6 `attention` 示例值 "ALERT"**
- 仅为 schema 示例值，注释已写明「由 Notification Policy 定」，无规范歧义，无需改动。

## 4. 评审结论

**VERDICT: APPROVED — 可定稿 V10 base**

- 09-03/09-04 复评审遗留项已收口：4 项中 3 项全落、1 项（状态机）部分落账（WakeAction↔Attention 优先级子点须随实现 PR AC 补入，见 §2 注记），挂账路径明确。
- 基线 issue #145/#148/#149 关单状态与通报一致。
- 文档具备 base 定稿条件：Non-Goals / 分期 / 双验 checklist / 实现验收待办齐备。

## 5. 后续动作

1. **base 定稿**：乐老板 merge PR#159 → `docs/planning/V10-HRS-contracts-draft.md` 进 main（merge 即定稿动作）。
2. **实现验收待办（5 项）**：随第一个实现 PR 以 AC 逐项闭合（owner: 小克）。其中第 4 项为 `2d51fe5` 已落 4 项 + WakeAction↔Attention 冲突优先级（复评审补记，小克需确认入账）。
3. **§8 双验 checklist 是双验执行闸门**：6 项未勾选 = 闸门未通过，back to spike。注意这是对「底座选型双验执行」的闸门，不是 merge PR#159 的前置条件——两件事已区分，勿混淆。
4. 「名称解耦分别决策」维持 §10 定位：不阻塞本契约。
