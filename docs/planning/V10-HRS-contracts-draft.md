# V10 Harness Router — 统一运行时契约（DRAFT）

> **状态**: DRAFT v0.2 — 小克起草/补充 2026-08-26，供 thread 1787727403.447589 全员评审。
> **前置文档**: `V10-Architecture-Hermes.md`（890 行，zederer@e829d11）§11-16。
> **用途**: 把小扣「运行时适配层」+ 底座选型结论固化为 —— ① Non-Goals/分期（v0.2 新增）；② 数据契约 + Harness Router SPI + ADR 骨架。
> **底座选型（小扣 2026-08-26 记录）**: A Hermes Host+acpx = 主线；B OpenClaw = 正式备案；C 自研 = 否决；ChorusGate 升维为企业 Control Plane。
> **兑现约束**: 独立 profile/测试数据，不碰生产 Soul/gbrain/agents_memory/mem0/凭据；这是 spec，不触发实现。

---

## 0. 设计原则

- **推拉分离**: Completion 走 push（direct push / wake），不复用轮询。对应 doc §13。
- **契约是接口，实现是 adapter**: 六个契约各为独立 schema；Hermes、OpenClaw 各实现同一 HRS SPI（§详情见 §8）。
- **静默是合法动作**: Attention=NOOP 与 RECORD 是正常终端，不是异常。

---

## 0.5 Non-Goals 与分期（v0.2 新增，收紧「参考方向」→「可开工」边界）

**Non-Goals（V10 控制平面明确不做，防「什么都做什么都不是」）**：

1. **不自研 LLM/推理运行时**——推理交给脑区（Claude/Codex/OpenCode），V10 不重造模型服务。
2. **不自研调度内核**——复用 Hermes Heartbeat + Cron + Gateway Event + Hooks；V10 只补编排层（Event Normalizer/Wake Policy 等），不重写 scheduler。
3. **不接管员工工作域内部**——专业任务怎么做交给脑区自治（doc §17 分工）；控制平面只管跨个体制度，不伸进个体内部。
4. **不重建消息传输**——Slack/Feishu/Web/App 现成通道延续 gateway 所长，V10 不另造 transport。
5. **不是泛化云平台/CaaS**——面向「硅基组织数智员工」，不对外卖通用 agent 云。
6. **不取代 GBrain/Soul**——人格/认知/长期记忆归 GBrain；控制平面经总线协作，不拥有它。
7. **不做前端 UI/用户产品界面**——是后端制度与控制面。
8. **不复制已被替代的 gateway 层**——渠道接入交给 Hermes 原生，不自造「第二个 ChorusGate gateway」。
9. **不另开 IAM/凭据面**——复用现有最小权限凭据（延续费用纪律与安全约束）。
10. **不做实时语音/视频/多模态**——超出本次控制平面范围，如要单列立项。

**分期（P0/P1/P2，小马提案已采纳）**：
- **P0**：Task Ledger + Commitment Ledger + 底座选型双验（落 ADR-0001）
- **P1**：Wake Policy + 小脑规则引擎
- **P2**：Standing Orders + Event Normalizer
- 每期独立可评审、可交付，不一次铺满。

---

## 1. Event（事件规范化 → 统一入口）doc §11

```jsonc
{
  "event_id":      "evt_<32hex>",
  "source":        "heartbeat | cron | webhook | harness | memory",
  "type":          "ci.failed | email.new | approval.pending | goal.progress ...",
  "employee_id":   "emp_001",
  "subject":       { "project": "payment", "sha": "a1b2..." },
  "urgency":       0.82,          // 0..1，来源给初值，小脑可重估
  "dedup_key":     "payment:ci:sha",   // 同 key 去重 + TTL
  "ttl":           3600,          // 秒，超时过期
  "received_at":   "<iso8601>"
}
```

---

## 2. WakePolicy（唤醒策略 → 判定动作）doc §12

**输出动作**（正合附判六档）：

```ts
type WakeAction =
  | "IGNORE"            // 不值得醒
  | "DEFER"             // 稍后/冷却后再看
  | "LIGHT_WAKE"        // 轻量看（observation_budget 内）
  | "FULL_WAKE"         // 全量线程/会话
  | "WAKE_WITH_HARNESS" // 唤醒并带专业 worker
  | "ESCALATE";         // 立即升级多channel
```

**判定输入**（小脑给分预算 → 动作）：`severity` / `responsibility` / `active_hours` / `current_busy` / `duplicate` / `cooldown` / `SLA` / `cost` / `user_attention`。

**产出**：`{ action: WakeAction, reason: string, cooldown_until?, notify_threshold? }`

---

## 3. TaskEnvelope（任务派发载体）doc §14-C

```jsonc
{
  "envelope_id":   "env_<32hex>",
  "requester":     "emp_001",
  "employee":      "emp_002",
  "executor":      "hermes | openclaw | claude-code | codex | opencode", // adapter 名
  "status":        "queued|running|waiting|blocked|succeeded|failed|cancelled|lost",
  "checkpoint":    "step_02",        // 断点续跑
  "next_wake":     "<iso8601?>" ,    // 条件未满足时的下次唤醒点
  "attempts":      0,
  "blocked_reason": null,
  "completion_event": null,          // 完成后指向 Completion
  "side_effect_state": {},           // 执行器的副作用快照
  "notify_policy":  { "attention": "ALERT", "channel": "C0...", "thread_ts"?: "..." }
}
```

---

## 4. Commitment（承诺账本 → 不随 session 消失）doc §14-B

```jsonc
{
  "commitment_id": "cmt_<32hex>",
  "condition":     { "type": "ci.success", "subject": { "project": "payment" } },
  "source_session": "sess_...",
  "project":       "payment",
  "notify_target": { "channel": "C0...", "user": "U0B..." },
  "expires":       "<iso8601>",
  "status":        "open|satisfied|expired|cancelled",
  "created_at":    "<iso8601>"
}
```

---

## 5. Attention / Notification（结果 ≠ 必须发消息）doc §15

```ts
type Attention =
  | "NOOP"      // 什么都不做
  | "RECORD"    // 只记日志/Memory
  | "DIGEST"    // 下次日报合并说
  | "NUDGE"     // 轻提醒
  | "ALERT"     // 立即通知
  | "ESCALATE"; // 立即多人/多channel
```

**Delivery** 复用既有 Slack 投递通道（channel + thread_ts），把 Attention 映射到投递强度与频次。silent 分支统一走 RECORD，异步合并走 DIGEST。

---

## 6. Completion（执行完回执，push-first）doc §13/§14

```jsonc
{
  "completion_id": "cp_<32hex>",
  "envelope_id":   "env_...",
  "executor":      "hermes | openclaw | claude-code | codex | opencode",
  "outcome":       "succeeded | failed | timed_out | cancelled",
  "attention":     "ALERT",        // 由 Notification Policy 定
  "deliver_to":    { "channel": "C0...", "thread_ts"?: "..." },
  "result_ref":    "cos://.../summary.md",   // 长量产物体由 COS 汇聚，git 只存引用
  "produced_at":   "<iso8601>"
}
```

---

## 7. 最小闭环垂直切片（先证闭环，再铺模块）

```
Event(§1) ── hub ──> WakePolicy(§2)
      └------> TaskEnvelope(§3) ──> HarnessAdapter(§8).execute()
                    └------> Completion(§6) ──> Attention(§5) ──> Delivery(channel)
```
跑通这条线 = 「可插拔」底座验证完成。HEARTBEAT_OK 静默 = Attention=RECORD，是合法终点。

---

## 8. Harness Router SPI（适配接口）

```ts
interface HarnessAdapter {
  // src: 只有 Executor 层有实现差异，决策闸门不重写
  execute(envelope: TaskEnvelope): Promise<Completion>;
  onCompletion(cb: (c: Completion) => void): void; // push-first
  onHeartbeat?(hb: HeartbeatTick): Promise<WakeInput[]>;
  metadata(): { harness: "hermes"|"openclaw"|...; license: string; api_version: string };
}
```

- Hermes 实现 `executor: "hermes"`（走 Nerve 总线接 GBrain）
- OpenClaw 实现 `executor: "openclaw"`（复用其 Task Ledger / Automation）

**决策闸门**：Hermes 扩展点能从 `onHeartbeat`+`execute` 插 Wake Policy → Hermes 主线；失败/受限 → OpenClaw 升级为正式 adapter；二者都不满足 → 保留自有控制平面，不反向复制 Gateway。

---

## 9. ADR 骨架（约束②可追溯记录）

```markdown
# ADR-NNNN · <标题>（如「底座选型：Hermes vs OpenClaw」）
- 日期 / 作者 / 状态(DRAFT|ACCEPTED|SUPERSEDED)
- 上下文（决策背景、约束）
- 决定（一句话）
- 后果:
  - 治理    : 双栈运维职责、故障边界
  - 安全    : 凭据面、最小权限、隔离档
  - 许可证  : 上游 license 条款 / 衍生风险
  - API 稳定性: 追踪扩展点/插件 API 的变动频率
  - 维护成本: 双栈升级节奏、技能复用率
- 相关    : 测试证据、spike 结论、commit/PR 链接
```

---

## 10. 待办（base 定后走 clean PR 进 main）

- [ ] 契约 schema 评审 → base 定稿
- [ ] HRS SPI 原型（rudimentary，不接生产）
- [ ] 垂直切片跑通（独立 profile）
- [ ] 双验结果落 ADR-0001
- [ ] 名称解耦分别决策（不阻塞本契约）

> 工作树注意：本文件与 `V10-Architecture-Hermes.md` 后续一并从 base 走 clean PR；本分支/本地 `memory/events.md` 的改动不并入。