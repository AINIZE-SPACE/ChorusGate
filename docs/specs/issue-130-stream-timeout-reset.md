# Spec: #130 会话超时时间在 stream 模式下有返回就重置

> **Issue**: [#130](https://github.com/AINIZE-SPACE/ChorusGate/issues/130)
> **Type**: Bug / P0
> **Analyst**: 小马
> **Date**: 2026-07-17

## 1. 问题分析

### 1.1 需求描述

在一个长任务中，agent/LLM 在一个 goal/loop 中持续有过程返回时，超时计时器应该**重置**，而不是从 spawn 时一次性设定后不调整。

### 1.2 当前代码行为

**Claude Stream Provider** (`src/providers/claude-stream.ts`):

```typescript
// streamToResult() L212-264
function streamToResult(spawnResult, timeoutMs): Promise<SessionOutput> {
  return new Promise((resolve) => {
    // 一次性设定 timeout
    const timer = setTimeout(() => {
      if (spawnResult.settled) return;
      spawnResult.settled = true;
      child.kill("SIGKILL");
      resolve({ ok: false, error: `claude stream timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    // timeout 从不重置
    child.on("close", (code) => {
      clearTimeout(timer);
      // ...
    });
  });
}
```

**Codex Provider** (`src/providers/codex.ts`):

```typescript
// spawnCodex() L146-156
const timer = setTimeout(() => {
  if (settled) return;
  settled = true;
  child.kill("SIGKILL");
  resolve({ ok: false, error: `codex exec timed out after ${timeoutMs}ms` });
}, timeoutMs);
// 同样从不重置
```

### 1.3 问题

假设 `GATEWAY_REPLY_TIMEOUT_MS_LONG=1800000`（30 分钟）：
- Agent 执行一个长任务（如 code review + 测试）
- 每分钟都有 stream 事件输出（tool_call, text_delta 等）
- 但 timeout 从 spawn 时开始倒计时，30 分钟后强制 kill
- 即使 agent 正在正常工作，也会被超时 kill

### 1.4 不合理日志

```
[reply-engine] generateReply opts.timeoutMs=1800000 → timeoutMs=1800000
```
这条日志在 reply-engine L48，表明 timeout 是固定的，不随活动调整。

## 2. 设计方案

### 2.1 方案: Activity-Based Timeout Reset（活跃度重置）

**核心思路**: 每次收到 stream 事件（stdout data）时，重置 timeout timer。

#### 2.1.1 Claude Stream Provider 改造

```typescript
function streamToResult(spawnResult, timeoutMs): Promise<SessionOutput> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;

    // 新增: idle timeout 概念
    // timeoutMs 现在表示 "无活动的最大间隔"，而非 "总执行时间上限"
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (spawnResult.settled) return;
        spawnResult.settled = true;
        spawnResult.child.kill("SIGKILL");
        resolve({
          ok: false,
          text: "",
          sessionId: spawnResult.parser.init?.sessionId || "",
          error: `claude stream timed out (idle ${timeoutMs}ms with no output)`,
        });
      }, timeoutMs);
    };

    resetTimer(); // 初始 timer

    // 每次 stdout 有数据 → 重置 timer
    // 在 spawnStream 的 child.stdout.on("data") 中添加 resetTimer 调用
    // 但需要把 resetTimer 传给 spawnStream 或在闭包中处理

    child.on("close", (code) => {
      clearTimeout(timer);
      // ...
    });
  });
}
```

#### 2.1.2 更优雅的实现: 在 parser.feed 后重置

```typescript
// 在 StreamSpawnResult 中增加 resetTimer 回调
interface StreamSpawnResult {
  child: ChildProcess;
  parser: ClaudeStreamParser;
  stdoutBuf: string;
  stderr: string;
  settled: boolean;
  onActivity?: () => void;  // 新增
}

function spawnStream(args, cwd, parser, env, onSpawn, onActivity?) {
  // ...
  child.stdout!.on("data", (chunk) => {
    result.stdoutBuf += chunk.toString();
    const lines = result.stdoutBuf.split("\n");
    result.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) parser.feed(line);
    onActivity?.();  // 有数据 → 重置 timer
  });
  // stderr 也算活动（error 输出也算进展）
  child.stderr!.on("data", (chunk) => {
    result.stderr += chunk.toString();
    onActivity?.();
  });
}
```

#### 2.1.3 Codex Provider 改造

```typescript
function spawnCodex(..., timeoutMs, ...): Promise<SessionOutput> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // kill
      }, timeoutMs);
    };

    resetTimer();

    child.stdout!.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) parser.feed(line);
      resetTimer();  // 有输出 → 重置
    });

    child.stderr!.on("data", (chunk) => {
      stderr += chunk.toString();
      resetTimer();  // stderr 也算活动
    });
  });
}
```

### 2.2 总时间上限保护

为防止无限重置（agent 陷入死循环），增加**总时间硬上限**：

```typescript
const MAX_TOTAL_TIME = timeoutMs * 3;  // 总上限 = idle timeout 的 3 倍
const hardDeadline = Date.now() + MAX_TOTAL_TIME;

const resetTimer = () => {
  clearTimeout(timer);
  if (Date.now() >= hardDeadline) {
    // 超过总上限，强制 kill
    spawnResult.settled = true;
    child.kill("SIGKILL");
    resolve({ ok: false, error: `hard deadline exceeded (${MAX_TOTAL_TIME}ms total)` });
    return;
  }
  timer = setTimeout(() => { /* idle kill */ }, timeoutMs);
};
```

### 2.3 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `GATEWAY_TIMEOUT_MODE` | `idle` | `fixed`=固定超时(旧行为), `idle`=活跃度重置(新行为) |
| `GATEWAY_TIMEOUT_IDLE_MS` | 从 `GATEWAY_REPLY_TIMEOUT_MS` 继承 | 无活动的超时时间 |
| `GATEWAY_TIMEOUT_HARD_LIMIT_MULT` | `3` | 总时间上限 = idle_ms × 此倍数 |

### 2.4 日志改进

```typescript
// 旧日志
console.error(`[reply-engine] generateReply opts.timeoutMs=${timeoutMs} → timeoutMs=${timeoutMs}`);

// 新日志
console.error(
  `[reply-engine] generateReply mode=${timeoutMode} idleMs=${idleMs} ` +
  `hardLimitMs=${hardLimitMs} isResume=${isResume}`
);
```

### 2.5 验收标准

- [ ] Stream 模式下，每收到 stdout/stderr 数据就重置 idle timer
- [ ] 总时间上限保护防止死循环
- [ ] `GATEWAY_TIMEOUT_MODE=fixed` 退回旧行为
- [ ] 超时错误消息区分 `idle timeout` vs `hard deadline exceeded`
- [ ] `npm run build` 通过

## 3. 优先级

**P0** - 长任务目前会被不合理的固定超时 kill，导致任务失败。与 #129（中间过程输出）联动：中间输出同时重置超时。
