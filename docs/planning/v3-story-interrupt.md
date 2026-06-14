# STORY: Gateway Interrupt — 用户打断当前任务

> 状态：开发中 | Epic: v3 EPIC | 优先级：P1
> 参考：Hermes Agent `_busy_input_mode` + `_busy_ack_ts`

## 需求

参考 Hermes Agent 的 interrupt 机制：用户连续发消息时，gateway 打断当前 `claude -p` 进程，直接处理新消息，并回复确认。

```
用户发消息 "继续"
  → 当前 session 正在运行 claude -p（处理上一条消息）
  → gateway 发送 "⚡ 正在中断当前任务…" (busy ack)
  → kill 当前 claude -p 进程
  → 新消息进入处理队列
  → 用户收到新回复
```

## Hermes 参考

| 机制 | Hermes | ChorusGate |
|------|--------|-----------|
| Busy ack | `⚡ Interrupting current task (iteration 1/90). I'll respond...` | `⚡ 正在中断当前任务…` |
| Debounce | 30s 冷却，不重复发 ack | 同 |
| 打断方式 | `agent.is_interrupted` flag → 下次 tool call 时检查 | `child.kill("SIGTERM")` |
| 模式 | interrupt / queue / steer | interrupt / queue |
| 追踪 | `_running_agents: Dict[str, AIAgent]` | `runningSessions: Map<string, ChildProcess>` |

## 方案

### busy-ack 流程

```
onEvent(event, profileId)
  ├─ scopeKey = formatIdentityKey(sessionIdentity(...))
  ├─ if runningSessions.has(scopeKey):
  │   ├─ send busy_ack (debounced 30s)
  │   ├─ runningSessions.get(scopeKey).kill("SIGTERM")
  │   └─ runningSessions.delete(scopeKey)
  └─ 正常处理（原有流程）
```

### 新增模块: `src/interrupt.ts`

```typescript
class InterruptManager {
  // 追踪运行中的 session → ChildProcess
  private running = new Map<string, ChildProcess>();
  // Debounce busy-ack 时间戳
  private lastAck = new Map<string, number>();

  register(key: string, child: ChildProcess): void;
  unregister(key: string): void;
  
  /** 检查是否需要打断。返回 true 表示已打断。 */
  interrupt(key: string, channel: string, threadTs: string): boolean;
  
  /** 发送 busy ack（debounced 30s） */
  private async sendBusyAck(channel, threadTs): Promise<void>;
}
```

### 配置

```env
GATEWAY_BUSY_MODE=interrupt   # interrupt | queue
                               # interrupt: 杀进程，处理新消息
                               # queue: 排队，等当前任务完成
```

## 验收标准

- [ ] 用户发消息时若 session 有正在运行的 claude -p，发送 busy ack
- [ ] Kill 当前 claude -p 进程（interrupt 模式）
- [ ] 新消息进入处理队列
- [ ] Debounce 30s 防 busy ack 刷屏
- [ ] `GATEWAY_BUSY_MODE=queue` 排队模式可用
- [ ] 向下兼容（默认 interrupt）
