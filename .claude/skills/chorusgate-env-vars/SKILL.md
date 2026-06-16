---
name: chorusgate-env-vars
description: ChorusGate environment variable safety rules for TypeScript/ESM code. Use when editing or reviewing src files that read process.env/import.meta.env, fixing config/env bugs, reviewing PRs involving bootstrap/loadEnv/profile config, or adding regression tests for env late binding.
---

# ChorusGate 环境变量规范

> **一句话原则**: 所有 `process.env.X` 必须**在使用点 inline 读取**，禁止模块顶层 `const` 缓存。
>
> 这是 #36/#37/#41/#P2-1 等一类 bug 的同根因 — ESM 静态 `import` 链在 `bootstrap()`/`loadEnv()` **之前**求值，顶层 `const` 拿到的永远是空值。

## Trigger

任何时侯你写/改/审 `src/` 下的 `.ts` 文件，且文件里出现 `process.env.` 或读取 `import.meta.env` 时，load 这个 skill。

## 错误模式（要禁）

```ts
// ❌ 顶层 const — import 时求值，早于 loadEnv()
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CODEX_BIN  = process.env.CODEX_BIN  || "codex";
const TIMEOUT_MS = parseInt(process.env.GATEWAY_TIMEOUT_MS || "900000", 10);
const STREAM_MODE = process.env.GATEWAY_CLAUDE_MODE === "stream";
```

为什么坏？
- `import` 一进 ESM module graph，*全部顶层 const 立即求值*
- 此时 `bootstrap()` / `loadEnv()` 还没跑（它们本身就是被 import 进来的）
- `.env` 加载顺序：模块加载 → bootstrap 调用 → 之后才有 env
- 结果：顶层 const 永远是 `undefined` / fallback 值
- 表现：*明明 .env 写了 X，但代码用的是默认值 Y*

## 正确模式（必须）

```ts
// ✅ 使用点 inline 读 — 每次调用都重新读 env
function spawnClaude(args: string[]): ChildProcess {
  const bin = process.env.CLAUDE_BIN || "claude";
  return spawn(bin, args, { ... });
}

// ✅ 多处需要时，函数内局部 const 共享（不是模块顶层）
function generateReply(opts: ReplyOpts) {
  const timeoutMs = parseInt(process.env.GATEWAY_TIMEOUT_MS || "900000", 10);
  const mode = process.env.GATEWAY_CLAUDE_MODE || "legacy";
  // 用 timeoutMs 和 mode ...
}
```

为什么对？
- inline 读 = 调用时才查 env
- 此时 `bootstrap()` 已完成，`.env` 已加载
- 多 profile / per-call env 也能正确生效

## 反例库（已知修过的）

| Commit | 文件 | 改法 |
|---|---|---|
| `1d7f1c1` | `reply-engine.ts` / `claude.ts` / `claude-stream.ts` 等 7 处 | 删顶层 const，inline 读 `CLAUDE_PERMISSION_MODE` |
| `a4f05c1` | `gateway.ts` `REPLY_TIMEOUT_MS` | **partial fix**：只加了 inline 读，**没删顶层 const**，双源并存 |
| `b1c2deb` | `codex.ts` | 传播 `opts.onSpawn`（与 env 无关，但同源于模块加载顺序问题） |

## 当前仓库扫描方式

先扫描当前 HEAD，不要信任旧报告里的行号：

```bash
rg -n "^const [A-Z_]+\\s*=\\s*process\\.env\\." src tests
```

判断规则：
- `tests/` 和 mock fixture 可以在顶层设置/读取 env，用于构造测试环境。
- `src/` 顶层 `const X = process.env.Y` 默认视为风险，除非能证明该模块只在 env 加载后动态 import。
- 同一个 env 不允许出现“顶层 const + 函数内 inline”双源并存。

## 2026-06-16 当前反例快照（每次使用前重新扫描）

```
src/providers/claude.ts:27          const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude"
src/providers/claude-stream.ts:44  const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude"
src/providers/codex.ts:26          const CODEX_BIN  = process.env.CODEX_BIN  || "codex"
src/gateway.ts:51                  const CLAUDE_CWD = process.env.GATEWAY_CLAUDE_CWD || process.cwd()
src/gateway.ts:73                  const PROGRESS_ENABLED = process.env.GATEWAY_PROGRESS !== "0"
src/gateway.ts:94                  const STREAM_MODE = process.env.GATEWAY_CLAUDE_MODE === "stream"
```

> 注：`gateway.ts:52` 的 `REPLY_TIMEOUT_MS` 顶层 const 仍在，同时 `processEvent` 内有 inline 读，属于 `a4f05c1` partial fix 残留。

修法：删 const，inline 读，或函数顶部局部 const 共享。`CLAUDE_PERMISSION_MODE` 已按 `1d7f1c1` 模式修，按同样 pattern 处理其余 6 处。

## 测试守门

- `npm run typecheck` 通过 ✅
- `npm test` 60/60 通过 ✅
- 加新测试：如果某 provider/函数支持 `ENV` 入参覆盖，测一下“入参 > env > default”的优先级

## PR review checklist

- [ ] `rg -n "^const [A-Z_]+\\s*=\\s*process\\.env\\." src` 没有命中
- [ ] 任何新文件 import 后立即读 env 视为“非触即发”——但 **不是** 0 命中就好，要看 const 是不是被 export / 跨函数复用
- [ ] 测试里用 `process.env.X = "test-value"` 时 *真的能改变行为*（不是被顶层 const 锁死）

## 关联 issue

- #36 [CRITICAL] Slack approval auth check happens after permission resolution（env 早绑定的下游症状之一）
- #41 [P0] MCP_SENDER_ONLY=1 added in PR #39, violates STORY-9 closure（顶层 const 决策时不读 STORY-9 env）
- 上一轮提的 5 处 follow-up（CLAUDE_BIN/CODEX_BIN/gateway 三处等）见上“仍存在的反例”表

