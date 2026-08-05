# Spec: #134 角色 ID 绑定与 ChorusGate 配置分离

> **Issue**: [#134](https://github.com/AINIZE-SPACE/ChorusGate/issues/134)
> **Iteration**: Sprint 5
> **Branch**: `v5/issue-134-agent-profile-config`
> **Product owner / acceptance**: 小扣
> **Development**: 小克
> **Test design and SIT**: 小马
> **Status**: Ready for development
> **Date**: 2026-08-05

## 1. 决策摘要

ChorusGate 的 Slack 身份、provider、工作目录和网关行为属于“运行该 ChorusGate 服务的数智员工”，不属于任一业务项目。Sprint 5 将 ChorusGate 专属配置从项目根 `.env` 分离到用户级目录：

```text
~/.chorusgate/
  default/.env
  claude/.env
  codex/.env
  hermes/.env
  openclaw/.env
```

启动入口统一为：

```bash
chorusgate run --agent <agent-id>
```

`--agent` 缺省为 `default`。高级场景可用 `--env-file <absolute-path>` 指定单个配置文件；`--agent` 与 `--env-file` 互斥，避免来源不确定。

Claude/Codex/Hermes/OpenClaw 自身的 MCP、skill、API key、persona、平台配置继续留在各自平台目录。项目专属的 agent 配置可以继续留在项目中，但不得再次承载 ChorusGate 的身份绑定配置。

## 2. 目标与非目标

### 2.1 目标

1. 同一机器可运行多个、身份互不串线的 ChorusGate 实例。
2. CLI、Slack、Web Console 使用同一 agent 平台配置和同一身份语义。
3. 项目切换不改变 Slack Bot 身份、provider 或命令前缀。
4. 提供可预览、可回滚、默认不删除源文件的迁移路径。
5. 保留单 agent 单机器的零参数体验：`chorusgate run` 等价于 `--agent default`。

### 2.2 非目标

- 不迁移或重写 Claude/Codex/Hermes/OpenClaw 的全局配置格式。
- 不自动复制 API key、MCP、skill 或 persona 到 `~/.chorusgate`。
- 不在本需求内统一各 agent 平台的安装器。
- 不删除现有项目 `.env`；删除或清理必须由用户在验证后单独执行。

## 3. 配置边界

### 3.1 `~/.chorusgate/<agent-id>/.env` 可包含

以仓库 `.env.example` 为配置契约，主要包括：

- Slack 连接与身份：`SLACK_APP_TOKEN`、`SLACK_BOT_TOKEN`
- provider 与启动：`GATEWAY_PROVIDER`、`CLAUDE_BIN`、`CODEX_BIN`
- agent 工作目录：`GATEWAY_CLAUDE_CWD` / `GATEWAY_CWD_*`
- 命令、session、进度、权限、超时等 `GATEWAY_*`
- 当前已支持的多 profile 配置（`GATEWAY_PROFILES` 及其后缀变量）

`.env.example` 是 ChorusGate 配置项的唯一公开清单；实际值文件不得提交 Git。

### 3.2 继续跟随 agent 平台的配置

| Agent | 平台配置示例 | 规则 |
|---|---|---|
| Claude | `~/.claude/settings.json`、MCP、skills | 全局能力留平台目录；项目覆盖可留项目目录 |
| Codex | `~/.codex/config.toml`、MCP、skills | 全局能力留平台目录；项目覆盖可留项目目录 |
| Hermes | `~/.hermes/.env`、`config.yaml` | Hermes 官方 gateway 配置不迁入 ChorusGate |
| OpenClaw | OpenClaw 官方配置目录 | 由 OpenClaw 自身管理 |

`agent-id` 是 ChorusGate 配置选择器，不等同于项目名，也不替代平台自己的 profile/project 机制。

## 4. CLI 与加载规则

### 4.1 命令

```bash
# 默认身份
chorusgate run
chorusgate run --agent default

# 指定数智员工
chorusgate run --agent claude
chorusgate run --agent codex

# 高级场景：指定绝对路径
chorusgate run --env-file C:\secure\chorusgate-codex.env

# 迁移（默认 dry-run）
chorusgate config migrate --agent codex --from E:\project\.env
chorusgate config migrate --agent codex --from E:\project\.env --apply
```

### 4.2 解析与校验

- `agent-id` 必须匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`，禁止路径穿越。
- `--env-file` 必须是已存在的文件；相对路径报错，不隐式按 cwd 解析。
- 显式指定的配置不存在、不可读或缺少启动必需项时，进程失败并给出文件路径与缺失变量；不得静默回退到项目 `.env`。
- 日志只显示配置来源和变量名，不显示 token/value。

### 4.3 加载优先级

从低到高：

1. 程序默认值；
2. `~/.chorusgate/<agent-id>/.env`，或 `--env-file` 指向的文件；
3. 启动进程已有的 shell 环境变量。

Sprint 5 后，主 `chorusgate run` 不再自动加载仓库根 `.env`、cwd 根 `.env` 或旧 `~/.gateway/.env`。项目中的 `.gateway/.env` 也不作为身份配置自动源。旧位置只由迁移命令读取。

## 5. 迁移设计

`chorusgate config migrate` 执行以下步骤：

1. 读取 `--from` 指定的旧 `.env`。
2. 依据当前 `.env.example` 的 ChorusGate 配置键生成迁移预览。
3. 将非 ChorusGate / agent 平台键列为“保留在原平台或项目”，不复制。
4. 默认只输出 dry-run；`--apply` 才写入 `~/.chorusgate/<agent-id>/.env`。
5. 目标已存在时拒绝覆盖，除非显式 `--force`；覆盖前生成时间戳备份。
6. 永不自动删除或改写源 `.env`。
7. 输出迁移后启动命令和验证清单。

迁移范围包括当前 ChorusGate、Zederer IP 等项目中历史遗留的 ChorusGate 变量；每个平台/项目逐一执行，不能用一次迁移推断全部机器已完成。

## 6. 实现切片

### Story A — CLI 配置选择

- `bin/chorusgate.mjs` 支持 `run --agent`、`run --env-file`。
- 新增参数解析的帮助文本、错误码和默认值。
- CLI 解析结果在 import/bootstrap 前传入加载器，避免模块顶层提前冻结 `process.env`。

### Story B — 配置加载器

- `src/load-env.ts` 改为显式 `ConfigSource` 输入。
- 移除主启动路径对项目 `.env`、cwd `.env`、`~/.gateway/.env` 的隐式加载。
- 提供来源诊断，但对秘密值全量脱敏。
- 保持 shell 环境变量优先级和 MCP placeholder 修复行为。

### Story C — 迁移器

- 新增 `config migrate`、dry-run、`--apply`、冲突保护和备份。
- 依据 `.env.example`/集中定义的键集合筛选 ChorusGate 配置。
- Windows、macOS/Linux 的 home 与路径处理使用 Node 标准库，不拼接平台特定分隔符。

### Story D — 文档与示例

- 同步更新 `.env.example`、README、README_CN、INSTALL 和 CLI help。
- 明确“ChorusGate 配置”与“agent 平台配置”的边界。
- 提供 default、claude、codex、hermes、openclaw 示例，但示例不得含真实 token。

## 7. 验收标准

- [ ] `chorusgate run` 从 `~/.chorusgate/default/.env` 启动。
- [ ] `chorusgate run --agent codex` 只选择 `~/.chorusgate/codex/.env`。
- [ ] 同一项目目录分别启动 claude/codex 时，Bot token、provider、cwd、command prefix 不串线。
- [ ] 切换 cwd/项目不会改变已选 agent 身份。
- [ ] 显式配置缺失或非法时 fail closed，不回退项目 `.env`。
- [ ] shell 环境变量覆盖配置文件，且日志不泄露 token。
- [ ] 迁移默认 dry-run；`--apply` 不删除源文件，冲突时不覆盖，`--force` 前有备份。
- [ ] 非 ChorusGate 键不会迁入 `~/.chorusgate`。
- [ ] `.env.example`、中英文文档、CLI help 与实际行为一致。
- [ ] 现有 default 单实例用户有清晰迁移路径。
- [ ] parser/typecheck、单元测试、SIT 分层报告，不以单一绿灯替代端到端验收。

## 8. 小马测试设计输入

小马与开发并行输出测试用例/脚本，至少覆盖：

1. 默认 agent、显式 agent、自定义 env file 三种启动路径。
2. 非法 agent-id、路径穿越、相对 env path、文件缺失、必需变量缺失。
3. shell 覆盖、MCP placeholder、模块晚绑定，防止环境变量冻结回归。
4. 两个 agent 对同一 cwd 并行启动的身份隔离。
5. 项目切换后的身份稳定性。
6. dry-run、apply、目标冲突、force+backup、源文件保留。
7. Windows PowerShell 与至少一个 POSIX 路径样例。
8. 日志脱敏和错误信息可定位性。

SIT 准入交付件：测试策略、用例与可执行脚本、开发自测记录、变更清单和已 push 的开发 commit。缺任一项，小马不开始 SIT。

## 9. SDD 阶段门与交接

```text
小扣：Spec Ready
  ├─> 小克：功能开发 + 单元测试 + 自测交付件
  └─> 小马：测试设计 + 可执行用例脚本
小克：Dev Ready（commit/push + 完整输入）
  └─> 小马：SIT；失败则每个缺陷建 GitHub Issue 并通知小克
小马：SIT Ready（问题清零，或有书面遗漏决策）
  └─> 小扣：验收与发布 PR
```

统一门禁：

- 前序状态未标记 Ready，后序 Owner 不开工。
- 开工前验证 Issue/spec/branch/commit/交付件可见且与当前基线一致。
- 完工前检查输出完整性，提交并 push 后再声明完成。
- 交接必须写明 Owner、Scope、Inputs、Deliverable、Acceptance、Authority boundary、Next owner。
- 缺陷未清零时不得进入验收；决定延期的遗漏必须记录 Owner、风险与目标迭代。

## 10. 当前交接包

```text
Project: AINIZE-SPACE/ChorusGate
Owner: 小克（开发）；小马（测试设计，并行）
Scope: Issue #134，角色绑定与配置分离
Inputs: Issue #134 + 本 spec + .env.example + v5 分支
Deliverable: 实现、单元测试、自测证据；测试策略、用例与脚本
Acceptance: 本 spec §7；SIT 准入见 §8
Authority boundary: 不迁移真实秘密，不删除旧配置，不发布/合并 main
Next owner: 小克完成后通知小马 SIT；小马通过后通知小扣验收
```
