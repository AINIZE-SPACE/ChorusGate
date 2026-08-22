# 测试策略 - Issue #142 Windows 唤醒后自动恢复消息处理（SIT 计划预置）

> **Issue**: [#142](https://github.com/AINIZE-SPACE/ChorusGate/issues/142)
> **Spec 依赖（底盘）**: `docs/specs/issue-liveness-suspend-recovery.md`（已在 main，随 #143 落地）
> **Test Owner**: 小马 (U0B91BVKTL2) — Linux 主测 + Windows 用例设计
> **Date**: 2026-08-22
> **Status**: **计划预置** — #142 实现未开工（小克 2026-08-22 排期回执：#133 之后并行推进），本计划先行落盘，Dev Ready 后即可执行
> **前置核验**: 2026-08-22 11:15 CST 小马已核验底盘——main@6b8a695 含 liveness 四层能力 + watchdog 脚本，liveness.test 14/14 PASS + watchdog.sh 功能模拟 PASS（见 #142 comment）

---

## 0. 范围与依赖

#142 = 在 liveness 底盘之上的**唤醒编排层**。底盘（已核验就绪）提供：

| 底盘能力 | 位置 | 核验状态 |
|---|---|---|
| Layer 1 时钟跳变挂起检测 | `src/liveness.ts` suspend 检测 | 单测覆盖（14/14） |
| Layer 2 假活探测 + 强制重连 | `websocket?.isActive()` probe | 单测覆盖 |
| Layer 2.5 → Layer 3 退出决策 | gateway `onUnrecoverable` → exit(1) | 单测覆盖 |
| 看门狗 | `scripts/chorusgate-watchdog.{ps1,sh}` | Linux 功能模拟 PASS；Windows schtasks 待实机 |
| status 心跳年龄 | `gateway-control.ts` `⚠️ heartbeat stale` | 单测覆盖（3 例） |

#142 编排层待实现（小克）：唤醒后的恢复编排——探测→重连→验证消息通→防重复。**SIT 焦点是编排层的端到端行为，底盘单测不重复跑（引用基线）**。

## 1. 测试目标（issue #142 四条 AC 直译）

- **AC-1**: 手动断网 5 分钟后恢复，gateway 在 ≤2 个探测周期（约 2 分钟）内自动恢复消息处理
- **AC-2**: 手动休眠后唤醒，gateway 在 ≤2 个探测周期内恢复消息处理
- **AC-3**: 重复断网/唤醒不产生重复进程、重复 Socket 连接、重复消息处理
- **AC-4**: 单元/集成测试覆盖 + Windows 实机验收，PR 评审回归后关单

## 2. 分层用例

### L0 静态基线（每轮 SIT 前置）

| ID | 用例 | 判定 |
|---|---|---|
| ST-CG142-001 | `npx tsc --noEmit` + 全量 `node --test`（串行 `--test-concurrency=1`，Windows 陷阱见 #145 报告） | exit 0 / 325+ 全过（基线随 main 增长） |

### L3 Linux 实机模拟（小马，zederer-mbe）

| ID | 用例 | 步骤 | 判定 |
|---|---|---|---|
| ST-CG142-002 | **断网 5min 自愈**（AC-1） | ① `chorusgate start`，确认 status 心跳正常 ② `sudo ip link set <nic> down` 5min ③ up 恢复 ④ 立即向 agent 发 Slack 测活消息，记录恢复时延 | 恢复时延 ≤2 探测周期（默认 probe 60s×2）；Slack 回复正常；日志含 `[liveness]` 重连轨迹 |
| ST-CG142-003 | **挂起跳变模拟**（AC-2 Linux 等价） | ① daemon 正常运行 ② `kill -STOP <pid>` 5min（冻结=status.json 心跳停滞，等价 S0ix 时钟跳变） ③ `kill -CONT <pid>` ④ 观察首 tick 是否触发 suspend-detected → 主动探测 → 必要时 forceReconnect | 日志含 `suspend detected: ~300s jump`；恢复后 ≤1 个探测周期内消息通（suspend 路径跳过 N 次累积，见 spec §6 要点 4） |
| ST-CG142-004 | **重复循环防重**（AC-3） | ST-CG142-002/003 交替执行 ≥3 轮，每轮后检查：pid 文件与 `ps` 实际进程 1:1；`ss -tnp \| grep <pid>` WebSocket 连接数不增；测活消息无重复回复 | 3 轮零重复进程/连接/消息 |
| ST-CG142-005 | **看门狗衔接**（编排层兜底） | ① ST-CG142-003 后若 daemon 自杀（编排不可恢复路径）② 手动/计划任务跑 `chorusgate-watchdog.sh` | ≤1 轮询周期 restart 拉起；拉起后消息通 |

### L4 Windows 实机（小克执行 ainize-dev / 乐老板本机，用例设计小马）

| ID | 用例 | 步骤 | 判定 |
|---|---|---|---|
| ST-CG142-006 | **真实休眠唤醒**（AC-2 本体） | ① Windows 笔记本 `chorusgate start` ② 合盖/开始菜单休眠 ≥5min ③ 唤醒 ④ 计时至 Slack 测活消息回复 | ≤2 探测周期恢复；gateway.log 含 suspend detected + 恢复轨迹 |
| ST-CG142-007 | **Windows 断网**（AC-1 双平台） | 禁用网卡 5min → 启用（或拔网线） | 同 ST-CG142-002 判定 |
| ST-CG142-008 | **watchdog schtasks**（AC-2 兜底） | 注册计划任务（5min 周期）→ kill daemon → 等待 | ≤1 周期拉起；需管理员权限与 #138 require-admin 兼容 |

## 3. 执行顺序与分工

1. 小克 #142 实现落地 → PR → 评审（小马参评，重点：编排层与底盘 LivenessMonitor 的边界、防重复启动的互斥手段）
2. Dev Ready 标注 SHA → 小马跑 L0 + L3（002-005），出 SIT 报告
3. L4 由小克 Windows 实机执行（006-008），沿 #141/#148 交叉验证协作模式
4. 全绿 → 回归清单 + 关单；任何失败 → 报告 + issue 重开流程（sprint-handoff）

## 4. 风险与注意

- **`kill -STOP` 等价性**：STOP 冻结用户态进程但系统时钟照走，与真实 S0ix 的偏差在于网络栈状态——真实休眠回来 TCP 半开更常见，故 L4 006 为 AC-2 最终判定，L3 003 只验编排逻辑。
- **probe 默认 60s×2 = 2min 恢复窗**：AC 说"2 个探测周期"，若实现改为 env 可调，SIT 用默认值计时，不调参作弊。
- **测活消息去重判定**：重复回复可能是 Slack 侧重投，SIT 报告须附 gateway.log 消息 ID 证据链，不能只看肉眼。
- 本计划基于 main@6b8a695 底盘；若 #142 实现重构底盘接口（如 forceReconnectAll 签名变化），用例 002-005 按新接口等价改写，判定标准不变。
