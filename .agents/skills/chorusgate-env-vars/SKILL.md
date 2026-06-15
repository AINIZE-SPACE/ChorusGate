---
name: chorusgate-env-vars
description: ChorusGate environment variable safety rules for TypeScript/ESM code. Use when editing or reviewing src files that read process.env/import.meta.env, fixing config/env bugs, reviewing PRs involving bootstrap/loadEnv/profile config, or adding regression tests for env late binding.
---

# ChorusGate 环境变量规范

> **一句话原则:** 所有 `process.env.X` 必须**在使用点 inline 读**，禁止模块顶层 `const` 缓存。
>
> 这是 #36/#37/#41/#P2-1 等一类 bug 的同根因 — ESM 静态 `import` 链在 `bootstrap()`/`loadEnv()` **之前**求值，顶层 `const` 拿到的永远是空值。

## Trigger

任何时候你写/改/审 `src/` 下的 `.ts` 文件，且文件里出现 `process.env.` 或读 `import.meta.env` 时，先 load 这个 skill。

## 错误模式（禁止）

```ts
// ❌ 顶层 const — import 时求值，早于 loadEnv()
const CLAUDE_BIN = process.env.CLAUDE_BIN || "Codex";
const CODEX_BIN  = process.env.CODEX_BIN  || "codex";
const TIMEOUT_MS = parseInt(process.env.GATEWAY_TIMEOUT_MS || "900000", 10);
const STREAM_MODE = process.env.GATEWAY_CLAUDE_MODE === "stream";
```

为什么坏：
- `import` 一进 ESM module graph，**全部顶层 const 立即求值**
- 此时 `bootstrap()` / `loadEnv()` 还没跑（它们本身就是被 import 进来的）
- `.env` 加载顺序：模块加载 → bootstrap 调用 → 之后才有 env
- 结果：顶层 const 永远是 `undefined` / fallback 值
- 表现："明明 .env 写了 X，但代码用的是默认值 Y"

## 正确模式（必须）

```ts
// ✅ 使用点 inline 读 — 每次调用都重新读 env
function spawnClaude(args: string[]): ChildProcess {
  const bin = process.env.CLAUDE_BIN || "Codex";
  return spawn(bin, args, { ... });
}

// ✅ 多处需要时，函数内局部 const 共享（不是模块顶层）
function generateReply(opts: ReplyOpts) {
  const timeoutMs = parseInt(process.env.GATEWAY_TIMEOUT_MS || "900000", 10);
  const mode = process.env.GATEWAY_CLAUDE_MODE || "legacy";
  // 用 timeoutMs 和 mode ...
}
```

为什么对：
- inline 读 = 调用时才查 env
- 此时 `bootstrap()` 已完成，`.env` 已加载
- 多 profile / per-call env 也能正确生效

## 反例库（已知修过的）

| Commit | 文件 | 改法 |
|---|---|---|
| `a4f05c1` | `gateway.ts` `processEvent` 动态读 timeout | inline `process.env.GATEWAY_REPLY_TIMEOUT_MS` |
| `1d7f1c1` | `reply-engine.ts` / `Codex.ts` / `Codex-stream.ts` 动态读 `PERMISSION_MODE` | 删顶层 const，inline 读 |
| `38086f9` | `session-store.ts` 旧 key 迁移 | 数据结构迁移，不是 env bug，但同源"模块加载 vs bootstrap 顺序"问题 |

## 当前仓库扫描方式

先扫描当前 HEAD，不要信任旧日报里的行号：

```bash
rg -n "^const [A-Z_]+\\s*=\\s*process\\.env\\.|process\\.env\\." src tests
```

判断规则：
- `tests/` 和 mock fixture 可以在顶层设置/读取 env，用于构造测试环境。
- `src/` 顶层 `const X = process.env.Y` 默认视为风险，除非能证明该模块只在 env 加载后动态 import。
- 同一个 env 不允许出现“顶层 const + 函数内 inline”双源并存。

## 2026-06-14 当前反例快照（每次使用前重新扫描）

```bash
src/providers/Codex.ts:27 + src/providers/Codex-stream.ts:44 (重复)   const CLAUDE_BIN = process.env.CLAUDE_BIN || "Codex"
src/providers/codex.ts:28          const CODEX_BIN  = process.env.CODEX_BIN  || "codex"
src/gateway.ts:51                  const CLAUDE_CWD = process.env.GATEWAY_CLAUDE_CWD || process.cwd()
src/gateway.ts:52                  const REPLY_TIMEOUT_MS = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000)
src/gateway.ts:55                  const REPLY_TIMEOUT_MS_LONG (依赖上层)
src/gateway.ts:73                  const PROGRESS_ENABLED = process.env.GATEWAY_PROGRESS !== "0"
src/gateway.ts:94                  const STREAM_MODE = process.env.GATEWAY_CLAUDE_MODE === "stream"
```

修法：删 const，inline 读，或函数顶部局部 const 共享。`PERMISSION_MODE` 已修，按同 pattern 抄。

## 测试守门

- `npm run typecheck` 通过 ✓
- `npm test` 60/60 通过 ✓
- 加新测试：如果某 provider/函数支持 `ENV` 入参覆盖，测一下入参 > env > default 的优先级

## PR review checklist

- [ ] `rg -n "^const [A-Z_]+\\s*=\\s*process\\.env\\." src` 没有命中
- [ ] 任何新文件 import 后立即读 env 视为"非触发" — 但**不是** 0 命中就好，要看 const 是不是被 export / 跨函数复用
- [ ] 测试用 `process.env.X = "test-value"` 时**真的能改变行为**（不是被顶层 const 锁死）


## Partial fix 案例 (a4f05c1)

`a4f05c1` 声称修了 `processEvent` 动态读 timeout env, 但**只加了 inline 读, 没删顶层 const**:
```ts
// gateway.ts:52 - 顶层 const 没删
const REPLY_TIMEOUT_MS = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
// ... in processEvent (gateway.ts:451)
const _replyTimeoutMs = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
```
**后果**: gateway.ts 全文 `REPLY_TIMEOUT_MS` 7 处使用, 5 顶层 2 inline, 双源并存. 维护者困惑.

**修法**: 删顶层 const, 全文统一一个来源 (函数内局部 const 共享).

## 已知真实修过的修复 (参考 pattern)

| Commit | 改法 |
|---|---|
| `1d7f1c1` `CLAUDE_PERMISSION_MODE` | 7 处全部 inline 读 env, 删顶层 const. **应作为后续 6 处的模板** |
| `a4f05c1` `REPLY_TIMEOUT_MS` | ⚠️ **partial fix**, 顶层 const 还在 |

## 复盘: 为什么 1d7f1c1 修了 PERMISSION_MODE 但漏了 5 处同款

提交时只盯着当下 issue 的反例, 没扫全文 `rg -n "^const [A-Z_]+\\s*=\\s*process\\.env\\." src` 找同根. **改前 rg, 改后 rg** 应该作为 fix commit 的标准 check.

## 关联 issue

- #36 [CRITICAL] Slack approval auth check happens after permission resolution（env 早绑定的下游症状之一）
- #41 [P0] MCP_SENDER_ONLY=1 added in PR #39, violates STORY-9 closure（顶层 const 决策时不读 STORY-9 env）
- 上一轮提的 5 处 follow-up（CLAUDE_BIN/CODEX_BIN/gateway 三处）— 见上"仍存在的反例"表
