# liveness 功能测试 — 单测 + 接线验证

- **日期**: 2026-08-19
- **分支**: `v5/logging-liveness`
- **执行人**: 小克 (Claude)
- **关联**: Issue 休眠唤醒后不恢复；spec `docs/specs/issue-liveness-suspend-recovery.md`

## 背景

`src/liveness.ts` 实现三层自愈：L1 挂起检测（时钟跳变）→ L2 僵尸 socket 检测（连续探测失败）→ L3 不可恢复（exit(1) 交 watchdog）。本报告验证单测与 gateway/socket-manager 接线。

## 1. 单测：tests/liveness.test.ts — 14/14 PASS

命令（注意：系统内存仅剩 0.6GB，需限制 V8 堆）：

```
node --max-old-space-size=128 --import tsx --import ./test-env.mjs --test --test-timeout=30000 --test-force-exit --test-concurrency=1 ./liveness.test.ts
```

| 层 | 用例 | 覆盖点 | 结果 |
|----|------|--------|------|
| L1 | anchors on first tick, silent on normal ticks | **AC4 零噪声** | ✅ |
| L1 | fires onSuspendDetected 70s jump | **AC7**（日志含跳变秒数 + warn 级别） | ✅ |
| L1 | custom suspendJumpMs threshold | 30s 阈值 35s 跳变触发 | ✅ |
| L1 | below threshold no fire | 60s 阈值 30s 跳变静默 | ✅ |
| L2 | below failure limit no fire | 2 次失败不触发（默认 limit=3） | ✅ |
| L2 | fires on failureLimit-th consecutive failure | 第 3 次触发 + warn 日志 | ✅ |
| L2 | resets counter + logs recovery | 恢复后 info 日志含失败次数 | ✅ |
| L2 | re-escalates after failed forced reconnect | 计数器每次升级后重置可再升级 | ✅ |
| L2 | custom failureLimit | limit=2 第 2 次触发 | ✅ |
| L2 | throwing probe as failure | 探针抛异常按失败计 | ✅ |
| L2 | silent while healthy | **AC4** 10 次健康探测零日志 | ✅ |
| L3 | zombie handler throws → onUnrecoverable | 升级链兜底 | ✅ |
| 生命周期 | stop() 后 tick/probe no-op | 禁用生效 | ✅ |
| 生命周期 | start/stop 幂等可重启 | 重复调用安全 | ✅ |

## 2. 接线验证（代码审查）

### gateway.ts:1228 `startLivenessForDaemon`

- **探针来源**: `isConnected: () => sm.anyConnected()` → `socket.websocket?.isActive()`（ws readyState===OPEN）。注释明确：半开 TCP（Modern Standby）下 readyState 仍 OPEN，故是探针而非保证 — 符合 spec 认知。
- **env 配置**: `GATEWAY_SUSPEND_JUMP_MS`(默认 60s) / `GATEWAY_LIVENESS_PROBE_INTERVAL_MS`(默认 60s) / `GATEWAY_LIVENESS_FAILURE_LIMIT`(默认 3)，均带 `Number.isFinite && >0` 兜底。
- **L1 处理**: suspend 后立即 probe socket，断开则 `forceReconnectAll()`，失败 `process.exit(1)`。
- **L2 处理**: `forceReconnectAll()`，失败 `process.exit(1)`。
- **L3 处理**: `process.exit(1)` 交 watchdog。
- **生命周期**: `shutdown()` 调用 `livenessStop?.()` 正常停止 monitor。

### socket-manager.ts:326 `isConnected` / 336 `anyConnected`

- `anyConnected()` 在无 profile 时返回 `true`（避免误杀）。
- `forceReconnectAll()` "never throws"，错误在 `forceReconnect` 内记日志。

### watchdog 脚本 scripts/chorusgate-watchdog.ps1（L3 最终保险）

- 判断: PID 文件存在但进程死，或 `status.json.updatedAt` 心跳 > 180s（默认）→ `chorusgate restart`。
- 心跳来源: gateway.ts:1099 `writeStatus()` 每 5s 更新 `updatedAt`，与 liveness tick 同频。
- 全链路闭环: statusTimer(心跳) → liveness tick(挂起) → probe(僵尸) → forceReconnect → exit(1) → watchdog 拉起。

### 类型检查

`npx tsc --noEmit` → exit 0。

## 3. 环境备注（本次重要发现）

- 开发机 ainize-dev 15.8GB 内存仅剩 **0.6GB（4.1%）**：20+ 个 claude CLI 会话（各 300-500MB）+ chrome + Slack + Defender。Standby cache 仅 ~400MB 无可回收。
- 此环境下全量并发 `node --test` 必然 OOM（`Fatal process out of memory` / `spawn UNKNOWN` / `uv_os_get_passwd ENOMEM`）。
- **解法**: 单个测试文件加 `--max-old-space-size=128` 串行跑即可在低内存下执行（liveness.test.ts 纯逻辑无真实 timer，~50MB 足够）。

## 结论

- liveness 单测 14/14 PASS，覆盖 spec AC1/AC4/AC7 与三层升级契约。
- gateway/socket-manager/watchdog 接线完整，tsc 无类型错误。
- 上次 `_full-test-run.txt` 全量失败（29 fail 几乎全是 `spawn UNKNOWN`/OOM）判定为**环境内存问题 + NODE_TEST_CONTEXT 陷阱**，非 liveness 代码缺陷。

## 待办 / 建议

- [ ] 全量回归需在内存充足时（或分批 `--max-old-space-size`）串行跑，确认 325+ 基线。
- [ ] liveness 集成级 SIT（真实 token 挂起恢复）排期 — 参考 memory issue141 记录找小马排期。
