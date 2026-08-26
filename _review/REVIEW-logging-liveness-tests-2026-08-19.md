# 评审报告 - 测试基础设施与 #141 日志实现 (logging-liveness)

> 评审角色:主评审（评审 `v5/logging-liveness` 分支的测试基础设施与 #141 日志实现）
> 评审对象:
>   - 测试:`tests/logger.test.ts`、`tests/log-command.test.ts`、`tests/cli-args.test.ts`（#141 log 段）
>   - 被测实现:`src/logger.ts`、`src/gateway-control.ts log()/followLog()`、`src/cli-args.ts`（--lines/-n/--follow/-f）、`src/gateway.ts`（env-var 接线）
> 基线:HEAD `1849fad`（功能基线 `26bbc2e`）
> 评审日期:2026-08-19
> 验证方式:实机执行（`npx tsc --noEmit` + `npm test` + 三测试文件单独跑）+ 逐文件代码走查

---

## 一、验证结果总览

| # | 评审项 | 验证方式 | 结果 |
|---|--------|----------|------|
| 1 | TypeScript 类型检查 | `npx tsc --noEmit` | ✅ CLEAN（exit 0） |
| 2 | 全量测试 | `npm test` | ✅ CLEAN（325/325 pass, 0 fail, 0 skip） |
| 3 | `logger.test.ts` | 单独执行 | ✅ CLEAN（14/14） |
| 4 | `log-command.test.ts` | 单独执行 | ✅ CLEAN（10/10） |
| 5 | `cli-args.test.ts` | 单独执行 | ✅ CLEAN（37/37，含 #141 log 段 9 例） |
| 6 | 计划文档与文件系统一致性 | `PLAN-logging-liveness-2026-08-18-xiaoma.md` 逐项核对 | ✅ CLEAN（计数/SHA 已按现状修订） |
| 7 | spec §6 自测记录计数 | spec 声称 "324/324"，实机为 325 | ⚠️ MINOR（计数差 1，非回归） |

**结论：无阻断问题，无失败测试。** 测试基础设施与 #141 实现整体健康，可进入 SIT。

---

## 二、逐项评审明细

### 2.1 测试基础设施（CLEAN）

| 测试文件 | 数量 | 覆盖点核对 | 结果 |
|----------|------|-----------|------|
| `tests/logger.test.ts` | 14 | 时间戳格式(AC1)、size 轮转(AC2)、跨日轮转(AC2)、prune(AC3)、缺目录自建、console 重定向、多行折叠、参数序列化、循环引用、字符串 level、fail-closed stderr | ✅ |
| `tests/log-command.test.ts` | 10 | 默认 50 行(AC4)、--lines/-n(AC5)、agent 作用域+default 回落(AC7)、缺文件 exit 1、clamp/floor/无尾换行/空文件/少于请求数返回全部 | ✅ |
| `tests/cli-args.test.ts`（log 段） | 9 | --lines 两种分隔、-n、默认 undefined、--follow/-f、组合、不影响 start/stop、NaN、尾随 --lines/-n 忽略 | ✅ |

测试设计要点（合理）：
- `log-command.test.ts` 直接驱动 `gateway-control.log()`（非 spawn CLI），worker 隔离 + 临时 `CHORUSGATE_HOME`，无副作用残留；`after()` 清理临时目录。
- `--follow`（AC6）按设计排除在单测外（阻塞型 live tail），由 SIT 007 覆盖——文档明确，合理。
- `cli-args.test.ts` log 段覆盖分隔符、默认值、组合、跨命令隔离、非法值，边界完整。

### 2.2 #141 实现走查（CLEAN）

| 文件 | 走查点 | 结果 |
|------|--------|------|
| `src/logger.ts` | 无持 fd（appendFileSync）、轮转 stat→rename→reopen、prune 在轮转后执行、level 过滤、console 重定向可 restore | ✅ 设计符合 spec §6 实现要点 |
| `src/gateway-control.ts log()` | 缺文件 exit 1 + stderr 含路径与提示；lines clamp（非有限/≤0 → 50）；尾换行 pop 后 slice | ✅ 与测试及 spec AC4/AC5/AC7 一致 |
| `src/gateway-control.ts followLog()` | fs.watch 仅唤醒 + 200ms 偏移轮询；文件收缩重锚 offset=0 | ✅ 跨轮转/Windows 兜底逻辑正确（SIT 007 重点验证） |
| `src/cli-args.ts` | --lines/-n/--follow/-f 解析；尾随无值忽略；不影响其他命令 | ✅ |
| `src/gateway.ts` | `GATEWAY_LOG_MAX_SIZE_MB/KEEP_DAYS/LEVEL` 接线，非法值回落默认 | ✅ spec §2.4 一致 |

### 2.3 非阻断发现（MINOR，本轮不改动）

**F-1（MINOR）`logger.ts` 同日二次轮转产生的带时间戳 `.old` 文件永不进入 prune 过滤。**

- 位置:`src/logger.ts:161` + `prune()`（L126-142）。
- 现象:轮转目标 `gateway.log.<day>.old` 已存在时，改为 `gateway.log.<day>.old.<Date.now()>`。`prune()` 仅匹配 `endsWith(".old")`，带时间戳后缀的文件**永不清理**（孤儿文件）。
- 触发条件:同一日历日内发生两次 size 轮转（如 SIT 用 `GATEWAY_LOG_MAX_SIZE_MB=1` 时完全可能）。
- 现有测试也未覆盖该形态（`logger.test.ts` 断言 `endsWith(".old")` 与 `/^gateway\.log\.\d{8}\.old$/`）。
- 建议（下一迭代）：`prune()` 过滤条件加 `|| /\.old\.\d+$/.test(entry)`，并补一条同日二次轮转回归测试。
- **本轮不实施**：分支已 Dev Ready、SIT 待执行，改生产代码会改变 SIT SHA；建议随 SIT 反馈或下一 issue 处理。

**F-2（MINOR）spec §6 自测计数差 1。**

- `docs/specs/issue-logging-rotation-log-command.md` §6 记 "324/324 单测通过"，实机为 325。
- 影响:仅记录口径，非回归。已同步修订 `PLAN-logging-liveness` 回归基线为 325（以 SIT 执行时点为准）。

### 2.4 仓库卫生（HOUSEKEEPING）

以下未跟踪调试/评审残留不应合入主干（旧 `_review/SUMMARY.md` §五 已列过，仍待清理）：

- `tests/diag-home.mjs`、`tests/diag-home.ts`、`tests/diff-test.txt`（0 字节）
- `diag-message-reaction.mjs`（仓库根）
- `tests/PostRefactor/review.md`（内容为无关的 JSON 图对比评审，与 ChorusGate 测试无关）
- `_review/`、`_review_scope.diff`（评审过程产物，可留档或清理）

---

## 三、结论与放行建议

- **测试基础设施：✅ 通过（CLEAN）**。tsc 零错误、325/325 全绿，log/logger/cli-args 三文件覆盖与 spec AC1-AC7 对齐。
- **#141 实现：✅ 通过（CLEAN）**，无阻断问题；F-1 为低风险边界，建议下一迭代处理。
- **放行条件**:`docs/tests/plans/PLAN-logging-liveness-2026-08-18-xiaoma.md` 修订完成（本报告 2.3 之前）；仓库卫生项建议在合入前清理（不影响 SIT 执行）。
- **遗留动作**:
  1. [ ] F-1 补 prune 过滤 + 回归测试（下一迭代）
  2. [ ] 清理未跟踪调试残留（合入前）
  3. [ ] SIT 由小马在 zederer-mbe 执行，Windows 交叉验证由小克/乐老板确认

---

## 四、补充评审（小克，2026-08-19，HEAD `5a890ad`）

> 本补充在 HEAD `5a890ad`（原评审基线 `1849fad` 之上仅加 `5a890ad` 文档提交，代码未变）复核
> 验证：`npx tsc --noEmit` CLEAN + `npm test` 325/325 pass —— 与原评审一致，无回归。

### 4.1 范围澄清

- **#141（日志域）**：实现已完成（`26bbc2e` + `1849fad`），Dev Ready ✅
- **liveness（休眠自愈）**：仅 spec + SIT 计划，**未实现**（`src/liveness.ts`、watchdog 脚本、socket-manager 改动均不存在）。issue 尚为"待建"。SIT Phase 2 正确标注为"阻塞"。
- **#140（agent-home wiring）**：**不在本分支**。实现位于 `fix/bot-message-mentions`（`e172951`、`bbb5660`），`git merge-base --is-ancestor e172951 HEAD` 为假。分支名 "logging-liveness" 中的 liveness 是本分支自己的新域，与 #140 无耦合（liveness spec §2.5 已声明无依赖冲突）。

### 4.2 新发现

**F-3（MEDIUM — 静默配置失效）`GATEWAY_LOG_*` 放在 agent `.env` 不生效。**

- 位置：`src/gateway.ts:43-45`（模块顶层读 `process.env`）早于 `src/gateway.ts:59` `bootstrap()` → `src/load-env.ts:41` `loadEnv()`（后者才把 `.env` 键写入 `process.env`）。
- 现象：`GATEWAY_LOG_MAX_SIZE_MB/KEEP_DAYS/LEVEL` 只有作为 **shell 环境变量**（spawn 继承）才生效；写入 `~/.chorusgate/<agent>/.env` 时被**静默忽略**，回落默认 5MB/7 天/info，无任何提示。
- 触发场景：按 #134"配置放 agent .env"范式操作的用户（PLAN ST-141-002/003/004 用的是 shell env，所以 SIT 不会暴露此问题）。
- 根因：logger 必须在 bootstrap 之前初始化（设计上要捕获 bootstrap 自身输出），形成先有鸡还是先有蛋。缺一个"bootstrap 后重读 env 更新 logger 配置"的桥接。
- 建议：SIT 前至少**在 README/README_CN 补一句"须以 shell 环境变量方式设置"**；或下一迭代把 `createLogger` 移到 `bootstrap()` 之后并对 logger 暴露 `setLevel/updateRotation`（或先以默认建 logger、bootstrap 后重建）。

**F-4（MINOR — 重复行竞态）`log --follow` 初始 tail 与 follow 首帧可能重复。**

- 位置：`src/gateway-control.ts` `log()` L296-307 与 `followLog()` L318 之间。
- 现象：`log()` 的 `readFileSync` 到 `followLog()` 的 `statSync` 之间如有新字节追加，会被 tail 与 follow 各打一遍。低概率、纯显示瑕疵。
- 建议：`followLog` 的初始 size 改为在 `log()` 读完后立即取，或 follow 模式跳过初始 tail。

**F-5（MINOR — 启动失败诊断盲区）`start()` 失败时 log tail 可能为空。**

- 位置：`src/gateway-control.ts:150-159`。
- 现象：daemon 若在 logger 初始化**之前**（模块顶层 `requireWindowsAdmin`/`parseCliArgs`）就崩，stderr 被 ignore、日志文件不存在 → `start()` 打出空的 "Recent log:"，误导排障。
- 建议：tail 为空时附加"daemon 在 logger 初始化前退出"提示（对应 spec §2.5 风险）。

### 4.3 结论

- #141 代码仍 CLEAN，可进入 SIT；F-1/F-2 维持原判。
- F-3 建议 SIT 前先文档化（README 一行），否则属"文档不支持的静默行为"。
- F-4/F-5 低风险，随下一迭代。
- `_review/_pr140-src.diff` 为**他项目**（Agent Home，`.ainize\.config`）残留，与本分支无关，合入前应清理。
