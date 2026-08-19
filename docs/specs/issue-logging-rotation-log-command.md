# Spec: 日志改造 + `chorusgate log --agent` 命令

> **Issue**: #141（小扣立项） | **Epic**: - | **合并 issue**: 日志无日期/无轮转 + `chorusgate log --agent`（均为日志域小改，合一个 issue 立项）
> **Type**: Tech-debt / Enhancement | **Priority**: P1（日常运维可读性直接受影响）
> **Analyst**: 小马 (U0B91BVKTL2)
> **Date**: 2026-08-18
> **Branch**: `v5/logging-liveness`（开发分支，基于 `v5/logging-liveness-spec`@07c480a）
> **Status**: ✅ 已实现（commit `26bbc2e`），待 SIT 验收

## 1. 问题分析

### 1.1 症状

1. `~/.chorusgate/<agent>/gateway.log` 纯追加、**无时间戳前缀**，不可读。
2. 无截断/轮转，文件无限增长（实测 claude/codex 两份已各 ~126KB 且持续增长）。
3. 无 `chorusgate log` 命令查看 agent 日志（现 CLI 只有 run/start/stop/restart/status/list/config）。

### 1.2 根因定位

**根因 1 - 日志写入方式**：

**文件**: `src/gateway-control.ts` L110
```typescript
const out = openSync(logFile, "a");
// ...
const child = spawn(process.execPath, [BIN_FILE, "run", ...forwardArgs], {
  detached: true,
  stdio: ["ignore", out, out],   // stdout+stderr 都指向同一个 fd
  windowsHide: true,
});
child.unref();
```

CLI `start` 用 `openSync(logFile, "a")` 打开一个 fd，通过 `spawn` 的 `stdio` 传给 daemon。daemon 内部所有 `console.error(...)`（gateway.ts 有 20+ 处，socket-manager.ts 有 10+ 处）直接写到这个继承来的 stdout/stderr fd。**没有任何 logger 模块**，时间戳/轮转无从下手。

**根因 2 - 轮转失效的 fd 持有问题（关键坑）**：

daemon 持有的 stdout/stderr fd 是 CLI `start` 时 `openSync` 的。如果按典型 logrotate 做法（外部 rename 旧文件 + 新建同名文件），**daemon 持有的旧 fd 会继续写向已被 rename 的 inode**，新文件永远空。Windows 上也没有 `dup2` 替换已打开 fd 的等价机制。这是跨平台日志轮转的经典陷阱。

**根因 3 - 无 `log` 子命令**：

**文件**: `bin/chorusgate.mjs` L36-44
```javascript
} else {
  const ctl = await tsImport("../src/gateway-control.ts", import.meta.url);
  const fn = ctl[cmd];
  if (typeof fn === "function") {
    await fn();
  } else {
```

CLI dispatcher 把未知命令映射到 `gateway-control.ts` 的导出函数。`log` 未导出，故不存在。但日志路径已存在（`gateway-paths.ts` L47 `getLogFile(agentId)`），命令只是 `tail` 该路径。

### 1.3 结论

日志问题分两层：**写入层**（daemon 内无 logger，无法加时间戳/轮转）和 **命令层**（无 log 子命令）。写入层必须从 daemon 内部改造（不能依赖外部 rename 轮转，fd 持有会失效）；命令层是纯新增，零风险。

## 2. 设计方案

### 2.1 方案 A：daemon 内置 logger 模块（零新依赖）

按小克建议，**不引 pino/winston**（运行时依赖仅 5 个，保持薄依赖足迹）。新增 `~50 行` 的 `src/logger.ts`，统一接管 daemon 内所有 `console.error` 输出。

**核心设计**：daemon 启动时用 `createWriteStream(logFile, { flags: "a" })` 自管 fd，**不再依赖 `spawn` stdio 传入的 fd**。这样轮转时 daemon 主动 `close()` 旧 stream + `createWriteStream()` 新 stream，fd 持有问题根治。

```typescript
// src/logger.ts（示意）
export interface LoggerOptions {
  logFile: string;
  maxSize?: number;       // 单文件上限，默认 5MB
  keepDays?: number;     // 按日轮转保留份数，默认 7
  level?: "debug" | "info" | "warn" | "error";
}

export function createLogger(opts: LoggerOptions): {
  log: (level: string, module: string, msg: string, ...args: unknown[]) => void;
  close: () => void;
}
```

**轮转触发**：每次 write 前检查当前文件 `stat.size >= maxSize` 或 `stat.mtime` 跨日 -> `close()` 当前 stream -> `rename(logFile, logFile + "." + YYYYMMDD + ".old")` -> `createWriteStream()` 新文件。保留份数：`keepDays=7`，过期 .old 文件 `unlink`。

**格式**：`[ts YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [module] msg`
- `ts` 固定前缀，ISO 风格本地时间
- `LEVEL` = INFO/WARN/ERROR/DEBUG
- `module` = gateway / socket-manager / liveness / logger 等

**接入方式**：daemon 启动时（gateway.ts 主入口）创建全局 logger，替换 `console.error` 为 `logger.log`（或显式 import 调用）。为了最小改动，可用 `console.error = (msg) => logger.log("error", "console", msg)` 覆盖，但显式调用更清晰、推荐。

### 2.2 方案 B：`chorusgate log --agent` 命令（纯新增）

在 `gateway-control.ts` 导出 `log()` 函数，CLI dispatcher 自动识别。

```typescript
// gateway-control.ts 新增
export async function log(): Promise<void> {
  const cliArgs = parseCliArgs();
  const agentId = cliArgs.agentId || DEFAULT_AGENT;
  const lines = cliArgs.lines ? parseInt(cliArgs.lines, 10) : 50;
  const follow = cliArgs.follow || false;
  const logFile = getLogFile(agentId);
  
  if (!existsSync(logFile)) {
    console.error(`No log file for agent '${agentId}' at ${logFile}`);
    process.exitCode = 1;
    return;
  }
  
  // tail -n lines（跨平台：读文件末尾 N 行）
  const content = readFileSync(logFile, "utf8");
  const allLines = content.split("\n");
  const tail = allLines.slice(-lines).join("\n");
  console.log(tail);
  
  // -f follow（跨平台：fs.watch + append 偏移轮询）
  if (follow) {
    let size = statSync(logFile).size;
    fs.watch(logFile, () => {
      const newSize = statSync(logFile).size;
      if (newSize > size) {
        const fd = openSync(logFile, "r");
        const buf = Buffer.alloc(newSize - size);
        readSync(fd, buf, 0, buf.length, size);
        closeSync(fd);
        process.stdout.write(buf.toString());
        size = newSize;
      }
    });
  }
}
```

**CLI 参数解析**：复用现有 `parseCliArgs()`（cli-args.ts），新增识别：
- `--agent <id>` / `-a <id>`（已有，#134 引入）
- `--lines <N>` / `-n <N>`（新增）
- `--follow` / `-f`（新增，布尔标志）

**help 输出**：在 `gateway-control.ts` 的 `help()` 函数（L259）补充 `log` 命令说明。

### 2.3 代码变更汇总

| 文件 | 变更类型 | 内容 |
|------|---------|------|
| `src/logger.ts` | **新增** | ~50 行 logger 模块：createWriteStream 自管、轮转、格式化 |
| `src/gateway.ts` | 改动 | 启动时初始化 logger；所有 `console.error` 替换为 `logger.log` 或覆盖 console.error |
| `src/socket-manager.ts` | 改动 | `console.error` -> `logger.log` |
| `src/gateway-control.ts` | 改动 + 新增 | 新增 `log()` 导出函数；`start()` 不再 `openSync` 传 stdio fd（改用 `pipe` 或让 daemon 自管） |
| `src/cli-args.ts` | 新增 | `--lines` / `--follow` 解析 |
| `bin/chorusgate.mjs` | 无改动 | dispatcher 自动识别新导出的 `log` 函数 |
| `src/gateway-control.ts` L110 | **关键改动** | `openSync(logFile,"a")` -> 移除，改 `stdio: ["ignore", "ignore", "ignore"]` 或 pipe 到 daemon 自管 logger |

**`start()` stdio 改动细节**：daemon 改为内部 `createWriteStream` 后，`spawn` 的 stdio 不再需要传 log fd。但 daemon 启动前若有早于 logger 初始化的错误输出，会丢失。缓解：daemon 入口最早期初始化 logger（gateway.ts 第一行），或 `stdio` 改为 `["ignore", "ignore", "pipe"]` 但 `pipe` 会阻塞 detached 模式（Windows 限制）。**推荐：`stdio: ["ignore", "ignore", "ignore"]` + daemon 内部 logger，启动失败信息写 `status.json` 的 error 字段**。

### 2.4 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `GATEWAY_LOG_MAX_SIZE_MB` | `5` | 单个 gateway.log 上限 MB，超限触发轮转 |
| `GATEWAY_LOG_KEEP_DAYS` | `7` | 按日轮转保留份数，过期 .old 文件清理 |
| `GATEWAY_LOG_LEVEL` | `info` | 日志级别过滤 |

### 2.5 风险分析

| 风险 | 影响 | 缓解 |
|------|------|------|
| daemon 改 stdio 为 ignore 后启动期错误丢失 | 启动失败难诊断 | logger 初始化提到 gateway.ts 第一行；status.json 加 `lastError` 字段；保留 `chorusgate status` 可读 |
| 轮转 rename 在 Windows 上失败（文件被占用） | 轮转不生效 | daemon 自管 createWriteStream close 后再 rename，fd 已释放；Windows 下仍可能因句柄复用失败 -> 退化为 size 截断（truncate）而非 rename |
| `--follow` 在 Windows 上 fs.watch 不稳定 | tail -f 偶发丢更新 | 轮询偏移兜底（200ms 间隔 stat），watch 仅作触发 |
| 现有 126KB 日志迁移 | 历史日志无时间戳 | 不迁移，新日志从改造后开始带时间戳；旧日志保留只读 |

### 2.6 与 liveness spec 的关系

本 spec 的 logger 模块是 liveness spec 的依赖：挂起检测、探测日志都需要 logger 输出带时间戳和级别。**建议两个 spec 同分支开发**（`v5/logging-liveness`），logger 先落地，liveness 后接入。

## 3. 验收标准

- [ ] AC1: 新日志行格式为 `[ts YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [module] msg`
- [ ] AC2: gateway.log 超过 5MB 或跨日时自动轮转，旧文件 rename 为 `gateway.log.YYYYMMDD.old`，新日志写入新 `gateway.log`
- [ ] AC3: 保留份数超 7 天的 .old 文件自动清理
- [ ] AC4: `chorusgate log --agent <id>` 默认输出最近 50 行
- [ ] AC5: `chorusgate log --agent <id> --lines 100` 输出最近 100 行
- [ ] AC6: `chorusgate log --agent <id> --follow` 实时跟随新日志（Linux + Windows 双平台验证）
- [ ] AC7: `chorusgate log`（无 --agent）输出 default agent 日志，与 #134 默认 agent 语义一致
- [ ] AC8: `chorusgate help` 列出 `log` 命令及参数说明
- [ ] AC9: daemon 改造后 `chorusgate start` + `chorusgate status` 正常工作（无因 stdio 改动导致的启动失败）
- [ ] AC10: `npm run build`（tsc --noEmit）零错误，`npm test` 无回归
- [ ] AC11: 跨平台验证：Linux（小马 SIT）+ Windows（小克/乐老板确认 schtasks 不阻塞）

## 4. 优先级

**P1** - 日常运维基础（日志不可读直接影响故障定位），且改动小、风险可控。

## 5. SIT 验证方案（小马）

1. **轮转验证**：临时设 `GATEWAY_LOG_MAX_SIZE_MB=1`，`chorusgate start` 后持续发消息触发日志，验证生成 `.old` 文件且新日志写入新 `gateway.log`（AC2/AC3）。
2. **跨日验证**：手动改系统时间跨日或 mock `new Date()`，验证按日轮转（AC2）。
3. **log 命令**：`chorusgate log --agent default --lines 50`、`--follow`、无 `--agent` 三种形态验证（AC4-AC7）。
4. **format 校验**：grep 新日志行匹配 `^\[ts \d{4}-\d{2}-\d{2}`（AC1）。
5. **回归**：tsc + 全量测试（AC10）。

## 6. 实现状态（小克，2026-08-19）

已在 `v5/logging-liveness` 实现并本地全绿（commit `26bbc2e`，tsc 零错误，324/324 单测通过；ST-PROV-002 超时为基线上已存在的环境项，非本改动回归）。

**实现要点与 spec 的差异（有意为之，需 SIT 关注）**

1. **写入层改用 `fs.appendFileSync`（非 `createWriteStream`）**。评审关心的 fd 持有坑由更彻底的方式根治：logger 不持任何 fd，每次写前 `statSync` 判断大小/跨日 → `rename` → 下次 append 自然重建新文件。这消除了 createWriteStream 的异步 flush/排序面（此前实现曾因此产生偶发乱序），且 appendFileSync 在该量级（每条 Slack 事件数行）开销可忽略。**目标不变**：daemon 自管文件、轮转 close→rename→reopen 语义、不依赖 `spawn` stdio fd。
2. **daemon console 接管抽为 `redirectConsoleToLogger(logger)`**（logger.ts 导出，返回 restore 函数，便于测试）。gateway.ts 模块作用域调用，早于 `main()`。
3. **`start()` stdio 改 `["ignore","ignore","ignore"]`**（spec 推荐项），daemon 启动失败时 `start()` 仍读取 `~/.chorusgate/<agent>/gateway.log` 尾部回显。
4. **`log --follow`**：`fs.watch` 仅作唤醒，实际读用「大小偏移轮询」；检测到文件收缩（被轮转重建）时偏移从 0 重锚，Windows 与轮转场景均正确。
5. **`cli-args`** 新增 `--lines/-n`、`--follow/-f`；`log()` 无 `--agent` 时回退 `default`（与 #134 一致）。

**AC 状态**：AC1-AC10 已由单测+typecheck 覆盖；AC6（`--follow` 双平台）、AC11（跨平台）待小马 SIT。
