# Slack `/stop` 命令 — 方案设计

> 状态: 🟡 设计评审中 | Issue: #6
> 日期: 2026-06-21

## 1. 背景与目标

ChorusGate 用户（包括人类和 agent）在 Slack 中与 gateway 交互时，如果 agent 进程进入死循环或执行时间过长，目前**没有任何方式中止**——只能等 timeout。这是一个已被多次报告的痛点。

目标：提供 `/cc_stop` 命令，让用户能在 Slack 中立即终止当前 scope 正在运行的 agent 进程。

## 2. 现有基础设施

| 组件 | 能力 | 状态 |
|------|------|------|
| `interruptManager` | register / unregister / isRunning / interrupt(kill) | ✅ 已有 |
| `session-commands.ts` | detect + handle 斜杠命令 | ✅ 已有 |
| `gateway.ts onSpawn` | 将 ChildProcess 注册到 interruptManager | ✅ 已有 |
| `manifest.json` | 注册 Slack slash command | ✅ 已有模板 |

**结论：基础设施完备，`/stop` 是薄封装——核心逻辑只需调用 `interruptManager.interrupt()`。**

## 3. 设计决策

### 3.1 命令名

| 命令 | 说明 |
|------|------|
| `/cc_stop` | 主命令（profile-aware） |
| `/stop` / `/cancel` / `/kill` | 别名（prefix-less） |

### 3.2 交互流程

```
用户输入 /cc_stop
  → detectCommand() → { kind: "stop" }
  → handleCommand():
      1. scopeKey = formatIdentityKey(id)
      2. interruptManager.isRunning(scopeKey)?
         → false: post "No running agent process found."
         → true:  fire-and-forget interruptManager.interrupt(scopeKey)
                  post "⏳ Stopping agent process…"
```

### 3.3 关键设计选择

**Q: 同步还是异步？**
A: Fire-and-forget。`interrupt()` 内部已处理 kill + busy-ack 消息，`/stop` 只需触发，不需要等待结果。

**Q: 需要确认吗？**
A: 不需要。Slack 斜杠命令本身已是显式用户操作，再加确认增加 friction。误操作后果低（只 kill 一个可恢复的进程）。

**Q: 需要权限检查吗？**
A: 当前不做。channel scope 隔离已经足够——只有同一 channel 的成员能 stop 本 channel 的进程。未来可加 `allowed_users` 白名单。

### 3.4 不做什么

- ❌ 不做全局 `/stop_all`——scope 隔离是安全边界
- ❌ 不做优雅 shutdown（SIGTERM → wait → SIGKILL）——interruptManager 已有 SIGKILL，够用
- ❌ 不做审批——stop 是低风险操作，不需要二次确认

## 4. 实现范围

| 文件 | 变更 | 代码量 |
|------|------|--------|
| `src/session-commands.ts` | 导入 interruptManager, 新增 Command/ detect/ handle/ help | ~35 行 |
| `manifest.json` | 注册 `/cc_stop` | 6 行 |

## 5. 测试策略

- 单元测试：`detectCommand("/cc_stop")` 返回 `{ kind: "stop" }`
- 集成测试：spawn mock 进程 → 注册到 interruptManager → `/cc_stop` → 验证进程被 kill
- 回归：现有 141 个测试必须全部通过

## 6. 验收标准

- [ ] `/cc_stop` 在有进程时发送 busy-ack 并 kill 进程
- [ ] `/cc_stop` 在无进程时返回 "Nothing to stop"
- [ ] `/stop` `/cancel` `/kill` 别名均可用
- [ ] manifest.json 注册 `/cc_stop`
- [ ] help 文本包含 `/cc_stop`
- [ ] 141/141 回归测试通过
