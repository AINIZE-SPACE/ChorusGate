# ChorusGate Agent Profile 配置 — 整体总结与指南

> 大扫除交付物 | 日期：2026-08-14 | 分支：`v5/issue-134-agent-profile-config`
> 文风：**code-first**（以本仓库实际代码为准）。凡涉及"平台侧参考"（Claude Code / Clines 自身的 CLI 语义）均明确标注为**非本仓库代码**，供后续对接研究使用，不混入本仓库事实。
> 关联 issue：#134 Agent Profile Config

---

## 0. 五分钟速读

ChorusGate 的 agent-profile 配置，一句话：

> **`--agent <id>` 选人，`~/.chorusgate/<id>/.env` 放配置，`config migrate` 从项目 .env 搬家，`config init` 办入门。**

- CLI 入口是 **`--agent <id>` / `--env-file <path>`**（互斥），**不是** `--profile` / `--config`。
- 每个 agent 一个隔离家目录：`~/.chorusgate/<id>/.env`（配置）+ `gateway.pid / status.json / gateway.log`（控制面）。
- 本仓库**没有** Clines 集成、**没有** `clines_profiles.json` / `clines_config.json`、**没有** slot/tenant 语义、**没有** `--profile`/`--config` 透传。任务描述中的相关源码文件在本仓库**不存在**，详见 §4。
- ⚠️ 任务给出的"完整全景"输入与本仓库实际不符，本文档按"以代码为准"原则记录真实状态，并单独整理平台侧对照参考（§7）。

---

## 1. Status Report（完成状态声明）

本次大扫除任务已按 code-first 完成。产出：

| 交付物 | 状态 |
|---|---|
| 本文档（`docs/agent-profile-config.md`） | ✅ 已创建 |
| 覆盖 `--agent`/`--env-file`（真实 profile 入口） | ✅ §3 |
| 覆盖 `--profile`/`--config` 两条路径 | ⚠️ 见 §4 / §7（本仓库无此两 flag，已如实说明；平台侧语义整理为参考） |
| 覆盖 Clines profile 处理逻辑（`clines-config.ts`） | ⚠️ 文件不存在，见 §4.1 |
| 覆盖 Claude Code profile 处理逻辑（`claude-profile.ts`） | ⚠️ 文件不存在，见 §4.1 |
| 覆盖 ChorusGate 自身 profile 逻辑（`profile-config.ts`） | ✅ §3.7 |
| 覆盖双 CLI（Clines/Claude Code）profile 差异 | ✅ §7（外部参考） |
| 覆盖 Clines 双文件约定 | ⚠️ 本仓库无此约定，见 §4.1 |
| 覆盖 SSH 主机级验证 | ⚠️ 本仓库无，见 §4.1/§4.4 |
| 覆盖 slot/tenant 词源 | ⚠️ "slot" 在本仓库仅指并发槽位（撞名，语义不同），见 §3.6/§4.4 |
| 配置/环境变量清单（profile 相关） | ✅ §6 |
| 开发者工作流 | ✅ §8 |
| 改动范围与影响 | ✅ §9 |
| Next Steps | ✅ §10 |

⚠️ 说明：清单中标注 ⚠️ 的项，是因为**本仓库不具备对应代码/功能**（grep 全仓零命中），已如实报告而非虚构。这是本次任务最重要的发现，详见 §4。

---

## 2. 真实代码状态总览（#134 已实现）

收集代码事实（行号引用 `文件:行` 可能随改动失效，均附函数名便于检索）：

| 关注点 | 真实实现 | 位置 |
|---|---|---|
| CLI flag | `--agent <id>` / `--env-file <path>` / `--init` | `src/cli-args.ts` — `parseCliArgs()` |
| agent-id 校验 | `^[a-z0-9][a-z0-9_-]{0,63}$`，禁路径穿越，与 `--env-file` 互斥 | `src/cli-args.ts` — `validateAgentId()` / `validateEnvFilePath()` |
| 配置路径 | `~/.chorusgate/<id>/.env`；legacy 兼容 `~/.gateway/.env` + `<project>/.env` + `./.gateway/.env` | `src/load-env.ts` — `CHORUSGATE_HOME` / `agentProfileEnvPath()` / `loadEnv()` |
| 加载优先级 | agent profile → `--env-file` → shell env（shell 永远不被覆盖） | `src/load-env.ts` |
| 启动序列 | loadEnv → MCP 占位符修复 → parseProfiles → 平台可执行检测 → Slack 客户端 | `src/bootstrap.ts` — `bootstrap()` |
| 控制面文件 | `~/.chorusgate/<agent>/{gateway.pid, gateway.log, status.json}`；缺省 agent = `"default"` | `src/gateway-paths.ts` — `getPidFile()` 等 |
| 控制命令 | `start / stop / restart / status / list`；start 时向 daemon 转发 `--agent`/`--env-file` | `src/gateway-control.ts` |
| 初始化 | `config init --agent <id>`；模板含 `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` / `GATEWAY_PROVIDER` / `GATEWAY_CLAUDE_CWD` | `src/config-init.ts` — `initializeAgentProfile()` / `prepareRunConfig()` |
| 迁移 | `config migrate --from <env> [--apply] [--force]`；默认 dry-run；按 `CHORUSGATE_KEY_PREFIXES` 过滤键；auto-detect 支持 claude/codex/hermes/openclaw，**歧义或缺失标记均 fail-closed 要求显式 `--agent`** | `src/config-migrate.ts` — `migrateConfig()` |
| Windows 管理员 | `bin/chorusgate.mjs` 与 `gateway.ts` 双重调用 `requireWindowsAdmin()` | `src/require-admin.ts`（**新增文件**） |
| Slack 多 app profile | `GATEWAY_PROFILES` + `SLACK_BOT_TOKEN_<ID>` 等（**与 agent profile 是两个概念**） | `src/profile-config.ts` — `parseProfiles()` |

未提交的工作区内容（当前分支 in-progress）：`bin/chorusgate.mjs`、`memory/events.md` 已修改；`src/require-admin.ts`、`tests/require-admin.test.ts`、`tests/test-suite-baseline.txt`、`tests/PostRefactor/` 尚未跟踪。

---

## 3. 关键机制说明

### 3.1 CLI 入口：`--agent` / `--env-file`（`src/cli-args.ts`）

- `chorusgate run --agent default` ≡ `chorusgate run`（缺省即 `default`）。
- `--agent` 与 `--env-file` **互斥**（spec §4.1），`--env-file` 必须绝对路径（spec §4.2）。
- agent-id 正则 `^[a-z0-9][a-z0-9_-]{0,63}$`：小写字母/数字开头，仅允许小写+数字+`-`+`_`，1-64 位；显式拒绝 `/ \ ..`（防路径穿越/注入）。
- `--init`：profile 缺失时自动初始化（与 `config init` 等价）。

### 3.2 配置位置与加载顺序（`src/load-env.ts`）

Agent 模式加载顺序（后加载覆盖前加载，shell 最高优先且不回写）：

1. `~/.chorusgate/<agent-id>/.env` — agent profile 配置
2. `--env-file <path>` — 显式文件（若指定）
3. Shell 环境 — 已存在于 `process.env`，**永不覆盖**

Legacy 模式（不加 `--agent`/`--env-file`）：

1. `~/.gateway/.env` — 全局默认
2. `<project-root>/.env` — 项目级
3. `./.gateway/.env`（cwd）— 工作目录覆盖
4. Shell 环境 — 永不覆盖

`CHORUSGATE_HOME = ~/.chorusgate`（`src/load-env.ts:64`）。显式指定的文件（`--agent`/`--env-file`）缺失时**抛错并给出提示**（`loadRequired()`），legacy 文件缺失则静默跳过。

### 3.3 启动序列（`src/bootstrap.ts`）

`bootstrap({ agentId, envFile })` → `loadEnv` → `fixMcpPlaceholders`（处理 MCP 注入的字面 `"${SLACK_BOT_TOKEN}"`）→ `parseProfiles()`（解析 Slack app profiles）→ `validateAgentPlatforms()`（检测 agent 可执行文件）→ `initSlackClients()`（用第一个 profile 初始化默认单例，向后兼容）→ 返回 profiles。任何必需 token 缺失都会 `process.exit(1)`。

### 3.4 控制面（`src/gateway-paths.ts` + `src/gateway-control.ts`）

#134 的核心主张：**agent 是跨项目进程，其进程级文件不属于任何项目目录**。

- 全部落在 `~/.chorusgate/<agent>/`：`gateway.pid`、`gateway.log`、`status.json`。
- 项目本地 `.gateway/` **不是** daemon 家目录，只放当前项目的项目态状态。
- `gateway-control.ts` 的 `start()` 会向前台 daemon 转发 `--agent` / `--env-file` / `--init`（`gateway-control.ts:112-117`），保证控制命令与 daemon 读到同一套 profile。
- 缺省 agent 常量 `DEFAULT_AGENT = "default"`（`gateway-paths.ts:28`）。`controlAgentId = agentId ?? "default"`（`gateway.ts:33`）。

### 3.5 初始化与迁移（`src/config-init.ts` / `src/config-migrate.ts`）

- **`config init --agent <id>`**：若源 `.env` 存在则直接走迁移；否则写入 starter 模板并提示补 token。返回值带 `ready` 标记。
- **`config migrate --from <path>`**：
  - 默认 **dry-run**（只打印预览），`--apply` 才落盘，`--force` 先做时间戳备份，**绝不删除源文件**。
  - 键分类 `CHORUSGATE_KEY_PREFIXES`（`src/config-migrate.ts:32-41`）——前缀命中以下任意一个才属于 ChorusGate 配置、才会被搬走：`SLACK_`、`GATEWAY_`、`CLAUDE_BIN`、`CODEX_BIN`、`CLAUDE_PERMISSION_MODE`、`CLAUDE_STREAM_PARTIAL`、`GATEWAY_CLAUDE_MODE`、`TRELLO_`。平台 API key（`ANTHROPIC_API_KEY` 等）留在源文件。
  - 自动检测 agent（`src/config-migrate.ts` — `detectAgentId()`）：按 `GATEWAY_PROVIDER`（claude / claude-stream / codex / hermes / openclaw）→ `CLAUDE_BIN` / `CODEX_BIN` → Claude 专属变量顺序识别。**fail-closed 边界**（接受校验 #135 要求）：多个 agent 标记冲突 → 抛歧义错误要求显式 `--agent`；无任何标记 → 抛错要求显式 `--agent`，**不再静默兜底 `"default"`**。
  - 迁移时若指定 `--cwd`，会把 `GATEWAY_CLAUDE_CWD` 显式写入目标，避免 "配置搬家后 cwd 语义改变" 的隐性回归（`src/config-migrate.ts:162-171`）。
- **`prepareRunConfig()`**：`run`/`start` 前 preflight——profile 缺失时拦截并提示 `--init`；profile 存在但缺 token 时列出缺失项。

### 3.6 Windows 管理员要求（`src/require-admin.ts`，新增）

- `isWindowsElevated()`：PowerShell `WindowsPrincipal.IsInRole(Administrator)`，纯 token 级检测（不依赖 Windows Server service 等易误报的服务），非 win32 恒真。
- `requireWindowsAdmin()`：未提权时输出引导信息并 `process.exit(1)`；支持 `check` 注入（测试/嵌入钩子）。
- 双保险：`bin/chorusgate.mjs:22-27` 对所有 CLI 命令先查一次（含 hint 展示命令）；`gateway.ts:25` 再查一次（防 `npm run gateway` / tsx 直跑绕过 CLI 分发）。MCP 入口 `src/index.ts` **有意不启用**（Claude Code 以未提权方式 spawn 它）。
- **命名勘误**：任务背景提到 `requireAdmin()` / `requireAdminLock()` —— 本仓库实际导出的是 `requireWindowsAdmin()` / `isWindowsElevated()` / `adminRequirementMessage()`，无 `requireAdminLock`。

### 3.7 两个 "profile" 概念辨析（重要，避免混淆）

| | **agent profile**（#134 主角） | **Slack app profile**（`profile-config.ts`） |
|---|---|---|
| 入口 | CLI `--agent <id>` | 环境变量 `GATEWAY_PROFILES=cc,codex,...` |
| 载体 | `~/.chorusgate/<id>/.env` | `SLACK_BOT_TOKEN_<ID>` / `SLACK_APP_TOKEN_<ID>` / `GATEWAY_PROVIDER_<ID>` / `GATEWAY_CWD_<ID>` / `GATEWAY_COMMAND_PREFIX_<ID>` |
| 语义 | "这台机器上谁是这台 daemon 的主" | "同时接入 N 个 Slack App"，各自独立 token/provider/前缀 |
| 同文件共存 | 一个 agent 的 `.env` 里可以声明 `GATEWAY_PROFILES`，两机制正交叠加 | `bootstrap()` 中按第一个 profile 初始化默认客户端 |

触发词 `GATEWAY_PROFILE_TRIGGERS_<ID>`（`parseProfileTriggers()`，`profile-config.ts:196`）用于 #128 智能回复的名字匹配，同样属于 Slack 层 profile。

另外：`gateway.ts` 中 `acquireSlot()`/`releaseSlot()` 的 **slot 仅指并发槽位**（`running` 计数器 + 信号量，`gateway.ts:430-446`），与任务背景中的 Clines "slot/tenant" **完全不同的词源，只是撞名**。本仓库没有任何 tenant 概念。

---

## 4. 与任务描述的差异（重要，必须如实说明）

在动笔前对全仓库做了交叉验证（`grep -ri "clines"` 全仓、Glob 全仓、`git status`），结论如下：

### 4.1 任务提到的文件在本仓库不存在

| 任务描述 | 实际状态 |
|---|---|
| `src/clines-config.ts`（含 `SLOT_KEY`） | ❌ 不存在 |
| `src/claude-profile.ts` | ❌ 不存在 |
| `src/ssh-host-verification.ts` | ❌ 不存在 |
| `src/gateway-env.ts` | ❌ 不存在 |
| `clines_profiles.json` / `clines_config.json` 双文件约定 | ❌ 不存在 |
| SSH 主机级验证 / rsync 迁移 / `rsync_continue` | ❌ 不存在 |
| `CHORUSGATE_DEFAULT_PROFILE` / `CHORUSGATE_STARTUP_SYNC` / `CHORUSGATE_CONFIG_FILE` | ❌ 不存在（全仓无此三变量） |
| `CLINES_HOME` / `CLINES_PROFILES_FILE` / `CLINES_CONFIG_FILE` / `CLINES_ENV_HOME` / `CLINES_RUN_DIR` / `CLINES_BIN` | ❌ 不存在 |
| `--profile` / `--config` CLI flags（gateway.ts 校验、启动逻辑） | ❌ 不存在（`grep --profile\|--config` 于 `src/` 零命中） |
| slot/tenant 语义、profile name 大小写不敏感等 | ❌ 不存在于本仓库 |

### 4.2 差异的可能成因与影响

- **最可能**：任务背景素材（"完整全景"）来自**对 Clines / Claude Code 平台 CLI 本身的研究**（或另一仓库/预期中的未来对接），并非本仓库已落地的实现。Clines / Claude Code 的 `--profile`/`--config` 语义确实是平台侧的，ChorusGate（本仓库）尚未与 Clines 对接，因此没有对应的适配层。
- **影响**：清单中要求"覆盖 `clines-config.ts` / `claude-profile.ts` / SSH 主机级验证 / slot-tenant 迁移影响"等项**无法以本仓库代码达成**。若强行写，将变成虚构代码，与"以代码为准"冲突。
- **应对**：本文档 §7 将提供的 Clines/Claude Code 对照整理为**平台侧参考（非本仓库代码）**，供未来"ChorusGate 适配 Clines"时直接引用；真实落地时创建的文件应以本文档为起点再做代码级验证。

### 4.3 测试侧可佐证的位置

`tests/issue134-agent-config.test.ts`、`tests/config-init.test.ts`、`tests/config-migrate.test.ts`、`tests/cli-args.test.ts`、`tests/control-plane.test.ts`、`tests/gateway-paths.test.ts`、`tests/require-admin.test.ts` 均围绕 **`--agent`/`--env-file`/`~/.chorusgate`** 这套真实机制，没有任何 clines/ssh-host-verification/slot-tenant 测试——与 §4.1 相互印证。

---

## 5. 关键源码片段（示例）

### 5.1 agent-id 校验（`src/cli-args.ts:20`）

```ts
/** Regex for valid agent-id: lowercase alphanumeric + dash/underscore, 1-64 chars.
 *  Blocks path traversal and shell injection characters. */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
```

### 5.2 配置路径（`src/load-env.ts:63-72`）

```ts
/**
 * Root directory for agent profile configs.
 * Overridable via CHORUSGATE_HOME (test/embedding seam). Defaults to ~/.chorusgate.
 */
export const CHORUSGATE_HOME = resolve(
  process.env.CHORUSGATE_HOME || join(homedir(), ".chorusgate"),
);

/**
 * Get the agent profile .env path.
 *   ~/.chorusgate/<agentId>/.env
 */
export function agentProfileEnvPath(agentId: string): string {
  return resolve(CHORUSGATE_HOME, agentId, ".env");
}
```

### 5.3 控制面路径（`src/gateway-paths.ts` 摘要）

```ts
export const DEFAULT_AGENT = "default";
export function getPidFile(agentId = DEFAULT_AGENT): string {
  return resolve(getGatewayDir(agentId), "gateway.pid");
}
export function getLogFile(agentId = DEFAULT_AGENT): string {
  return resolve(getGatewayDir(agentId), "gateway.log");
}
export function getStatusFile(agentId = DEFAULT_AGENT): string {
  return resolve(getGatewayDir(agentId), "status.json");
}
```

### 5.4 迁移键分类（`src/config-migrate.ts:32-41`）

```ts
const CHORUSGATE_KEY_PREFIXES = [
  "SLACK_",          // SLACK_BOT_TOKEN, SLACK_APP_TOKEN
  "GATEWAY_",        // all gateway daemon settings
  "CLAUDE_BIN",      // Claude/Codex binary paths (ChorusGate controls these)
  "CODEX_BIN",
  "CLAUDE_PERMISSION_MODE",
  "CLAUDE_STREAM_PARTIAL",
  "GATEWAY_CLAUDE_MODE",
  "TRELLO_",         // optional Trello MCP
];
```

### 5.5 Windows 管理员检测（`src/require-admin.ts:31-51`）

```ts
export function isWindowsElevated(): boolean {
  if (process.platform !== "win32") return true;
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command",
      "([Security.Principal.WindowsPrincipal]" +
      "[Security.Principal.WindowsIdentity]::GetCurrent())." +
      "IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  return /^\s*true\s*$/i.test(String(out).trim());
}
```

### 5.6 缺省 agent 兜底（`src/gateway.ts:28-33`）

```ts
const agentId = cliArgs.agentId ?? (cliArgs.envFile ? undefined : "default");
const controlAgentId = agentId ?? "default";
const profiles = bootstrap({ agentId, envFile: cliArgs.envFile });
```

---

## 6. Profile 相关环境变量清单（真实存在，code-first）

> 说明：本仓库**没有** `gateway-env.ts` 这类集中登记模块；以下变量散落在各处，均由源码逐行确认。标注 ⭐ 的与 profile 直接相关。

### 6.1 Agent profile（#134 主体）

| 变量 | 用途 | 出处 |
|---|---|---|
| `CHORUSGATE_HOME` | `~/.chorusgate` 常量；可用同名环境变量覆盖（测试/嵌入接缝） | `src/load-env.ts:64` |
| `CHORUSGATE_STATE_DIR` ⭐ | 覆盖 memory 状态目录（测试/嵌入用，非 profile 选择） | `src/state-paths.ts:12` |

> 注意：**选择 profile 的入口是 CLI flag `--agent`/`--env-file`，不是环境变量**。`~/.chorusgate/<id>/.env` 里通过 `GATEWAY_PROFILES` 等声明的是 Slack 多 app profile（见 6.3）。

### 6.2 Slack 多 app profile（`src/profile-config.ts`）

| 变量 | 说明 |
|---|---|
| `GATEWAY_PROFILES` ⭐ | 逗号分隔的 profile id 列表（如 `cc,codex`）；缺省时构建单 `default` |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | legacy 单 profile 令牌 |
| `SLACK_BOT_TOKEN_<ID>` / `SLACK_APP_TOKEN_<ID>` ⭐ | 多 profile 令牌（`<ID>` 大写） |
| `GATEWAY_PROVIDER` / `GATEWAY_PROVIDER_<ID>` ⭐ | 绑定 provider：`claude` / `codex` / `claude-stream` |
| `GATEWAY_CWD_<ID>` | 每个 profile 的工作目录（与 `--cwd`/`GATEWAY_CLAUDE_CWD` 配合） |
| `GATEWAY_COMMAND_PREFIX` / `GATEWAY_COMMAND_PREFIX_<ID>` | slash 命令前缀（如 `cc` → `/cc_*`） |
| `GATEWAY_PROFILE_TRIGGERS_<ID>` | 智能回复触发词：`显示名,别名1,别名2` |

### 6.3 Agent 平台二进制与行为

| 变量 | 说明 | 出处 |
|---|---|---|
| `CLAUDE_BIN` / `CODEX_BIN` ⭐ | provider 可执行文件路径覆盖 | `src/agent-platform.ts`、`src/providers/*` |
| `CLAUDE_PERMISSION_MODE` | 默认 `bypassPermissions`；非该值时启用交互审批 | `src/providers/claude*.ts` |
| `CLAUDE_MODEL` / `CLAUDE_STREAM_PARTIAL` | Claude 模型覆盖 / stream 部分结果开关 | `src/providers/claude-stream.ts` |
| `CODEX_MODEL` / `CODEX_MAX_ITERATIONS` / `GATEWAY_CODEX_APPROVAL_MODE` | Codex 模型 / 迭代上限 / 审批模式（默认 sandbox） | `src/providers/codex.ts` |
| `GATEWAY_CLAUDE_MODE` | legacy | stream 模式切换 | `src/reply-engine.ts:31` |
| `GATEWAY_CLAUDE_CWD` ⭐ | 缺省 profile 工作目录（迁移时由 `--cwd` 显式写入） | `src/gateway.ts:80`、`src/config-migrate.ts:167` |

### 6.4 Gateway daemon 行为（非 profile 专属，但随 profile 迁移）

`GATEWAY_SESSION_SCOPE`、`GATEWAY_MAX_CONCURRENT`、`GATEWAY_REPLY_TIMEOUT_MS[_LONG]`、`GATEWAY_PROGRESS[_MODE|_MAX_MESSAGES]`、`GATEWAY_THREAD_SMART_REPLY`、`GATEWAY_LLM_REPLY_JUDGE`、`GATEWAY_SESSION_IDLE_MS`、`GATEWAY_INTERACTIVE_PERMISSIONS`、`GATEWAY_BUSY_MODE` —— 均在 `src/gateway.ts`/`src/interrupt.ts` 中读取，属于 `GATEWAY_` 前缀、会被 `config migrate` 视为 ChorusGate 键一并搬迁。

---

## 7. `--profile` / `--config` 双 CLI 对照（平台侧参考，非本仓库代码）

> ⚠️ 本节内容**不是本仓库代码**，来自任务提供的"完整全景"研究输入。本仓库既不解析、也不转发这两个 flag。未来"ChorusGate 对接 Clines"时需先在真实 CLI 上实测（项目铁律：文档有 ≠ 版本支持），再落地为适配层。

### 7.1 Claude Code 侧（大致语义，待真实 CLI 实测）

- `claude --profile <name>`：选择命名配置 profile（settings 命名空间）。
- 配置文件路径参数：Claude Code 使用 **`--settings <path>`** 语义（指向 settings.json），与 Clines 的 `--config <path>` 同名不同物。
- 本仓库 `src/providers/claude.ts` / `claude-stream.ts` 目前 spawn `claude` 时**不传**任何 profile/settings flag——即运行在默认配置上。

### 7.2 Clines 侧（任务研究的结论，待实测确认）

- `--profile <name>`：**引用 slot**（profile name → slot 解析），不是配置文件。
- `--config <path>`：指向配置**文件路径**（`clines_config.json`），接受**分号分隔的文件列表**。
- 双文件约定：`clines_profiles.json`（slot 定义）+ `clines_config.json`（全局配置）。
- profile name 在 Windows 上 **大小写不敏感**，slot/tenant 语义为 Clines 特有（slot 取自 slot name，tenant 取自 agent username）。
- SaaS 模式下需持久化 `clines_profiles.json`；chore 任务下用临时文件创建。
- 在开启 SSH 主机级验证（ssh-host-verification / rsync 迁移）的场景下，`--config`/`--profile` 会因 slot/tenant 语义与 SSH 场景不匹配而出错——**需 ChorusGate 适配 Clines 的 slot/tenant 语义**。

### 7.3 核心差异结论（整理自任务输入）

| 维度 | Claude Code | Clines |
|---|---|---|
| `--profile` | 配置 profile 名称 | slot 名称（解析到 slot） |
| `--config` | （对应 ~/`--settings` 语义的配置文件） | 配置文件路径，分号分隔文件列表 |
| profile 名大小写 | 视平台 | Windows 上大小写不敏感 |
| 与 ChorusGate 现有机制的关系 | ChorusGate 直接透传其它 flag（permission-mode 等），未碰 profile | ChorusGate 未对接，需新建适配 |

**一句话：`--config`/`--profile` 在 Clines 与 Claude Code 里的行为/语义完全不同，接入 Clines 时绝不能按 Claude Code 的心智模型实现。**

---

## 8. 开发者工作流（developer workflow）

日常使用路径（都已实现、均可直接执行）：

```text
# 1. 第一次为某 agent 建档
chorusgate config init --agent claude [--from <project>/.env] [--cwd <project>] [--force]

# 2. 迁移既有项目 .env（先预览，再落盘）
chorusgate config migrate --from E:\project\.env            # dry-run 预览（需可自动检测，否则要求 --agent）
chorusgate config migrate --agent claude --from E:\project\.env --apply
chorusgate config migrate --from E:\project\.env --apply --force   # 覆盖（先备份）

# 3. 定点运行 / 后台运行
chorusgate run --agent claude                      # 前台
chorusgate start --agent claude                    # 后台（控制面文件写入 ~/.chorusgate/claude/）
chorusgate status --agent claude                   # 查状态
chorusgate stop --agent claude                     # 优雅停止

# 4. 排障时读日志
~/.chorusgate/claude/gateway.log
```

要点：

- **每个 agent 一套环境**：`claude`、`codex` 乃至运维侧 agent（`architect`/`reviewer` 之类若需要）各自 `~/.chorusgate/<id>/.env` + 各自控制面，互不污染。不同 agent 用不同 provider（`GATEWAY_PROVIDER`）、不同 `cwd`。
- **`--env-file` 是逃生门**：临时想用一个独立 `.env` 而不建档时用 `chorusgate run --env-file C:\abs\path\.env`（必须绝对路径，且不能与 `--agent` 共用）。
- **`--init` 自动化**：CI/脚本里 `chorusgate run --agent claude --init` 可免交互建档。
- 迁移是**单向搬家 + 留源**：源 `.env` 永远不动；目标写入前若已存在需 `--force`（带时间戳备份）。

---

## 9. 改动范围与影响（project-scoped vs global）

| 变更 | 落点 | 影响范围 | 举例 |
|---|---|---|---|
| 改 `SLACK_BOT_TOKEN`/`GATEWAY_*` | **global**：`~/.chorusgate/<id>/.env` | 该 agent 下**所有项目**的 daemon 行为全部变化 | 换 token、改 `cwd`、改 `GATEWAY_PROFILES` |
| 改平台 API key / 项目专属变量 | **project-scoped**：留在项目 `.env`（迁移时会被归入 keptKeys） | 只影响该项目 | `ANTHROPIC_API_KEY`、`DATABASE_URL` |
| `--env-file <path>` | 临时 override | 只影响本次启动 | 测试环境隔离 |
| CLI flag `--agent` | 选择生效的 global profile | 该 agent 一次运行 | 换 provider |

设计意图（`src/config-migrate.ts` 注释 + `src/gateway-paths.ts` 注释）：**ChorusGate 把"全局运维相关的配置"与"项目业务配置"分开** —— `SLACK_`/`GATEWAY_` 等随 agent 走（跨项目），其它留在项目内。改一个 agent 的配置影响其全部项目，因此 `config migrate` 默认 dry-run + 提示验证。

---

## 10. Next Steps（可操作建议）

按优先级排列，供后续参考（均为建议，非本次任务范围）：

1. **（核实原任务输入）确认 "完整全景" 的来源**：向提供素材的人确认 `clines-config.ts` / `ssh-host-verification.ts` 等描述来自何处（另一分支？另一仓库？预期设计？）。若它们是规划，应新建 spec/issue 而不是引用不存在的文件。
2. **（若确要对接 Clines）先实测再设计**：在真实环境跑 `clines --help` 与 `claude --help`，核对 §7 中平台侧结论（`--profile`/`--config` 语义、分号列表、大小写敏感性、slot/tenant）。项目铁律：文档有 ≠ 版本支持。
3. **（对接 Clines 时）新建适配层**：建议文件落在 `src/providers/clines*.ts` + `src/clines-config.ts`（若坚持该命名），并在 `docs/` 补一份《Clines 对接设计》详述 slot/tenant 与 ChorusGate `--agent` 的映射与冲突面（SSH 主机级验证/rsync 迁移是已知的坑）。
4. **（收尾当前分支）提交未跟踪工件**：`src/require-admin.ts`、`tests/require-admin.test.ts`、`tests/test-suite-baseline.txt` 应随本分支一起提交；`tests/PostRefactor/review.md` 与 #134 无关（另一份 JSON 重构评审的遗留物），建议确认后移走或删除。
5. **（文档维护）补集中登记**：随时间推移建议新增 `src/gateway-env.ts`（或 README 表格）把 §6 的环境变量集中登记，避免"散落各处、靠 grep 考古"。

---

## 附录 A：本次核查的判定依据

- `git branch --show-current` → `v5/issue-134-agent-profile-config`；`git log` 最近 8 条均围绕 #134。
- `grep -ri "clines|Clines"`（全仓库）→ **零命中**；Glob `**/*clines*`、`**/*claude-profile*`、`**/*ssh-host*`、`**/*gateway-env*` → **空**。
- `grep "SLOT_KEY|clines_profiles|clines_config|CLINES_HOME|CLINES_PROFILES"`（`src/`）→ 命中 0。
- `grep "\-\-profile|\-\-config"`（`src/`）→ 命中 0。
- `grep "CHORUSGATE_DEFAULT_PROFILE|CHORUSGATE_STARTUP_SYNC|CHORUSGATE_CONFIG_FILE"` → 命中 0。
- `src/require-admin.ts` 实际导出：`requireWindowsAdmin` / `isWindowsElevated` / `adminRequirementMessage`（无 `requireAdmin` / `requireAdminLock`）。
- 相关测试文件（`issue134-*`、`config-*`、`cli-args`、`control-plane`、`gateway-paths`、`require-admin`）全部围绕 `--agent`/`--env-file`/`~/.chorusgate` 真实机制。