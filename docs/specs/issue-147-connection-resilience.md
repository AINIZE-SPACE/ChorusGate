# Spec: 连接健壮性加固 — 代理隔离 + 全局异常兜底 + 重连退避/熔断 + watchdog 部署

> **Issue**: #147（Zederer 立项，P1 · area:reliability） | **Epic**: - | **合并 issue**: 2026-08-20 6am claude/codex 双 daemon 挂掉复盘；#148 为同需求重复 issue（待合并）
> **Type**: Bug / Enhancement | **Priority**: P1（daemon 无自愈，网络抖动即双挂）
> **Analyst**: 小克 (U0B8VHLHJAX)
> **Date**: 2026-08-20
> **Branch**: `v5/logging-liveness`
> **Status**: ✅ 开发完成（`3824ae0` + 传输契约对齐提交）→ 待 SIT（小马）→ 验收关单（小扣）

## 1. 问题分析

### 1.1 症状（2026-08-20 06:10–06:41）

- claude 与 codex 两个 gateway daemon 先后崩溃且无自愈，`chorusgate status` 显示 stopped，直到 08:15 手动重启。
- 时间线（`~/.chorusgate/<agent>/gateway.log`）：
  - 00:14 / 00:30：同类抖动（pong 超时 + ECONNRESET），liveness 自愈成功。
  - 06:10 起：claude 连续 ECONNRESET → 06:12/06:15/06:18 三次 zombie 强制重连 → 06:19–06:20 四次 connect→connected 循环 → 06:38–06:41 每 5–10s 重连风暴 → 06:41:38 `WebSocket was closed before the connection was established` 进程死亡。
  - codex：06:15:33 zombie 强制重连后死亡。

### 1.2 根因

1. **直接原因**：06:10–06:41 出站网络中断（web-api 直连 ECONNRESET、socket-mode pong 超时）。
2. **代理澄清**：`@slack/web-api` v7 显式 `proxy:false`（`WebClient.js` 禁 axios 自动代理），`@slack/socket-mode` 未配 proxy agent —— **Slack 连接本来就不走代理**，ECONNRESET 是直连失败。代理 `127.0.0.1:7890` 只被 spawn 的 claude/codex 子进程消费（env 从 daemon 继承，daemon env 来自 go.ps1/.env.ps1 写入的 User 级变量）。但当前机制把两者耦合在同一个 process.env 上：daemon 自身出站与子进程代理无法独立控制。
3. **放大原因**：
   - 无 `uncaughtException/unhandledRejection` 全局兜底：socket 库内部 rejection（"WebSocket was closed before the connection was established"）直接崩进程，绕过 liveness 设计的 `process.exit(1)→watchdog` 路径，且未留 exit 日志。
   - `@slack/socket-mode` 内建重连为线性退避（`clientPingTimeoutMS * failures`），无退避上限、无抖动、无熔断 → 网络中断时 5–10s 硬重连风暴。
   - liveness 重连失败即 `process.exit(1)`，依赖 watchdog 拉起；但 `scripts/chorusgate-watchdog.ps1` 从未注册进 Task Scheduler → 死了没人拉。

## 2. 需求（Zederer 立项）

1. **代理隔离**：ChorusGate daemon 直连 Slack（不走代理）；spawn 的 agent CLI（claude/codex）根据实际需要走代理（可选配置）。
2. **异常日志**：增加异常日志 + 堆栈信息，可写独立异常日志文件。
3. **全局异常捕捉**：`unhandledRejection` / `uncaughtException` 兜底，不再静默崩溃。
4. **重连退避 + 熔断**：指数退避 + 随机抖动 + 熔断，避免网络中断时重连风暴。
5. **watchdog 部署**：`chorusgate install/uninstall`（及 `watchdog install/uninstall` 别名）注册系统服务或计划任务。

## 3. 设计

### 3.1 连接路径隔离（Slack 直连 + agent 可选代理）

- 新增 `src/transport.ts`，统一传输模式解析（对齐 #147 spec §1 配置名）：
  - `CHORUSGATE_SLACK_TRANSPORT=direct|proxy|inherit`，**默认 direct**：
    - direct：Slack Web API + Socket Mode 直连。@slack/web-api v7 `proxy:false`、socket-mode 未配 proxy agent、`ws` 不读 `HTTP_PROXY` —— **天然不走代理，无需改 process.env**。
    - proxy：经 `CHORUSGATE_PROXY_URL` 走代理。用 `https-proxy-agent` 构造 http.Agent，经 `SocketModeClient.clientOptions.agent` 透传（源码确认该 agent 同时用于 WebClient 的 auth.test 与 WebSocket 的 `httpAgent` 两腿）。
    - inherit：不干预（对 Slack 实际等同 direct，保留显式选项语义）。
  - `CHORUSGATE_AGENT_PROXY=direct|proxy|inherit`，**默认 inherit**（子进程继承宿主代理，go.ps1 现状零改动迁移）：
    - direct：spawn 子进程 env 剥离全部代理变量（claude/codex 直连）。
    - proxy：spawn 子进程 env 注入 `CHORUSGATE_PROXY_URL`。
    - inherit：子进程 env 保持继承的代理变量。
  - `CHORUSGATE_PROXY_URL`：proxy 模式的代理地址。优先级：`CHORUSGATE_PROXY_URL` > 旧配置 `GATEWAY_AGENT_PROXY`（设了即视为 agent proxy 模式）> 继承的 `http_proxy/https_proxy/all_proxy`。
- **关键约束（spec §1 + 小马 SIT D1-5）：不修改全局 process.env**。隔离只作用在 spawn 子进程 env（`buildAgentSpawnEnv` 返回值）与 Slack SDK 的 agent 选项，daemon 自身 process.env 不动 → Slack transport 与 provider 子进程互不污染。
- `src/providers/_spawn-helpers.ts` `buildSpawnEnv()`：按 `agentTransportConfig()` 构造子进程 env + 注入 per-profile token。
- `src/gateway.ts`：bootstrap 后解析两套 transport 配置，`getSocketManager().setSlackAgent(buildSlackAgent(slackCfg))`；日志只记 mode + 代理 host（不露认证信息）。

### 3.2 异常日志 + 全局异常捕捉

- `src/logger.ts`：
  - `createLogger` 新增 `errorFile?: string`：error 级日志额外写入独立文件（复用同一套轮转逻辑）。
  - 新增 `installGlobalErrorHandlers(logger)`：
    - `unhandledRejection` → 记录堆栈，**继续运行**（6am 崩溃主因）。
    - `uncaughtException` → 记录堆栈，`process.exit(1)`（交给 watchdog 重启；不可安全继续）。
- `src/gateway-paths.ts`：新增 `getErrorLogFile(agentId)` → `~/.chorusgate/<agent>/error.log`。
- `gateway.ts`：bootstrap 后调用 `installGlobalErrorHandlers(logger)`；transport 接线见 §3.1（`slackTransportConfig()`/`agentTransportConfig()`/`setSlackAgent`，**不修改全局 process.env**）。
- CLI：`chorusgate log --error` 读取独立异常日志。

### 3.3 重连指数退避 + 抖动 + 熔断

- 新增 `src/reconnect-policy.ts`（纯逻辑，可用假时钟单测）：
  - 指数退避：`min(maxDelay, base * multiplier^failures)`，叠加 `±jitterRatio` 随机抖动。
  - 熔断：连续失败达 `circuitOpenAfter` 次 → 熔断打开 `circuitCooldownMs`，期间不再尝试；冷却后 half-open 试连一次，成功即重置。
- `src/socket-manager.ts`：
  - `SocketModeClient` 构造改 `autoReconnectEnabled: false`（关掉库内线性重连风暴）。
  - 每 profile 挂一个 `ReconnectPolicy`；连接成功 `recordSuccess()`；断开/失败 `recordFailure()` 并按策略调度重连。
  - `forceReconnect` / `forceReconnectAll` 走策略：熔断打开时跳过（返回 false 但不再触发 liveness exit）。
- `src/gateway.ts` `startLivenessForDaemon`：zombie/suspend 重连失败不再直接 `process.exit(1)`；改为若熔断持续超 `GATEWAY_RECONNECT_MAX_DOWN_MS`（默认 10min）仍未恢复 → `process.exit(1)` 交给 watchdog。
- 配置（均可选）：`GATEWAY_RECONNECT_BASE_DELAY_MS=1000`、`GATEWAY_RECONNECT_MAX_DELAY_MS=60000`、`GATEWAY_RECONNECT_MULTIPLIER=2`、`GATEWAY_RECONNECT_JITTER=0.3`、`GATEWAY_CIRCUIT_OPEN_AFTER=5`、`GATEWAY_CIRCUIT_COOLDOWN_MS=300000`、`GATEWAY_RECONNECT_MAX_DOWN_MS=600000`。

### 3.4 watchdog install/uninstall

- 顶层 `chorusgate install [--agent <id>]` / `chorusgate uninstall [--agent <id>]`（spec §4 + ST-NR-106 口径），`chorusgate watchdog install|uninstall` 为等价子命令别名。
- Windows：`schtasks /Create /TN chorusgate-watchdog-<agent> /TR "powershell -NoProfile -ExecutionPolicy Bypass -File <abs watchdog.ps1> -Agent <agent> -Bin \"<node> <abs bin>\"" /SC MINUTE /MO 5 /RL HIGHEST /F`；卸载 `/Delete /TN ... /F`（任务不存在视为幂等成功）。
- Linux：生成 systemd user timer（`~/.config/systemd/user/`）+ `systemctl --user enable --now`。
- 复用现有 `scripts/chorusgate-watchdog.ps1`；安装时把重启命令解析为绝对路径写入任务，避免 schtasks 环境 PATH 缺失。
- 安全：install/uninstall 只动系统任务，**绝不删除 profile/.env/token**（ST-NR-106/107 断言）。

## 4. 验收（AC）

- AC1 代理隔离：`CHORUSGATE_SLACK_TRANSPORT=direct`（默认）时父进程存在 `HTTP_PROXY/HTTPS_PROXY` 也能正常连 Slack；spawn 子进程 env 按 `CHORUSGATE_AGENT_PROXY` 构造（direct 剥离 / proxy 注入 / inherit 继承）；**不修改全局 process.env**（D1-5 断言）。
- AC2 异常兜底：人为抛 `unhandledRejection` 不崩 daemon 且有堆栈日志进 error.log；`uncaughtException` 记录后 exit(1)。
- AC3 退避熔断：连续断连后重连间隔指数增长带抖动；超过阈值后熔断打开不再硬连；冷却后自愈。
- AC4 watchdog：`install` 后计划任务存在且脚本可执行；模拟 daemon 死亡后 5 分钟内自动重启；`uninstall` 移除任务且**不删 profile/token**。
- AC5 回归：`npx tsc --noEmit` 通过、`npm test` 全绿、真实 CLI 验证 `start/status/log --error/install/uninstall`。

## 5. 测试计划

- `tests/transport.test.ts`：`parseTransportMode` 三态/非法抛错、slack/agent 配置解析、`buildAgentSpawnEnv` direct/proxy/inherit、**无全局 env 变更断言**、`buildSlackAgent` proxy 模式。
- `tests/reconnect-policy.test.ts`：假时钟驱动退避序列、熔断打开/冷却/自愈。
- `tests/logger-error-file.test.ts`：error 级写独立文件、轮转、`installGlobalErrorHandlers` 不崩进程（子进程隔离验证）。
- CLI 实测：`install --agent claude`（schtasks 验证）→ `uninstall`、`log --error`。
