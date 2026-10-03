# 代码框架说明

> 本文档概括 ChorusGate 仓库的代码组织、技术栈、构建与测试命令，基于真实文件统计。

## 技术栈

- **语言**：TypeScript（ES Module，`"type": "module"`）
- **运行时/加载器**：Node.js 18+，`tsx` 用于开发与测试
- **测试框架**：`node:test` + `node:assert/strict`
- **类型检查**：`tsc --noEmit`
- **主要外部依赖**：`@slack/socket-mode`、`@slack/web-api`、`dotenv`、`tsx`

## 仓库规模（粗略）

| 区域 | 文件数 | 说明 |
| --- | --- | --- |
| `src/*.ts` | 38 | 顶层模块 |
| `src/**/*.ts` | 59 | 含 `providers/`、`tools/`、`v10/` |
| `src/` 总代码行 | ~11,200 | 含注释与空行 |
| `tests/*.test.ts` | 47 | 顶层测试文件 |
| `bin/` | 2 | CLI 入口（`chorusgate.mjs`、`run.mjs`） |

## `src/` 模块地图

| 分组 | 主要文件 | 一句话职责 |
| --- | --- | --- |
| 网关核心 | `gateway.ts`, `socket-manager.ts`, `shouldReply.ts`, `slack-message.ts`, `message-handlers.ts`, `user-identity.ts`, `bootstrap.ts` | Socket Mode 事件接收、回复决策、消息拆分与投递 |
| 会话与上下文 | `session-store.ts`, `session-context.ts`, `session-commands.ts`, `durable-event-store.ts`, `event-store.ts` | Session 生命周期、上下文构建、事件持久化 |
| 配置与环境 | `cli-args.ts`, `config-init.ts`, `config-migrate.ts`, `config-cli.ts`, `load-env.ts`, `profile-config.ts`, `agent-home.ts` | CLI 参数、agent profile、配置迁移 |
| 控制面 | `permission-tracker.ts`, `plan-tracker.ts`, `interrupt.ts`, `gateway-control.ts`, `liveness.ts`, `watchdog.ts`, `gateway-paths.ts`, `state-paths.ts` | 权限、计划、中断、进程守护、存活监控 |
| 运行时适配器 | `providers/claude.ts`, `providers/codex.ts`, `providers/types.ts`, 各 parser | Claude/Codex 流式执行适配 |
| MCP Tools | `tools/send-message.ts`, `tools/reply.ts`, `tools/channel-history.ts`, `tools/get-user.ts`, `tools/list-channels.ts`, `tools/react.ts`, `tools/thread-replies.ts` | 外部 IDE/Claude Code 可调用的 Channel 工具 |
| V10 观察面 | `v10/types.ts`, `v10/fixture-adapter.ts`, `v10/employee-view.ts`, `v10/web-page.ts`, `v10/web-server.ts` | 只读 fixture 投影与本地 Web 服务 |

## 脚本与入口

| 脚本/入口 | 说明 |
| --- | --- |
| `bin/chorusgate.mjs` | CLI 主入口：`start/stop/restart/status/list/config` |
| `bin/run.mjs` | 执行 agent profile 的包装器 |
| `scripts/coordination/` | 每日站会、频道迁移等协调脚本 |
| `scripts/chorusgate-watchdog.*` | 进程守护脚本 |
| `scripts/post-test.mjs` | 测试后清理 |
| `scripts/verify-codex-cli.mjs` | Codex CLI 校验 |

## 构建与测试

```bash
# 类型检查 / 构建
npm run build
# 等价
npm run typecheck
npm run lint

# 完整测试套件
npm test
# 快速测试（跳过 ST- 前缀集成测试）
npm run test:fast

# V10 演示服务
npm run v10:web
```

## 测试基线

最近一次合并后的实际输出：

```text
tests 473
suites 68
pass 469
fail 4
cancelled 0
skipped 0
todo 0
duration_ms ~25,400
```

4 个失败全部位于 `tests/codex-integration.test.ts`，为历史遗留的 spawn/JSON flag 断言，不影响 V10 fixture/网关核心。

## 来源

- `package.json`
- `tsconfig.json`
- 真实 `src/` 与 `tests/` 文件统计
- `npm test` 输出（2026-10-03）
