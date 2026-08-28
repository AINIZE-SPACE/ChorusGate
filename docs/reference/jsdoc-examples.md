# JSDoc Examples — ChorusGate house style

> 本仓库代码用 TypeScript，注释以 JSDoc `/** ... */` 为主。下面两个小例子
> 展示推荐写法，可直接套用到 `src/` 下的函数、类、接口上。
>
> 风格要点（取自现有代码 `logger.ts` / `liveness.ts`）：
> - 描述用 em-dash（`—`）连接主句与说明，中英文混排可接受
> - 接口字段用单行 `/** ... */` 内联注释
> - 有副作用/会抛错的函数，用 `@throws` 说清楚
> - 用法不直观时补 `@example`（目前仓库还没有，建议从公共 API 开始补）

## 例 1 — 带 `@param` / `@returns` / `@throws` / `@example` 的函数

对应 `src/logger.ts` 的 `createLogger`：

```ts
/**
 * Create a self-rotating logger.
 *
 * Rotation happens before each write: if the current file size exceeds
 * maxSize, or the file's mtime crossed a day boundary since last check,
 * rename the file to `<file>.<YYYYMMDD>.old` (the next append recreates
 * a fresh file), and prune `.old` files older than keepDays.
 *
 * @param opts.logFile — 日志文件绝对路径（如 ~/.chorusgate/<agent>/gateway.log）。
 * @param opts.maxSize — 单文件大小上限（字节），超过即轮转；默认 5MB。
 * @param opts.keepDays — 保留最近几天的 .old 文件；默认 7。
 * @param opts.level — 最低输出级别（debug/info/warn/error）；默认 info。
 * @returns 实现了 Logger 接口的对象；write 是同步的，flush/close 为空操作。
 * @throws 无 — 写盘失败会回退到 process.stderr，绝不抛出、绝不让 daemon 崩。
 *
 * @example
 * const logger = createLogger({
 *   logFile: path.join(home, "gateway.log"),
 *   level: "warn",
 * });
 * logger.info("daemon", "boot complete");   // 低于 warn 的级别不会落盘
 */
export function createLogger(opts: LoggerOptions): Logger { /* ... */ }
```

## 例 2 — 带 `@example` 的类（含构造注入与生命周期）

对应 `src/liveness.ts` 的 `LivenessMonitor`：

```ts
/**
 * Three-layer liveness monitor: suspend detection (clock jump), zombie
 * socket detection (probe), and unrecoverable escalation. Config and hooks
 * are injected so tests can drive tick()/probe() with fake clocks.
 *
 * @example
 * const mon = new LivenessMonitor(
 *   { tickIntervalMs: 5_000, suspendJumpMs: 60_000 },
 *   {
 *     isConnected: () => socketManager.isActive(),
 *     log: (level, module, msg) => logger[level](module, msg),
 *     onSuspendDetected: (s) => logger.warn("liveness", `resumed after ${s}s`),
 *     onZombieDetected: () => socketManager.forceReconnect(),
 *   },
 * );
 * mon.start();            // 安装 unref'd 的真实定时器
 * // ... daemon 运行中 ...
 * mon.stop();             // 进程退出前拆除，防止悬挂 interval
 */
export class LivenessMonitor {
  // ...
}
```

## 什么时候该写 `@example`

- 构造函数有注入参数，调用方需要同时配齐 config 与 hooks（例 2）
- 有副作用、顺序依赖（先 start 后 stop）或隐藏的默认值（例 1 的默认 5MB/7 天）
- 边界行为反直觉：logger 永不抛错、级别过滤在写盘前
