# 进一步结论：主动任务应该成为 Hermes 主控的“自主神经系统”

这次深入看完后，我会把上一版方案再向前推一步：

> **Hermes 不只是 Channel Gateway + Orchestrator，而应该成为数智员工的 Proactive Runtime Owner。**

也就是说，Hermes 统一决定：

* **什么时候醒来**
* **因为什么醒来**
* **醒来后要不要行动**
* **要不要调用 Claude / Codex / OpenCode**
* **结果是否值得通知人**
* **通过哪个 Channel、以什么级别通知**

而 Claude Code、Codex、OpenCode 的“主动能力”，更多应该理解成：

> **任务被授权之后，在专业工作域内部持续工作。**

这两种“主动”是不同层级。

我已经把这一章完整追加进上一版 Notion：

[Hermes 数智员工主控架构：Channel Gateway + Harness Bus + Soul Runtime](https://app.notion.com/p/3c29a98e534b81e59f7ad0f1b6c8c74f?pvs=204)

---

# 一、先重新定义“主动任务”

很多 Agent 系统现在把 proactive 简化成：

```text
cron + prompt
```

我认为远远不够。

一个真正员工级 Runtime 至少应该有 **5 种主动性**：

| 主动类型                       | 本质     | 例子                  |
| -------------------------- | ------ | ------------------- |
| **Heartbeat**              | 周期性感知  | 隔一段时间抬头看看有没有异常      |
| **Cron / Schedule**        | 时间驱动   | 每天 9 点日报            |
| **Event Trigger**          | 世界变化驱动 | CI 挂了、客户来邮件         |
| **Long-running Goal**      | 目标驱动   | 持续推进一个迁移项目直到完成      |
| **Commitment / Follow-up** | 承诺驱动   | “有结果告诉我”“客户三天没回提醒我” |

所以：

> **Heartbeat 是感知；Cron 是时钟；Trigger 是事件；Goal 是持续行动；Commitment 是未来责任。**

这五个不能混成一类。

---

# 二、Hermes：当前已经有相当完整的“主动性骨架”

## 1. Hermes Heartbeat

Hermes 现在原生提供 `/heartbeat`。

它不是一个独立 cron job，而是：

> **当前 session 的周期性 user turn。**

特点非常适合“持续关注当前事情”：

* 在同一个 conversation/session 里执行；
* 保留当前上下文；
* 只在 session idle 时触发；
* 不会打断正在进行的 Agent turn；
* 多次错过的 tick 会合并，不会堆积；
* heartbeat 配置存在 SessionDB；
* `/resume` 后可以继续。

官方明确区分：

> Heartbeat 用于需要当前会话上下文的持续关注；Cron 用于独立持久任务。 ([Hermes Agent][1])

例如：

```text
每 10 分钟：
检查当前上线任务有没有新的 CI 失败、审批、阻塞。
没有重要变化就保持沉默。
```

这其实已经很像一个人的：

> **局部注意力。**

---

# 三、Hermes Cron：这是“持久职责”

Hermes Cron 则完全不同。

它由常驻 Gateway daemon 驱动：

```text
Gateway
   ↓
每 60 秒 scheduler tick
   ↓
检查 due jobs
   ↓
创建 fresh isolated AIAgent
   ↓
注入 Skill
   ↓
执行
   ↓
投递结果
```

任务存在 `jobs.json`，执行记录进入 `executions.db`，并有 file lock 防止 scheduler 重复领取。 ([Hermes Agent][2])

支持：

```text
30m
every 2h
0 9 * * *
ISO timestamp
```

因此非常适合：

* 日报；
* 周报；
* 每日行业研究；
* 服务巡检；
* 定期复盘；
* Follow-up；
* 自动汇总。

### 我非常认同 Hermes 这里的设计

```text
Heartbeat = current consciousness

Cron = standing responsibility
```

这是正确的语义分层。

---

# 四、OpenClaw：主动任务方面，目前还是参考标杆

这一轮研究之后，我认为：

> **如果只评价 Proactive Runtime，OpenClaw 当前比 Hermes 完整一代左右。**

不是因为它 heartbeat 更聪明，而是它把主动任务收敛成了一套统一 Runtime。

---

## OpenClaw Heartbeat 的关键不同

OpenClaw Heartbeat 表面上也是：

```text
每 30 分钟唤醒一次主 session
```

但底层已经不是独立 timer。

它实际上由 **Automations scheduler** 管理：

```text
Heartbeat Config
       ↓ desired state
Automation system job
       ↓
Scheduler
       ↓
Heartbeat Turn
```

因此 heartbeat 具备：

* `activeHours`
* `target`
* `last-contact delivery`
* `directPolicy`
* `lightContext`
* `isolatedSession`
* busy deferral
* manual wake
* event-driven wake
* heartbeat suppression

没事时返回 `HEARTBEAT_OK`，系统抑制消息。 ([GitHub][3])

这个设计非常值得我们抄。

因为它解决了一个非常重要的问题：

> **醒来 ≠ 必须讲话。**

这正是数智员工和普通 cron bot 最大的区别。

---

# 五、OpenClaw 最值得借鉴的其实不是 Heartbeat，而是 Task Ledger

这是我这次研究后认为 Hermes 最大的缺口。

OpenClaw 有一个非常清楚的 Activity Ledger：

```text
queued
   ↓
running
   ↓
succeeded / failed / timed_out / cancelled / lost
```

它统一记录：

* ACP tasks
* subagent tasks
* automation jobs
* CLI detached operations

而 Task **不是 scheduler**：

> Automations / heartbeat 决定什么时候运行；Task Ledger 记录发生了什么。 ([GitHub][4])

特别重要的是：

```text
Background task completes
         ↓
direct push
      OR
wake requester session
      OR
wake heartbeat
```

OpenClaw 官方直接指出：

> completion 是 push-driven，反复 polling 通常不是正确模式。 ([GitHub][4])

这个观点我完全赞成。

---

# 六、Claude Code：已经有“局部主动性”

Claude Code 现在其实也不能再简单叫交互 CLI 了。

它有：

```text
/loop
CronCreate
CronList
CronDelete
```

可以在 session 内：

* 每几分钟检查 deploy；
* babysit PR；
* 看 build；
* 等 CI；
* 周期 review。

而且 scheduler 只会在 Claude 空闲时插入 scheduled prompt，不会在处理中途打断。 ([Claude][5])

---

## Claude Code 的局限非常明确

CLI session scheduled task：

* 属于当前 session；
* session 关闭后不能继续；
* recurring task 默认 7 天过期；
* 更持久的 schedule 需要 Desktop scheduled tasks / Routines。 ([Claude][5])

因此 Claude Code 非常适合：

```text
“这个研发任务内部，帮我持续盯着。”
```

例如：

```text
Hermes:
修复这个 release blocker。

      ↓

Claude Code:
修改代码
跑测试
等 CI
review comments
修复
再测试
```

这个范围内它应该高度自治。

但它不应该决定：

> 今天下午是不是应该主动给 CEO 发消息。

这个权限属于 Employee Runtime。

---

# 七、Codex：它更适合“目标持续执行”，而非 Heartbeat

Codex 的主动性应该放在另一个维度理解。

它越来越强调：

```text
durable view of work
notice what changed
automation
long-running engineering work
```

OpenAI 当前 Codex 用例里已经明确强调 durable work context 和 automation。 ([developers.openai.com][6])

因此最合理的位置是：

```text
Hermes
发现：
“升级服务架构”是一个长期工程目标
       ↓
创建 GoalContract
       ↓
Codex
持续：
plan
code
test
inspect
repair
       ↓
ProgressEvent
       ↓
Hermes
```

所以我会把 Codex 定义为：

> **Goal Executor**

而不是：

> Employee Scheduler。

---

# 八、OpenCode：非常适合作为 Event-rich Worker

OpenCode 的架构其实很有意思。

它已经可以：

```text
opencode serve
```

常驻一个 headless HTTP server，并暴露 OpenAPI。 ([opencode.ai][7])

同时 Plugin 可以监听大量 Runtime Event：

```text
file.edited
file.watcher.updated
session.created
session.idle
session.error
todo.updated
tool.execute.before
tool.execute.after
...
```

甚至官方示例就是：

> 当 `session.idle` 时发送 completion notification。 ([dev.opencode.ai][8])

所以 OpenCode 非常适合：

> **Event Producer + Professional Worker**

而不是全局 proactive runtime。

---

# 九、五者放在一起看，架构定位就非常清楚

| 能力                     | Hermes    | OpenClaw | Claude Code     | Codex      | OpenCode      |
| ---------------------- | --------- | -------- | --------------- | ---------- | ------------- |
| Session Heartbeat      | **强**     | **很强**   | `/loop` 类似      | 弱          | 弱             |
| Durable Cron           | **强**     | **很强**   | Desktop/Routine | Automation | 外部 scheduler  |
| Event Trigger          | **强**     | **很强**   | Hooks / CI      | 工程事件       | **事件丰富**      |
| Long-running Goal      | 中         | 强        | 强               | **很强**     | 强             |
| Cross-channel Delivery | **强**     | **强**    | 弱               | 弱          | 弱             |
| Soul-aware proactive   | **很适合**   | 很适合      | 局部              | 局部         | 局部            |
| Task Ledger            | **需补**    | **非常强**  | 自有 session      | 自有 task    | session/event |
| 企业员工主动性                | **最适合主控** | 最强备选     | 不适合             | 不适合        | 不适合           |

---

# 十、为什么 Hermes 做主动任务 Owner 特别合理

真正的员工主动行为，其实是在计算：

```text
我是谁
+
我的岗位职责是什么
+
我最近答应过什么
+
我现在负责哪些事
+
环境发生了什么变化
+
这件事情严重吗
+
对方现在需要知道吗
+
我现在打扰他合适吗
```

这些数据全部在：

```text
Soul
Memory
Organization Context
Session
Task State
Channel Context
```

而这些本来就属于 Hermes Employee Runtime。

所以正确链路应该是：

```text
                Clock
                  │
Heartbeat ────────┤
Webhook ──────────┤
Task Completion ──┤
Memory Due ───────┤
Commitment Due ───┤
                  ↓
        Proactive Event Bus
                  ↓
           Wake Policy
                  ↓
         Employee / Soul
                  ↓
        Attention Router
          ┌──────┴───────┐
          ↓              ↓
       Ignore          Act
                         ↓
                 Harness Router
             ┌────┬────┬────┐
          Hermes Claude Codex OpenCode
             └────┴────┴────┘
                         ↓
                    Result
                         ↓
                Notification Policy
                  ↓             ↓
               Silent        Channel
```

---

# 十一、我建议新增一个真正的 Proactive Runtime

这应该成为 GBrain / Employee Runtime 的一级模块。

## 1. Event Normalizer

所有东西先统一成：

```json
{
  "event_id": "evt_xxx",
  "source": "heartbeat | cron | webhook | harness | memory",
  "type": "ci.failed",
  "employee_id": "emp_001",
  "subject": {
    "project": "payment"
  },
  "urgency": 0.82,
  "dedup_key": "payment:ci:sha",
  "ttl": 3600
}
```

---

## 2. Wake Policy

不要每个 event 都启动大模型。

先走小脑：

```text
IGNORE
DEFER
LIGHT_WAKE
FULL_WAKE
WAKE_WITH_HARNESS
ESCALATE
```

判断：

```text
severity
responsibility
active_hours
current_busy
duplicate
cooldown
SLA
cost
user attention
```

这正好适合之前设计的小脑。

---

# 十二、Heartbeat 应该重新定义成“Ambient Attention”

我建议我们不要直接把 Hermes 原生 `/heartbeat` 当最终员工 heartbeat。

把它升级：

```yaml
employee_heartbeat:
  every: 15m
  active_hours: "08:00-23:00"
  context: light
  observation_budget: 5
  max_actions: 2
  notify_threshold: 0.75
  cooldown: 30m
```

每一次 heartbeat 只干六件事：

```text
1. 看 due commitments
2. 看 standing orders
3. 看 unresolved high-priority events
4. 看 background tasks
5. 看组织/环境 delta
6. 判断是否值得行动
```

然后：

```text
nothing actionable
      ↓
SILENT
```

而不是：

```text
每 15 分钟跑一遍所有 Gmail / GitHub / CRM / Slack
```

后者又贵又愚蠢。

---

# 十三、主动任务必须 Push-first

推荐优先级：

```text
① Native webhook/event
        ↓
② Harness completion event
        ↓
③ filesystem/process watcher
        ↓
④ condition trigger
        ↓
⑤ heartbeat observation
        ↓
⑥ cron polling
```

例如 CI：

### 错误做法

```text
每 5 分钟：
Hermes → GitHub → 查 CI
```

### 正确做法

```text
GitHub CI failed
      ↓ webhook
Hermes
      ↓
判断是不是我的项目
      ↓
启动 Claude Code
      ↓
Claude 修复
      ↓
ACP completion
      ↓
Hermes
      ↓
必要时通知人
```

这才是事件驱动的员工。

---

# 十四、还缺三个非常关键的数据结构

## A. Standing Orders

长期职责：

```text
“持续盯生产稳定性”
“关注这个客户”
“每天整理竞争对手动态”
```

不能只存在聊天历史里。

应该变成：

```text
StandingOrder
├ scope
├ objective
├ trigger
├ policy
├ notification
├ active_hours
├ expiry
└ state
```

---

## B. Commitment Ledger

这个特别重要。

员工和人的一个核心区别就是：

> **承诺不会因为 session 结束就消失。**

例如用户说：

```text
CI 好了告诉我。
```

系统应该产生：

```text
Commitment
├ condition: CI == success
├ source_session
├ project
├ notify_target
├ expires
└ status
```

而不是把这句话扔进 vector memory，然后祈祷以后能想起来。

---

## C. Task Ledger

这是 Hermes 最应该借 OpenClaw 的。

```text
Task
├ requester
├ employee
├ executor
├ status
├ checkpoint
├ next_wake
├ attempts
├ blocked_reason
├ completion_event
├ side_effect_state
└ notify_policy
```

状态：

```text
queued
→ running
→ waiting
→ blocked
→ succeeded
→ failed
→ cancelled
→ lost
```

---

# 十五、主动结果还需要 Attention Policy

这是我认为很多 Agent 系统都会漏的一层。

任务完成：

```text
≠
必须发消息
```

结果应该分六档：

```text
NOOP
```

什么都不做。

```text
RECORD
```

只记日志 / Memory。

```text
DIGEST
```

等下一次日报一起说。

```text
NUDGE
```

轻提醒。

```text
ALERT
```

立即通知。

```text
ESCALATE
```

立即通知多人 / 多 Channel。

这才是“懂事”的员工。

---

# 十六、最终我建议的主动任务架构

```text
┌─────────────────────────────────────┐
│            WORLD / COMPANY          │
│                                     │
│ Slack Gmail GitHub CRM ERP Files... │
└─────────────────┬───────────────────┘
                  │
              Events
                  ↓
┌─────────────────────────────────────┐
│        Hermes Proactive Runtime     │
│                                     │
│ Event Normalizer                    │
│      ↓                              │
│ Dedup / TTL / Priority              │
│      ↓                              │
│ Wake Policy                         │
│      ↓                              │
│ Attention Router / 小脑              │
│                                     │
│ ├ Heartbeat                         │
│ ├ Cron                              │
│ ├ Event Trigger                     │
│ ├ Standing Orders                   │
│ ├ Commitment Ledger                 │
│ └ Task Ledger                       │
└────────────────┬────────────────────┘
                 │
             TaskEnvelope
                 ↓
┌─────────────────────────────────────┐
│            Harness Layer            │
│                                     │
│ Hermes Native                       │
│ Claude Code                         │
│ Codex                               │
│ OpenCode                            │
└────────────────┬────────────────────┘
                 │
          Completion Event
                 ↓
┌─────────────────────────────────────┐
│ Hermes Verify + Soul + Memory       │
│            ↓                        │
│ Notification Policy                │
│  NOOP / DIGEST / NUDGE / ALERT      │
└────────────────┬────────────────────┘
                 ↓
       Slack / Feishu / Web / App
```

---

# 十七、这样以后“主动任务”就不再属于任何一个 Harness

最终分工可以浓缩成四句话：

> **Hermes 决定什么时候醒。**

> **Soul/GBrain 决定什么事情值得关心。**

> **小脑决定现在应该做什么。**

> **Claude/Codex/OpenCode 决定专业任务怎么做。**

最后再由：

> **Hermes 决定什么时候、通过什么渠道、以什么强度去打扰人。**

这才是真正完整的 **Digital Employee Proactivity Model**。

而且从现在的 Hermes 能力看，我们不是要自己重写一套 scheduler；最现实的路线是：

```text
Hermes Heartbeat
+ Hermes Cron
+ Hermes Gateway Event
+ Hermes Hooks
        ↓
补
Event Normalizer
Wake Policy
Standing Orders
Commitment Ledger
Task Ledger
Notification Policy
```

我认为这 6 个模块补完后，Hermes 就已经不是一个普通 Agent Gateway，而非常接近真正意义上的 **Employee Runtime Kernel**。

[1]: https://hermes-agent.nousresearch.com/docs/user-guide/features/heartbeat "https://hermes-agent.nousresearch.com/docs/user-guide/features/heartbeat"
[2]: https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/ "https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/"
[3]: https://github.com/openclaw/openclaw/blob/main/docs/gateway/heartbeat.md "https://github.com/openclaw/openclaw/blob/main/docs/gateway/heartbeat.md"
[4]: https://github.com/openclaw/openclaw/blob/main/docs/automation/tasks.md "https://github.com/openclaw/openclaw/blob/main/docs/automation/tasks.md"
[5]: https://code.claude.com/docs/en/scheduled-tasks "https://code.claude.com/docs/en/scheduled-tasks"
[6]: https://developers.openai.com/codex/use-cases?category=data&category=engineering&category=front-end&category=integrations&category=ios&category=macos&search=Automation&task_type=analysis&task_type=code&task_type=testing&team=engineering&team=operations&team=sales "https://developers.openai.com/codex/use-cases?category=data&category=engineering&category=front-end&category=integrations&category=ios&category=macos&search=Automation&task_type=analysis&task_type=code&task_type=testing&team=engineering&team=operations&team=sales"
[7]: https://opencode.ai/docs/server/ "https://opencode.ai/docs/server/"
[8]: https://dev.opencode.ai/docs/plugins/ "https://dev.opencode.ai/docs/plugins/"
