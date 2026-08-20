# 测试策略 - Issue #134: 角色 ID 绑定与 ChorusGate 配置分离

> **Issue**: [#134](https://github.com/AINIZE-SPACE/ChorusGate/issues/134)
> **Spec**: `docs/specs/issue-134-agent-profile-config.md`
> **Branch**: `v5/issue-134-agent-profile-config`
> **Test Owner**: 小马 (U0B91BVKTL2)
> **Date**: 2026-08-12
> **Status**: 测试设计完成，等待开发 Dev Ready 后执行 SIT

---

## 1. 测试目标

验证 #134 实现满足 spec §7 全部验收标准：

1. `chorusgate run` 从 `~/.chorusgate/default/.env` 启动
2. `chorusgate run --agent <id>` 选择 `~/.chorusgate/<id>/.env`
3. 多 agent 同一 cwd 并行启动，身份（Bot token / provider / cwd / prefix）不串线
4. 切换 cwd/项目不改变已选 agent 身份
5. 配置缺失或非法时 fail closed，不回退项目 `.env`
6. shell 环境变量覆盖配置文件，日志不泄露 token
7. 迁移 dry-run / apply / 冲突 / force+backup / 源文件保留
8. 非 ChorusGate 键不迁入 `~/.chorusgate`
9. 文档（.env.example / README / CLI help）与实际行为一致
10. parser/typecheck + 单元测试 + SIT 分层报告

---

## 2. 测试分层

| 层级 | 名称 | 工具 | 目的 | 执行者 |
|------|------|------|------|--------|
| L0 | TypeScript 类型检查 | `npx tsc --noEmit` | 零编译错误 | 小马 |
| L1 | 单元测试 | `node --import tsx --test` | 纯函数逻辑正确 | 小马 |
| L2 | 集成测试 | `npm run test:integration` | 模块间协作 + 现有回归 | 小马 |
| L3 | CLI 烟测 | 可执行 shell 脚本 | 端到端 CLI 行为 | 小马 |
| L4 | 手工验收 | 人工核对文档 | 文档/行为一致性 | 小马 → 小扣 |

---

## 3. 测试范围与用例 ID 前缀

用例 ID 前缀：**ST-CG134-XXX**

| 前缀 | 范围 | Spec §7 对应 | Spec §8 对应 |
|------|------|--------------|--------------|
| ST-CG134-001~005 | 默认/显式/自定义 env file 启动路径 | AC1, AC2, AC4 | §8.1 |
| ST-CG134-006~010 | 非法输入：agent-id 格式、路径穿越、相对路径、文件缺失、必需变量缺失 | AC5 | §8.2 |
| ST-CG134-011~013 | 环境变量优先级、MCP placeholder、模块晚绑定 | AC6 | §8.3 |
| ST-CG134-014~015 | 多 agent 同一 cwd 并行启动身份隔离 | AC3 | §8.4 |
| ST-CG134-016 | 项目切换后身份稳定性 | AC4 | §8.5 |
| ST-CG134-017~021 | 迁移：dry-run / apply / 冲突 / force+backup / 源文件保留 | AC7 | §8.6 |
| ST-CG134-022 | 非 ChorusGate 键不迁入 | AC8 | §8.6 |
| ST-CG134-023~024 | 跨平台路径：POSIX + Windows | AC9 | §8.7 |
| ST-CG134-025~026 | 日志脱敏 + 错误信息可定位性 | AC6 | §8.8 |
| ST-CG134-027~028 | 现有 default 用户迁移路径 + 文档一致性 | AC9, AC10 | — |

总计 **28 个测试用例**。

---

## 4. 测试环境

### 4.1 执行机器

- **主测**: zederer-mbe (Ubuntu 26.04, IP 192.168.1.147) — POSIX 路径样例
- **交叉验证**: ainize-dev (Windows 11, IP 192.168.1.247) — Windows PowerShell 路径样例
  - 由小克开发机执行，或小马通过 `execute_code` subprocess 在 Windows 上跑

### 4.2 前置条件

- Node.js + npm 已安装
- 仓库已 clone，工作在 `v5/issue-134-agent-profile-config` 分支
- 小克已完成功能开发 + 单元测试 + 自测记录（Dev Ready）
- `~/.chorusgate/` 目录可创建测试 fixture（不触碰真实配置）

### 4.3 测试隔离

- 所有测试用例使用临时 `HOME` 环境变量（`HOME=/tmp/cg-test-home-XXX`）
- 每个用例结束后清理 `~/.chorusgate/` 下的 fixture
- 不使用真实 Slack token，所有 token 为 `xoxb-test-*` / `xapp-test-*` 格式

---

## 5. SIT 准入交付件检查清单

依据 spec §8，小克 Dev Ready 时必须提供：

- [ ] **Test strategy** — 本文档
- [ ] **Test cases + executable scripts** — `docs/tests/cases/` + `tests/issue134-*.test.ts`
- [ ] **Dev self-test record** — 小克的开发自测记录（commit message 或 PR description）
- [ ] **Change list** — 变更文件清单
- [ ] **Dev commit pushed** — 已 push 到 `v5/issue-134-agent-profile-config` 分支

**缺任一项，小马不开始 SIT。**

---

## 6. 测试用例明细

### 6.1 ST-CG134-001~005: 启动路径

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 001 | 默认 agent 启动 | `~/.chorusgate/default/.env` 存在，含合法 token；不传 `--agent` | 进程从 `default/.env` 加载，日志显示 `agent=default` | L3 |
| 002 | 显式 agent 启动 | `--agent codex`，`~/.chorusgate/codex/.env` 存在 | 从 `codex/.env` 加载，日志显示 `agent=codex` | L3 |
| 003 | 自定义 env file | `--env-file /abs/path/custom.env`，文件合法 | 从指定路径加载，不查找 `~/.chorusgate/` | L3 |
| 004 | `--agent` 与 `--env-file` 互斥 | 同时传两个参数 | 进程报错退出，错误码非 0，不加载任何配置 | L3 |
| 005 | 默认等价 | `chorusgate run` ≡ `chorusgate run --agent default` | 两者行为一致（加载同一文件） | L3 |

### 6.2 ST-CG134-006~010: 非法输入

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 006 | 非法 agent-id | `--agent Invalid_ID!`（大写+特殊字符） | 报错，不加载 | L3 |
| 007 | 路径穿越 | `--agent ../../../etc/passwd` | 报错，不加载，不读取目标文件 | L3 |
| 008 | 相对 env path | `--env-file relative/path.env` | 报错"必须是绝对路径"，不隐式按 cwd 解析 | L3 |
| 009 | 文件缺失 | `--agent codex`，但 `~/.chorusgate/codex/.env` 不存在 | fail closed，不回退项目 `.env` | L3 |
| 010 | 必需变量缺失 | `~/.chorusgate/default/.env` 缺 `SLACK_BOT_TOKEN` | 进程失败，错误信息含缺失变量名+文件路径 | L3 |

### 6.3 ST-CG134-011~013: 优先级与回归防护

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 011 | shell 覆盖 | 配置文件 `SLACK_BOT_TOKEN=xoxb-file`，shell `SLACK_BOT_TOKEN=xoxb-shell` | 进程使用 `xoxb-shell`（shell 优先） | L1 |
| 012 | MCP placeholder 修复 | `process.env.SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN}"`，配置文件有值 | placeholder 被替换为配置值 | L1 |
| 013 | 模块晚绑定 | `GATEWAY_REPLY_TIMEOUT_MS` 在模块顶层读取，shell 在 loadEnv 前设 | 进程使用 shell 值，不冻结默认值（回归 #127 修法 a4f05c1） | L2 |

### 6.4 ST-CG134-014~015: 身份隔离

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 014 | 同一 cwd 并行启动 | 两个进程，`--agent claude` 和 `--agent codex`，同一 cwd | 各自加载对应配置，Bot token / provider / prefix 不串线 | L3 |
| 015 | 配置来源日志 | 多 agent 并行 | 日志只显示 source 和 key 名，不显示 token value | L3 |

### 6.5 ST-CG134-016: 项目切换

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 016 | 切换 cwd 不改变身份 | 进程以 `--agent claude` 启动，cwd 从 proj-A 切到 proj-B | agent 身份不变，不读取 proj-B 的 `.env` | L3 |

### 6.6 ST-CG134-017~022: 迁移

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 017 | dry-run 默认 | `config migrate --agent codex --from /proj/.env`（无 `--apply`） | 输出预览，不写入文件，不删除源 | L3 |
| 018 | apply 写入 | 加 `--apply`，目标不存在 | 写入 `~/.chorusgate/codex/.env`，源文件保留 | L3 |
| 019 | 目标冲突 | 目标已存在，无 `--force` | 拒绝覆盖，报错，不修改目标 | L3 |
| 020 | force + backup | 目标已存在，加 `--force` | 覆盖前生成时间戳备份，再写入 | L3 |
| 021 | 源文件保留 | 迁移后检查源 `.env` | 内容不变，未删除 | L3 |
| 022 | 非 ChorusGate 键过滤 | 源 `.env` 含 `MY_PROJECT_VAR=foo` | 迁移预览标注"保留在原平台"，不写入 `~/.chorusgate/` | L3 |

### 6.7 ST-CG134-023~024: 跨平台路径

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 023 | POSIX 路径 | `HOME=/tmp/test-home`，`--agent codex` | 正确解析 `/tmp/test-home/.chorusgate/codex/.env` | L1 |
| 024 | Windows 路径 | `USERPROFILE=C:\Users\test`，`--agent codex` | 正确解析 `C:\Users\test\.chorusgate\codex\.env`（在 Windows 上执行） | L1 |

### 6.8 ST-CG134-025~026: 日志与错误

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 025 | 日志脱敏 | 配置含 `SLACK_BOT_TOKEN=xoxb-secret-123` | 日志只显示 `SLACK_BOT_TOKEN=***` 或 key 名，不显示 value | L1 |
| 026 | 错误可定位性 | 必需变量缺失 | 错误信息含文件路径 + 缺失变量名，可直接定位 | L3 |

### 6.9 ST-CG134-027~028: 迁移路径与文档

| ID | 场景 | 输入 | 预期 | 层级 |
|----|------|------|------|------|
| 027 | 现有用户迁移路径 | 项目 `.env` 存在，`~/.chorusgate/default/.env` 不存在 | 迁移命令引导用户，dry-run 显示将迁移的键 | L3 |
| 028 | 文档一致性 | `.env.example` / README / README_CN / CLI help | 文档描述与实际行为一致（人工核对） | L4 |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 小克尚未 Dev Ready，测试脚本无法运行 | 测试设计基于 spec，脚本先写好；Dev Ready 后立即执行 |
| Windows 路径测试需在 ainize-dev 执行 | 小马通过 `execute_code` subprocess 或请求小克协助 |
| 迁移测试可能触碰真实配置 | 全部使用临时 HOME，不触碰真实 `~/.chorusgate/` |
| 现有测试回归（profile-config / load-env 改动） | L2 集成测试包含现有全部测试，回归即失败 |

---

## 8. SIT 输出

SIT 完成后，小马交付：

1. **Execution log** — `npm run build` + `npm run test:integration` + CLI 烟测原始输出
2. **Test report** — `docs/tests/cases/2026-08-12-issue134-sit-xiaoma.md`，含 pass/fail 汇总表
3. **Archive** — 上述全部提交到 `docs/tests/cases/`
4. **通知** — SIT Ready 后通知小扣验收

---

## 9. 依赖与阻塞

- **依赖**: 小克 Dev Ready（功能代码 + 单元测试 + 自测记录 + 变更清单 + 已 push commit）
- **阻塞**: 小克未 Dev Ready 前，小马不开始 SIT 执行，但测试设计与脚本可并行完成
