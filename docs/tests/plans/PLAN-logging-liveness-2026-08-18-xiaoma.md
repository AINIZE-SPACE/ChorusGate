# 测试策略 - Issue #141 日志轮转 + `chorusgate log` 命令 & 休眠唤醒 Liveness 自愈

> **Issue**: [#141](https://github.com/AINIZE-SPACE/ChorusGate/issues/141)（日志域）+ 待建（liveness 域）
> **Spec**:
>   - `docs/specs/issue-logging-rotation-log-command.md`
>   - `docs/specs/issue-liveness-suspend-recovery.md`
> **Branch**: `v5/logging-liveness`
> **Test Owner**: 小马 (U0B91BVKTL2)
> **Date**: 2026-08-18
> **Status**: Phase 1（#141 日志）Dev Ready 于 `1849fad`（功能基线 `26bbc2e` + 补充提交），SIT 可执行；Phase 2（liveness）依赖开发落地，用例已按 spec 设计、暂阻塞
> **Update**: 2026-08-19 评审核对——与当前文件系统状态一致；Dev Ready SHA、测试计数、回归基线已按现状更新

---

## 0. 阶段划分

本分支同时含两个域：**日志域（#141，已开发完成）** 与 **liveness 域（待建 issue，未开发）**。SIT 分两阶段，避免 liveness 阻塞日志验收：

| 阶段 | 范围 | 依赖 | 状态 |
|------|------|------|------|
| Phase 1 | #141 日志轮转 + `chorusgate log` | Dev Ready `1849fad`（基 `26bbc2e`） | 可立即执行 |
| Phase 2 | liveness 挂起/假活检测 + 看门狗 | `src/liveness.ts` + watchdog 脚本未产出 | 阻塞，用例先设计 |

---

## 1. 测试目标

### Phase 1 — 日志域（spec §3 验收标准 AC1-AC11）

1. 新日志行格式 `[ts YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [module] msg`（AC1）
2. 超 5MB 或跨日自动轮转，旧文件 `gateway.log.YYYYMMDD.old`，新写入进新文件（AC2）
3. 超保留天数的 .old 自动清理（AC3）
4. `chorusgate log [--agent <id>]` 默认 50 行 / `--lines N` / `--follow` / 无 `--agent` 回落 default（AC4-AC7）
5. `chorusgate help` 列出 log 命令及参数（AC8）
6. stdio 改 ignore 后 `start`/`status` 正常工作，启动期错误可定位（AC9）
7. tsc + 全量测试无回归（AC10）
8. Linux + Windows 双平台（AC11）

### Phase 2 — liveness 域（spec §3 验收标准 AC1-AC7，待开发）

9. 时钟跳变挂起检测，日志含跳变时长（AC7）
10. 断网假活自动重连，≤2 探测周期恢复（AC1）
11. 看门狗死进程拉起，≤1 轮询周期（AC2）
12. `chorusgate status` 显示心跳年龄 + 过期 ⚠️ 提示（AC3）
13. 正常运行零日志噪音（AC4）
14. 跨日运行日志格式稳定（AC6）

---

## 2. 测试分层

| 层级 | 名称 | 工具 | 目的 | 执行者 |
|------|------|------|------|--------|
| L0 | TypeScript 类型检查 | `npx tsc --noEmit` | 零编译错误 | 小马 |
| L1 | 单元测试 | `node --import tsx --import ./tests/test-env.mjs --test --test-timeout=30000 --test-force-exit tests/*.test.ts` | 纯函数逻辑正确 | 小马 |
| L2 | 集成/回归 | `npm run test:integration` | 模块间协作 + 现有回归 | 小马 |
| L3 | CLI 烟测 + 真实 daemon | 可执行 shell 脚本 / 手动命令 | 端到端 CLI + daemon 行为 | 小马（Windows 侧小克协助） |
| L4 | 手工验收 | 人工核对 | 文档/行为一致性 | 小马 → 小扣 |

---

## 3. 测试范围与用例 ID 前缀

| 前缀 | 阶段 | 范围 | Spec 对应 |
|------|------|------|-----------|
| ST-CG141-001~013 | Phase 1 | 日志格式、轮转、清理、log 命令、follow、help、start/status、回归、跨平台 | 日志 spec AC1-AC11 |
| ST-CGLIV-001~008 | Phase 2 | 挂起检测、假活重连、看门狗、心跳年龄、噪音、跨日 | liveness spec AC1-AC7 |

### 3.1 已有单元测试覆盖（L1/L2，不重复设计，仅作回归基底）

| 测试文件 | 覆盖点 | 对应 AC |
|----------|--------|---------|
| `tests/logger.test.ts`（14 例） | 格式、级别过滤、按 size 轮转、跨日轮转、prune、缺目录自建、console 重定向、多行折叠、参数序列化、循环引用、字符串 level、fail-closed stderr | AC1/AC2/AC3 |
| `tests/log-command.test.ts`（10 例） | 默认 50 行、`--lines`/`-n`、agent 作用域 + default 回落、缺文件 exit 1、clamp/取整/无尾换行/空文件/少于请求行数返回全部 | AC4/AC5/AC7 |
| `tests/cli-args.test.ts`（log 段 9 例） | `--lines` 两种分隔、`-n`、默认 undefined、`--follow`/`-f`、组合、不影响 start/stop、NaN、尾随 `--lines`/`-n` 忽略 | AC4/AC5/AC6 |

**SIT 补的是单元测试测不到的部分**：真实 daemon 进程行为、轮转与 `log --follow` 的运行时交互、stdio 改造后 start/status 端到端、跨平台文件锁。

---

## 4. 测试环境

### 4.1 执行机器

- **主测**: zederer-mbe (Ubuntu 26.04, IP 192.168.1.147) — Linux：轮转、`iptables` 断网假活模拟、watchdog `.sh`
- **交叉验证**: ainize-dev (Windows 11, IP 192.168.1.247) — Windows：轮转文件锁、`--follow`、schtasks 看门狗注册由小克/乐老板确认

### 4.2 前置条件

- Node.js + npm 已安装
- 仓库已 clone，工作在 `v5/logging-liveness` 分支（Phase 1 需 ≥ `1849fad`）
- 小克已完成功能开发 + 单元测试 + 自测记录（Dev Ready）
- `~/.chorusgate/` 目录可用；SIT 用独立 agent id（如 `sit-log`）不触碰真实配置

### 4.3 测试隔离

- 所有 Phase 1 用例使用临时 `CHORUSGATE_HOME`（`CHORUSGATE_HOME=/tmp/cg-sit-home-XXX`），避免污染真实 `~/.chorusgate/`
- Phase 2 网络断连用例在**非生产 agent** 上执行，且确认无进行中的真实会话
- 不使用真实 Slack token，token 为 `xoxb-test-*` / `xapp-test-*` 格式
- 每个用例结束后清理临时 home 与 daemon 进程

---

## 5. SIT 准入交付件检查清单

Phase 1 小克 Dev Ready 必须提供：

- [ ] **Test strategy** — 本文档
- [ ] **Test cases + executable scripts** — `docs/tests/cases/` + `tests/logger.test.ts`/`log-command.test.ts`/`cli-args.test.ts`
- [ ] **Dev self-test record** — 小克开发自测记录（commit message 或 PR description，`1849fad`/`26bbc2e`）
- [ ] **Change list** — 变更文件清单
- [ ] **Dev commit pushed** — `1849fad` 已 push 到 `v5/logging-liveness`

Phase 2 阻塞项（未交付，用例已设计）：`src/liveness.ts`、watchdog 脚本 `scripts/chorusgate-watchdog.{ps1,sh}`、`status` 心跳年龄输出。

**缺任一项，小马不开始对应阶段 SIT。**

---

## 6. Phase 1 测试用例明细（#141 日志域）

### 6.1 ST-CG141-001~004: 真实 daemon 轮转行为

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 001 | 真实 daemon 日志格式 | `CHORUSGATE_HOME=/tmp/cg-sit-home-001`，`chorusgate start`，等启动完成；`grep -E '^\[ts [0-9]{4}-[0-9]{2}-[0-9]{2}' gateway.log` | 全部新日志行匹配 `^\[ts \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|WARN|ERROR)\] \[(daemon|gateway|socket-manager)\] `；无旧格式裸行 | L3 |
| 002 | 按 size 轮转（活 daemon） | `GATEWAY_LOG_MAX_SIZE_MB=1`，启动后持续发消息触发日志，直到当前 `gateway.log` 超 1MB | 生成 `gateway.log.<YYYYMMDD>.old`；新写入落在新 `gateway.log`；旧文件内容不在新文件出现 | L3 |
| 003 | 跨日轮转 | `GATEWAY_LOG_MAX_SIZE_MB=100`；手动将当前 `gateway.log` mtime 改到昨天（或改系统时钟跨日）后继续写 | 触发一次轮转，生成带昨日日期戳的 `.old`，新写入进新 `gateway.log` | L3 |
| 004 | prune 过期 .old | 预置 8 天前与 1 天前的 `.old`，设 `GATEWAY_LOG_KEEP_DAYS=7`，触发一次轮转 | 8 天前 .old 被删除，1 天前 .old 保留 | L3 |

### 6.2 ST-CG141-005~008: `chorusgate log` 命令

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 005 | log 命令对真实 daemon | 启动 daemon 后 `chorusgate log`（无 --agent）；`chorusgate log --agent sit-log --lines 100` | 默认输出最近 50 行；`--lines 100` 输出 100 行；无 `--agent` 输出 default 的日志 | L3 |
| 006 | `--follow` 实时跟随 | `chorusgate log --follow`，期间 daemon 持续产生日志 | 新行实时追加到 stdout；Ctrl+C 干净退出 | L3 |
| 007 | `--follow` 跨轮转 | `chorusgate log --follow`，期间触发 size 轮转（`GATEWAY_LOG_MAX_SIZE_MB=1`） | 轮转后继续输出**新** `gateway.log` 的追加行，不重复旧文件尾部、不中断（followLog 检测 size 缩小后从 0 重新锚定） | L3 |
| 008 | help 输出 | `chorusgate help` | 列出 `log` 命令，含 `--lines N / -n N` 与 `--follow / -f` 说明 | L3 |

### 6.3 ST-CG141-009~011: 启动链路与错误路径

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 009 | stdio 改造后 start/status | `chorusgate start --agent sit-log` → `chorusgate status --agent sit-log` | start 成功（8s 内 PID+status 就绪）；status 显示 running；gateway.log 已有内容（daemon 模块级 logger 初始化） | L3 |
| 010 | 日志不泄漏 token | daemon 运行中检查 gateway.log | 全文不含 `xoxb-`/`xapp-` token 值（仅键名或脱敏） | L3 |
| 011 | 缺日志错误路径 | `chorusgate log --agent <不存在的id>` | exit code 1，stderr 含文件路径与 "start the gateway first" 提示 | L3 |

### 6.4 ST-CG141-012~013: 回归与跨平台

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 012 | 回归 | `npx tsc --noEmit` + `npm run test:integration` | 零编译错误；全部测试通过（当前实测 325/325，以 SIT 执行时点为准） | L0/L1/L2 |
| 013 | Windows 交叉验证 | 在 ainize-dev 重复 002/006/007 | 轮转 rename 不因文件锁失败；`--follow` 可用（watch + 200ms 轮询兜底） | L3 |

---

## 7. Phase 2 测试用例明细（liveness 域，待开发）

> 所有用例在 `src/liveness.ts` 与 watchdog 脚本落地后执行。以下输入/预期依据 `docs/specs/issue-liveness-suspend-recovery.md` §3。

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 001 | 挂起检测（Layer 1） | `GATEWAY_SUSPEND_JUMP_MS=60000`；手动将系统时钟前拨 2 分钟（或冻结进程后恢复），观察 statusTimer 下个 tick | 日志出现 `[liveness] suspend detected: <N>s jump`，跳变时长 >60s；daemon 不崩溃 | L3 |
| 002 | 假活重连（Layer 2） | `iptables -A OUTPUT -j DROP`（或 `ip link set dev <nic> down`）5 分钟，再恢复 | 恢复后 ≤2 个探测周期（默认 60s×2≈2 分钟）内自动 `disconnect()+connect()` 重建 Socket Mode 连接；发 Slack 消息验证回复 | L3 |
| 003 | 看门狗拉起（Layer 3） | `kill -9 <pid>` 杀死 daemon；运行 `scripts/chorusgate-watchdog.sh` | ≤1 轮询周期（默认 5 分钟）内 `chorusgate restart` 拉起，状态恢复 running | L3 |
| 004 | status 心跳年龄 | daemon 运行中 `chorusgate status`；再停掉 daemon（PID 存活但 status.json.updatedAt 过期） | 正常时显示 uptime + 心跳年龄；`updatedAt` 超过 `GATEWAY_HEARTBEAT_STALE_MS`（默认 180s）时输出 `⚠️ heartbeat stale` 提示 | L3 |
| 005 | 正常运行零噪音 | daemon 正常运行 30 分钟，有正常消息流量 | 日志无任何 `suspend detected` / `zombie` / 重连事件（正常 tick 不写日志） | L3 |
| 006 | 回归 | `npx tsc --noEmit` + `npm run test:integration` | 零错误；无回归 | L0/L1/L2 |
| 007 | 跨日日志格式 | daemon 跨日运行 | 跨日后日志仍为 `[ts YYYY-MM-DD HH:mm:ss.SSS]` 格式，轮转正常 | L3 |
| 008 | Windows 看门狗 | ainize-dev 上 `schtasks` 注册 `chorusgate-watchdog.ps1`，手动 kill daemon | 计划任务在下个周期拉起；注册说明与 README 一致 | L3 |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Phase 2 liveness 未开发，用例无法执行 | 用例已按 spec 设计完成；Phase 1 先行验收，不阻塞 #141 交付 |
| 断网模拟影响真实环境 | 仅在独立 agent + 临时 home 执行；选非生产时段 |
| Windows 轮转 rename 遇文件锁 | 已在 unit 层用 appendFileSync（无持 fd）规避；SIT 在 ainize-dev 实测 013，失败则退化验证 truncate 路径 |
| `--follow` 跨轮转行为未单测（阻塞性） | SIT 007 专门覆盖；followLog 有 size 缩小重锚定逻辑，属重点验证点 |
| 时钟前拨影响其他服务 | 003/001 优先用 `utimesSync` mtime 模拟，系统时钟改动需提前协调 |
| 看门狗 schtasks 需管理员权限 | 与 #138 require-admin 方向一致；由小克/乐老板确认 |

---

## 9. SIT 输出

SIT 完成后，小马交付：

1. **Execution log** — `npm run build` + `npm run test:integration` + CLI 烟测原始输出
2. **Test report** — `docs/tests/cases/2026-08-18-logging-liveness-sit-xiaoma.md`，含 pass/fail 汇总表，按阶段分块
3. **Archive** — 上述全部提交到 `docs/tests/cases/`
4. **通知** — SIT Ready 后通知小扣验收

---

## 10. 依赖与阻塞

- **Phase 1 依赖**: 小克 Dev Ready `1849fad`（功能代码 + 单元测试 + 自测记录 + 变更清单 + 已 push）
- **Phase 2 阻塞**: `src/liveness.ts`、watchdog 脚本、`status()` 心跳年龄输出均未产出；issue 待小扣立项
- **跨平台**: Linux 主测（小马），Windows 交叉（小克/乐老板确认 schtasks）
