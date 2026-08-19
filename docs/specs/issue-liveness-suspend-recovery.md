# Spec: 休眠唤醒后 Gateway 进程不恢复（心跳 + 挂起检测 + 自愈）

> **Issue**: 待建（小扣立项，本 spec 先行） | **Epic**: —
> **Type**: Bug / Reliability | **Priority**: P2（乐老板定调"问题不严重"——常发场景已通过"合盖不动作"规避）
> **Analyst**: 小马 (U0B91BVKTL2)
> **Date**: 2026-08-18
> **Branch**: `v5/logging-liveness-spec`（spec 提交分支）

## 1. 问题分析

### 1.1 症状

乐老板笔记本合盖进入休眠，唤醒后 ChorusGate gateway 进程不再处理消息（日报 cron 不触发 / Slack 无响应）。需手工 `chorusgate restart` 才恢复。

### 1.2 根因定位

**文件**: `src/gateway.ts` L1048-1110（主循环）、`src/socket-manager.ts` L152-160（重连日志）

当前 daemon 是纯 `spawn` 的 Node 后台进程（`gateway-control.ts` L119-124，`detached: true` + `unref()`），**没有任何挂起/恢复感知与自愈机制**：

1. **无心跳**：daemon 已有 `setInterval(writeStatus, 5000)` 每 5s 写 `status.json`（gateway.ts L1087），但无人消费 `updatedAt` 做 liveness 判断。
2. **无挂起检测**：笔记本休眠时进程被冻结。恢复后 `@slack/socket-mode` 的 `reconnecting` 回调（socket-manager.ts L152）只有在底层 WebSocket 断开**事件**触发时才发。Windows 现代待机（Modern Standby / S0ix）下 TCP 连接可能半开（half-open）——没有数据往来时双方都察觉不到断连，重连回调**不会触发**，socket 处于"假活"状态。
3. **无看门狗拉起**：进程死了或假活，没有任何外层 supervisor 检测并 `restart`。`detached+unref` 意味着 CLI `start` 后与进程脱离关系。

### 1.3 结论

休眠唤醒后不恢复的根因是三层缺失：**无 liveness 探测（假活检测）、无挂起检测、无外部看门狗**。`reconnecting` 回调在半开连接场景失效，是"进程在但消息不来"的直接原因。

## 2. 设计方案

### 2.1 方案：daemon 内心跳 + 挂起检测 + 阶梯自愈（零新依赖）

按投入递增分三层，前一层失效才进下一层，全部在 daemon 内部实现，不依赖 OS 电源事件、不加运行时依赖：

**Layer 1 — 挂起检测（时钟跳变）**：复用现有 `statusTimer`（gateway.ts L1087），在回调里比较 `Date.now() - lastTickAt` 与设定间隔 5000ms：偏差 > 60s 即判定发生过系统挂起。零成本，因为恢复后的第一个 tick 天然就是"迟到"的 tick。

**Layer 2 — 假活检测（liveness probe）**：每 60s 检查 `socketModeClient.isConnected()`；连续 N=3 次失败（约 3 分钟）判定假活。此时主动调用 `client.disconnect()` + `connect()` 强制重建 Socket Mode 连接。半开 TCP 无法靠等待自愈，必须主动断开重连。

**Layer 2.5 — Slack RTM 聻听（可选，默认关）**：如 Layer 2 探测仍漏检（isConnected 标志位不反映真实 TCP 状态），加 `auth.test` API 调用作为更真实的探测（带超时）。默认关，仅在验证 Layer 2 不够时开启。

**Layer 3 — 看门狗退出（supervised restart）**：Layer 2 重连失败或 daemon 判断自身不可恢复时，进程 `process.exit(1)` 自杀，由外层看门狗拉起。看门狗不新建 supervisor 进程，而是**复用现有 `chorusgate status` CLI**：脚本化轮询 `status.json.updatedAt`，超过阈值（如 180s）未更新 + pid 存活 → `chorusgate restart`。可注册为 Windows 计划任务（schtasks，每 5 分钟）或手动脚本。

### 2.2 代码变更

**新增 `src/logger.ts`**（与本 spec 同批的日志模块，见姊妹 spec）与 **`src/liveness.ts`**：

```typescript
// src/liveness.ts（示意）
export function startLivenessMonitor(opts: {
  onSuspendDetected: () => void;   // Layer 1: 时钟跳变 → 日志 + 触发主动探测
  onZombieDetected: () => void;    // Layer 2: N 次探测失败 → disconnect+connect
  onUnrecoverable: () => void;     // Layer 3: 自杀退出，交给外层看门狗
}): void
```

**改动点**：

| 文件 | 位置 | 变更 |
|------|------|------|
| `src/gateway.ts` | L1087 `statusTimer` 回调 | 加挂起检测：`now - lastTickAt > 60_000` → 记日志 + 主动触发 liveness 探测 |
| `src/gateway.ts` | 主循环 init | 引入 `startLivenessMonitor()`，传入 `onZombieDetected` 强制重连 handler |
| `src/socket-manager.ts` | L152 `reconnecting` 附近 | 加 `isConnected()` 汇总查询 + `forceReconnect(profileId)`（内部 disconnect→connect） |
| `src/gateway-control.ts` | `status()`（L204） | 输出 `status.json.updatedAt` 距今年龄，>180s 打印 `⚠️ heartbeat stale` 提示 |
| 新 `scripts/chorusgate-watchdog.ps1`（Windows）/ `.sh` | — | 轮询 status.json，心跳过期+pid 存活 → `chorusgate restart`；可注册 schtasks |

### 2.3 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `GATEWAY_HEARTBEAT_STALE_MS` | `180000` | status.json.updatedAt 超过该毫秒数视为心跳过期（看门狗判定阈值，须 > statusTimer 5s × N） |
| `GATEWAY_LIVENESS_PROBE_INTERVAL_MS` | `60000` | Layer 2 isConnected 探测间隔 |
| `GATEWAY_LIVENESS_FAILURE_LIMIT` | `3` | 连续探测失败几次判定假活并强制重连 |
| `GATEWAY_SUSPEND_JUMP_MS` | `60000` | Layer 1 时钟跳变阈值（statusTimer 5s，偏差超过此值判定挂起） |

### 2.4 风险分析

| 风险 | 影响 | 缓解 |
|------|------|------|
| isConnected() 返回 true 但 TCP 半开（探测不真实） | 假活漏检 | Layer 2.5 auth.test 备选；看门狗（Layer 3）覆盖"消息真不来"的最终场景 |
| 时钟跳变误报（NTP 校时） | 无害日志 | 概率低、代价小（多一次主动探测） |
| daemon 自杀后看门狗不存在（未注册） | 服务中断 | restart 兜底仍在：status CLI 提示 + cron 日报缺失暴露问题 |
| Windows 计划任务需要管理员权限 | 部署门槛 | 与 #138（require-admin）方向一致，README 说明 |
| 强制重连风暴（Slack 限流） | 重连失败 | 阶梯自愈 + 失败上限后自杀交给看门狗，不做无限重试 |

### 2.5 与 #138/#140 的关系

- #138 已要求 Windows 管理员权限（`require-admin.ts` 已存在，bin/chorusgate.mjs L18-24）。看门狗 schtasks 注册沿同方向，无冲突。
- #140（`--agent-home`/`AGENT_HOME` wiring）会改 agent profile 加载路径，liveness 写 status.json 路径不变（`~/.chorusgate/<agent>/status.json`），无依赖冲突。

## 3. 验收标准

- [ ] AC1: 手动 kill 网络后 5 分钟恢复，gateway 不需手工干预在 ≤2 个探测周期（约 2 分钟）内自动恢复消息处理（发 Slack 消息验证回复）
- [ ] AC2: 手动 kill daemon 进程后，看门狗脚本能在 1 个轮询周期内 restart 拉起（Linux 用 .sh 验证，Windows schtasks 由小克/乐老板确认）
- [ ] AC3: `chorusgate status` 显示心跳年龄，心跳过期时输出 ⚠️ 提示
- [ ] AC4: 正常运行中（无挂起）零额外日志噪音（挂起/探测事件有日志，正常 tick 无日志）
- [ ] AC5: `npm run build`（tsc --noEmit）零错误，`npm test` 无回归（当前基线 147 tests）
- [ ] AC6: 跨日运行 daemon，日志按新 logger 格式输出（依赖姊妹 spec 的 logger 落地）
- [ ] AC7: 挂起检测日志包含跳变时长（如 `[liveness] suspend detected: 3600s jump`），便于事后审计

## 4. 优先级

**P2** — 常发场景已通过"合盖不动作"规避，且看门狗脚本可独立先行部署（不依赖 daemon 改动），风险低收益高。

## 5. SIT 验证方案（小马）

1. **假活模拟**：`chorusgate start` 后用 `sudo iptables`/`sudo ip link set dev <nic> down` 断网 5 分钟再恢复，验证自动重连（AC1）。
2. **看门狗**：手动 `kill -9 <pid>`，运行看门狗脚本，验证 restart（AC2）断网恢复验证（AC1）+ 死进程看门狗拉起（AC2）。
3. **心跳年龄**：`chorusgate stale heartbeat` 场景模拟（临时改 statusTimer 间隔）验证 status 输出（AC3）。
4. **回归**：tsc + 全量测试（AC5）。

## 6. 实现状态（小克，2026-08-19）

已在 `v5/logging-liveness` 实现，tsc 零错误；`src/liveness.ts`（17 例单测）+ `control-plane.test.ts`（status 心跳年龄，3 例新增）通过。commit 见分支 log。

**实现要点与 spec 的差异（有意为之，需 SIT 关注）**

1. **`src/liveness.ts` 独立 `LivenessMonitor`**（非 spec §2.1 建议的嵌入 statusTimer 回调）。Monitor 自带 tick(5s，同 statusTimer cadence)/probe(60s) 两个 unref'd interval，gateway main() 在 `startAll` 后启动。理由：逻辑内聚、tick/probe 可手动驱动注入 fake clock 单测、statusTimer 职责保持单一。
2. **假活探测用 `websocket?.isActive()`**：`@slack/socket-mode` 的 SocketModeClient **无公开 `isConnected()`**（已核实 d.ts），Layer 2 探测源改用底层 `rp.socket.websocket?.isActive()`（ws readyState===OPEN）。半开 TCP 下 readyState 仍可能 OPEN——与 spec 风险表一致，靠 Layer 3 看门狗兜底。
3. **Layer 3 退出由 gateway 决策**：liveness 模块只上报 `onUnrecoverable`，不直接 `process.exit`；gateway 的 handler 在 `forceReconnectAll()` 仍失败时 `process.exit(1)`。可测性优先。
4. **挂起后立即探测**：spec Layer 1 说"记日志 + 主动触发探测"，实现为 `onSuspendDetected` 内立即检查 `anyConnected()`，假活则直接 `forceReconnectAll()`（跳过 N 次失败累积），不等下一个 60s 探测周期。
5. **watchdog 脚本**：`scripts/chorusgate-watchdog.{ps1,sh}`。读 **pid 文件**（与 `livePid` 同源）+ `status.json.updatedAt`；死进程或心跳过期（>`GATEWAY_HEARTBEAT_STALE_MS`）→ `chorusgate restart --agent <id>`。支持 `CHORUSGATE_BIN`/`CHORUSGATE_HOME` 覆盖。
6. **status() 心跳年龄**：新增 `heartbeat: <age> ago` 行；`updatedAt` 年龄 > `GATEWAY_HEARTBEAT_STALE_MS`（默认 180s）输出 `⚠️ heartbeat stale — daemon may be hung; watchdog will restart it`（stale 时替代原 >20s busy 提示，不重复输出）。

**AC 状态**：AC3（心跳年龄）单测覆盖；AC7（跳变时长含于日志）单测覆盖；AC4（正常 tick/probe 零噪音）单测覆盖；AC1（断网自动重连 ≤2 探测周期）、AC2（看门狗 ≤1 轮询周期拉起）、AC6（跨日运行）待小马 SIT（真实网络断连 / kill -9 / 跨日）。

## 7. 配置项（实现对照）

spec §2.3 四变量均已在 gateway.ts `startLivenessForDaemon` 读取并 clamp 正数：

| 环境变量 | 默认值 | 读取位置 |
|---------|--------|---------|
| `GATEWAY_HEARTBEAT_STALE_MS` | `180000` | `gateway-control.ts` status() |
| `GATEWAY_LIVENESS_PROBE_INTERVAL_MS` | `60000` | `gateway.ts` startLivenessForDaemon |
| `GATEWAY_LIVENESS_FAILURE_LIMIT` | `3` | `gateway.ts` startLivenessForDaemon |
| `GATEWAY_SUSPEND_JUMP_MS` | `60000` | `gateway.ts` startLivenessForDaemon |
