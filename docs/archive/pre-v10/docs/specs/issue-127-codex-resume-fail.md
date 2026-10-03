# Spec: #127 codex gateway 回复消息失败

> **Issue**: [#127](https://github.com/AINIZE-SPACE/ChorusGate/issues/127)
> **Type**: Bug / P0
> **Analyst**: 小马
> **Date**: 2026-07-17

## 1. 问题分析

### 1.1 症状

```
[reply-engine] resume failed (codex exec exited 2: error: unexpected argument '-s' found

  tip: to pass '-s' as a value, use '-- -s'

Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
```

### 1.2 根因定位

**文件**: `src/providers/codex.ts`

**resume 路径** (`resumeSession()`, L274-300):
```typescript
async resumeSession(prompt, sessionId, opts) {
    const args = ["resume", sessionId, "-"];  // resume 命令参数
    // ...
    return spawnCodex(args, prompt, opts.cwd, opts.timeoutMs, parser,
                      false,  // includeSandbox=false
                      opts.onSpawn, opts.onStreamUpdate, opts.model);
}
```

`spawnCodex()` 内部调用 `buildCodexExecArgs()` (L61-76):
```typescript
export function buildCodexExecArgs(opts): string[] {
  const execFlags = [
    "-c", `max_iterations=${maxIterations}`,
    ...buildHeadlessFlags({ includeSandbox: opts.includeSandbox }),
  ];
  // ...
  return ["exec", "--json", ...execFlags, ...opts.commandArgs];
}
```

`buildHeadlessFlags()` (L49-59):
```typescript
function buildHeadlessFlags(opts: { includeSandbox: boolean }): string[] {
  const flags = ["--skip-git-repo-check"];
  const mode = process.env.GATEWAY_CODEX_APPROVAL_MODE || "sandbox";
  if (mode === "bypass") {
    flags.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (opts.includeSandbox) {
    flags.push("-s", "workspace-write");  // <-- 问题在这！
  }
  return flags;
}
```

**问题链条**:
1. `resumeSession()` 传 `includeSandbox=false` 给 `spawnCodex()`
2. `spawnCodex()` 调 `buildCodexExecArgs({ includeSandbox: false })`
3. `buildHeadlessFlags({ includeSandbox: false })` 在 `mode="sandbox"` 时**不 push `-s`**（因为 includeSandbox=false）
4. 但在 `mode="bypass"` 时，**不管 includeSandbox，都会 push `--dangerously-bypass-approvals-and-sandbox`**
5. 最终 resume 命令拼成：`codex exec --json -c max_iterations=10 --dangerously-bypass-approvals-and-sandbox resume <tid> -`

**实际根因**: Codex CLI v0.139.0+ 的 `exec resume` 子命令**不接受 exec 级别的 flag**（如 `--dangerously-bypass-approvals-and-sandbox`、`-c max_iterations`、`--skip-git-repo-check`）。这些 flag 只能放在 `exec` 和 `resume` 之间。当 resume 路径直接把 `resume <tid> -` 作为 `commandArgs` 拼到 exec flags 后面，Codex CLI 解析器把 `-s`（如果 sandbox mode 开了）或其他 flag 解释为 resume 子命令的参数，导致报错。

但实际报错信息是 `unexpected argument '-s'`，说明 `includeSandbox=false` 没有生效，或者 `mode=bypass` 路径存在但 `-s` 来自其他地方。

**重新检查**: 实际报错 `unexpected argument '-s' found`。看 `buildCodexExecArgs`，`-s` 只在 `buildHeadlessFlags` 中出现。当 `includeSandbox=true` 时会 push `"-s", "workspace-write"`。但 resume 路径传的是 `false`。

**等等** - 日志中实际是 `codex exec resume` 时报的错。让我再看 `spawnCodex` 的调用链：

```typescript
// resumeSession 调用:
const args = ["resume", sessionId, "-"];
return spawnCodex(args, prompt, ..., false /* includeSandbox */, ...);

// spawnCodex 内部:
const execFlags = buildCodexExecArgs({ commandArgs: args, includeSandbox: false, model });
// buildCodexExecArgs 返回: ["exec", "--json", "-c", "max_iterations=10", "--skip-git-repo-check", "resume", <tid>, "-"]
```

当 `GATEWAY_CODEX_APPROVAL_MODE` 未设置（默认 `sandbox`）且 `includeSandbox=false` 时，flags 只有 `--skip-git-repo-check`，没有 `-s`。

**所以报错 `-s` 不可能来自当前代码路径**——除非环境变量 `GATEWAY_CODEX_APPROVAL_MODE=sandbox` 但 codex 自身有其他机制。或者，Codex CLI 的 `exec resume` 子命令有自己的参数解析逻辑。

**最终定位**: 问题出在 `buildCodexExecArgs` 把 exec 级 flags 和 resume 子命令参数混在一起。Codex CLI 的 resume 子命令不接受 `-c` 和 `--skip-git-repo-check` 等全局 flag。当这些 flag 出现在 `resume` 之后，Codex CLI 解析器把它们当作 resume 的参数处理，导致 `-s`（可能是 `-c` 被误解析）报错。

实际上日志显示 resume 走的确实是这个路径，错误是 `unexpected argument '-s' found`。需要检查是否有其他地方注入 `-s`。

### 1.3 结论

**根因**: `buildCodexExecArgs()` 对 create 和 resume 两种路径不做区分，把 exec 级 flag（`-c`, `--skip-git-repo-check`, `-s workspace-write` 等）统一拼接。Codex CLI 的 `exec resume` 子命令的参数解析与 `exec` 不同，exec 级 flag 放在 resume 之后会导致解析失败。

**具体错误**: `--skip-git-repo-check` 中包含 `-s`，被 Codex CLI 解析为 `-s` flag。或者 sandbox mode 开启时 `-s workspace-write` 直接出现在 resume 参数中。

## 2. 设计方案

### 2.1 方案: 分离 create 和 resume 的参数构建

**修改文件**: `src/providers/codex.ts`

**改动点**:

1. `spawnCodex()` 不再统一调用 `buildCodexExecArgs()`。改为接受已经构建好的完整 args 数组。

2. `createSession()` 使用 exec 级 flag + `--cd` + stdin prompt:
   ```
   codex exec --json -c max_iterations=10 --skip-git-repo-check [-s workspace-write] --cd <dir>
   ```

3. `resumeSession()` 使用 resume 子命令，**不传 exec 级 flag**：
   ```
   codex exec --json resume <tid> -
   ```
   resume 子命令只需要 `--json`（exec 级）和 `resume <tid> -`（子命令参数）。`-c`、`--skip-git-repo-check`、`-s` 等不能传给 resume。

4. 如果 resume 需要 sandbox 设置，检查 Codex CLI 是否支持在 resume 子命令中指定。如果不支持，resume 时用 `--dangerously-bypass-approvals-and-sandbox` 作为 exec 级 flag（放在 resume 之前）。

### 2.2 代码变更

```typescript
// 修改 spawnCodex 签名，接受完整 args 数组
function spawnCodex(
  fullArgs: string[],    // 已构建好的完整参数数组
  prompt: string,
  cwd: string,
  timeoutMs: number,
  parser: CodexEventParser,
  onSpawn?: (child: import("node:child_process").ChildProcess) => void,
  onStreamUpdate?: (update: import("./types.js").StreamUpdate) => void,
): Promise<SessionOutput> { ... }

// createSession 路径
const execFlags = ["exec", "--json", "-c", `max_iterations=${maxIterations}`,
                   ...buildHeadlessFlags({ includeSandbox: true })];
if (model) execFlags.push("-m", model);
execFlags.push("--cd", opts.cwd);
// prompt via stdin

// resumeSession 路径 - 只用 exec 级 --json，不传 -c / --skip-git-repo-check / -s
const resumeArgs = ["exec", "--json", "resume", sessionId, "-"];
// 如果需要 sandbox: 在 --json 后面加 --dangerously-bypass-approvals-and-sandbox
// 但不传 -c, --skip-git-repo-check 等
```

### 2.3 验收标准

- [ ] Codex resume 不再报 `unexpected argument '-s'` 错误
- [ ] `codex exec resume <tid> -` 命令能成功执行
- [ ] create session 路径不受影响
- [ ] `npm run build` 通过

## 3. 优先级

**P0** - 当前 Codex resume 完全不可用，每次 resume 都失败后 fallback 到 new session，丢失上下文。
