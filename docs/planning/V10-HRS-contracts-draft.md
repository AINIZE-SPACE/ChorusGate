# V10 Harness Router — 统一运行时契约（DRAFT）

> **状态**: DRAFT v0.3 — 小克起草/补充 2026-08-26；v0.3 补丁 2026-09-02 按小马评审补齐 3×P0（§4 Commitment expires 触发 / §1 urgency 档位校准 / §8 双验 checklist）+ 不阻塞项（§3 lost、§6 result_ref TTL、§0.6 实践映射）。
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

## 0.6 与现行实践的映射（V10 不是凭空造，是把手工制度化）

| V10 概念 | 现行手工做法 |
|---|---|
| §1 Event + §2 WakePolicy + §5 Attention | cron 心跳四条件纪律的手工执行版（QUIET→SILENT / 定期→DIGEST 等） |
| §6 Completion.result_ref → COS 引用 | 现有 zkos 桶交付通道（media二进制→COS，git 只存 manifest/引用） |
| §4 Commitment Ledger | 承诺目前散记在 thread / 手账，随 session 消失——V10 把它固化为不随 session 消失的账本 |
| §8 Harness Adapter + metadata().license | 底座选型定案 A Hermes / B OpenClaw 的接口化落点 |

给评审一个具体锚点：六契约不是新发明，是把上面这些已经在跑的做法制度化、接口化。

---

## 1. Event（事件规范化 → 统一入口）doc §11

```jsonc
{
  "event_id":      "evt_<32hex>",
  "source":        "heartbeat | cron | webhook | harness | memory",
  "type":          "ci.failed | email.new | approval.pending | goal.progress ...",
  "employee_id":   "emp_001",
  "subject":       { "project": "payment", "sha": "a1b2..." },
  "urgency":       "high",        // P0: 枚举档位 low|med|high|critical（跨来源可比，见校准规则）; P1 小脑规则引擎上线后连续化 0..1
  "dedup_key":     "payment:ci:sha",   // 同 key 去重 + TTL
  "ttl":           3600,          // 秒，超时过期
  "received_at":   "<iso8601>"
}
```

**`urgency` 校准规则（P0：档位化，保证跨来源可比）**：
- P0 只取枚举档位 `low|med|high|critical`，来源给出动因标签（`source_reason`），不做跨来源数值比较——heartbeat 的 `high` 与 webhook 的 `high` 语义一致。
- **禁止 P0 直接上连续 0..1**: 连续值要求每个 source 先自建定标函数，等 P1 小脑规则引擎上线后再连续化、由小脑统一重估。
- 档位默认映射（adapter 未显式给档位时兜底）: `critical`=SLA 违约/安全; `high`=CI 失败/审批待办; `med`=进度推进; `low`=消息类。

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
  // lost = attempts 用尽 + N 个 heartbeat 周期无 checkpoint 更新（与 failed「主动报败」区分）
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
  "expired_at":    "<iso8601?>",  // open→expired 的确切时刻，由触发机制写入
  "status":        "open|satisfied|expired|cancelled",
  "created_at":    "<iso8601>"
}
```

**`expires` 触发机制（P0 必答：open→expired 由谁执行）**：

- **惰性读时判定（primary）**: 任何读取 Commitment Ledger 的路径先检查 `status=="open" && expires < now` → 当场判 expired 并发 `expired` 事件，落库带 `expired_at`。
- **心跳周期扫描兜底（secondary）**: HRS 随 heartbeat 心跳做周期批量扫描，把所有 `open && expires < now` 标 expired，避免「从不读就永不判」。
- **双保险闭环**: 两路任一都保证过期承诺被闭合，账本不再只增不减；`satisfied` 优先于 `expired`（先满足则先落 satisfied）。

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
  // result_ref COS 对象需 TTL/默认保留期 + 清理策略（zkos-1326019273 桶已有体积压力），P0 定默认保留期
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

**决策闸门双验 · 验收 checklist（P0，ADR-0001 证据入口；`能插 / 失败 / 受限` 必须以可判定证据为准，而非「感觉可以」）**：

- [ ] `onHeartbeat` 能否注入自定义 WakePolicy（Hermes 扩展点成立，产出 WakeInput[]）
- [ ] `execute` 能否携带独立 profile 与测试数据，全程不触碰生产 Soul/gbrain/agents_memory/mem0/凭据
- [ ] Completion 能否走 push 回调（`onCompletion`）而非轮询（推拉分离成立）
- [ ] 最小闭环垂直切片（§7）在沙箱跑通，终点留在隔离环境，不污染生产账本
- [ ] 失败 / 受限路径有可判定证据（异常 trace、license/API 缺口清单），能驱动「OpenClaw 升级」或「保留自有控制平面」任一结论
- [ ] 全程守住「验证后才报完成」纪律——任何里程碑完成均须附本清单勾选结果

> 每项未勾选即视为闸门未通过，back to spike，不进入 base 定稿。

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

**实现验收待办（09-04 复评审收口新增，不阻塞 base 定稿；随第一个实现 PR 以 AC 逐项闭合）**：
- [ ] schema_version 字段 + 兼容升级规则（读旧写新路径）
- [ ] 幂等/correlation（`event_id`/`envelope_id` 去重）与双重完成路径（既 push 又 poll 时的收敛规则）
- [ ] TaskEnvelope 状态机（`queued|running|waiting|blocked|succeeded|failed|cancelled|lost` 转移图 + 非法转移拒绝）
- [ ] ADR-0001 owner 指派、替代方案记录、supersede 触发条件

> 工作树注意：本文件与 `V10-Architecture-Hermes.md` 后续一并从 base 走 clean PR；本分支/本地 `memory/events.md` 的改动不并入。