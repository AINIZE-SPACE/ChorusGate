# B5 复核草案：FC-I10-03 WakeAction→Attention 冲突优先级（小马 · 2026-10-13）

> 状态：复核草案（review draft），裁决权在小扣（ADR-0001；spec.md:51「小扣 decision after 小马 review」）。
> 证据基线：origin/v10/dev @ ef82be3；以下引用均经主控行号抽查核实。

## 1. 问题定义（证据）

pipeline（intent.md:24）：Event → WakePolicy → TaskEnvelope → HarnessAdapter → Completion → Attention/Delivery。
WakeAction 是唤醒判定阶段的输出（V10-HRS-contracts-draft.md:82-90，六档），Attention 是完成投递阶段的输出（:147-154，六档）。FC-I10-03 的「conflict precedence」实为两个冲突点：

- **P1（阶段内声明冲突）**：`TaskEnvelope.notify_policy.attention`（创建时声明，:114）与 `Completion.attention`（完成时判定，:166-168）不一致时何者优先，文档未定义。
- **P2（阶段间语义缺口）**：WakeAction 输出与 Attention 输出是串联、覆盖还是合并未定义（:80 vs :156）；spec.md:33-35 要求 production-facing 实现前必须 explicit。

注意：V10-Architecture-Hermes.md:595-609 的 ①→⑥ 是事件来源优先级，与 FC-I10-03 不同维度，不得混用。

## 2. 候选选项（P1：阶段内声明冲突）

| 选项 | 规则 | 优 | 劣 |
|---|---|---|---|
| **1（推荐）声明强度为上限 + 失败突破** | outcome=succeeded ⇒ 投递强度 = min(notify_policy.attention, Completion.attention)；outcome ∈ {failed, timed_out} ⇒ 投递强度 = max(Completion.attention, ALERT)；ESCALATE 档不受 min 压制 | 保留 :168「由 Notification Policy 定」语义；噪声可控且不漏关键失败 | 比纯 max/min 多一条规则 |
| 2 | 无条件取强（max） | 最简单 | succeeded 任务可突破声明的 DIGEST → 噪声 |
| 3 | 无条件取弱（min） | 最抗噪 | failed 任务可被压成 DIGEST → 漏报风险，与 ESCALATE 档语义矛盾 |
| 4 | notify_policy 只管 channel 不管强度 | 语义最简 | :114 的 notify_policy.attention 字段变死字段，需改 schema，契约改动最大 |

推荐理由：:156 已有投递层全局压制的先例（silent⇒RECORD、异步⇒DIGEST），「强度被上下文压制」是既有设计底色；但 outcome ∈ {failed, timed_out} 是新增语义增量——失败必达是底线，故设突破条款。

## 3. 阶段间继承约束（P2：WakeAction ↔ Attention）

设定为「串联 + 各自独立判定，不互相覆盖」，附三条约束：

1. **截断**：WakeAction=IGNORE ⇒ 不产生 TaskEnvelope ⇒ 自然无 Attention；WakeAction=DEFER ⇒ Attention 的投递时机被 cooldown_until 推迟，强度不变。
2. **同源重算**：WakePolicy 判定输入 user_attention（:92）与完成期 Attention 使用同一信号源但各自重算，不透传（唤醒与完成之间用户忙闲可能已变化）。
3. **不做档位捆绑**：不设 WakeAction 六档到 Attention 六档的强制映射（如 FULL_WAKE⇒ALERT 不成立）；attention 恒按 §2 规则判定。

## 4. 移交小扣的决策点（ADR-0001 输入）

- D1：P1 采用选项 1 或替代项（§2）。
- D2：突破条款的 outcome 集合是否含 cancelled（复核意见：不含，用户主动取消无需 ALERT）。
- D3：§3 三条继承约束的批准/修订。
- D4：批准后由 ADR-0001 落档，并回填 tasks.md:13 CG-I10-004 的 WakeAction-to-Attention precedence 验收项。
