# 测试用例 - Issue #134: 角色 ID 绑定与 ChorusGate 配置分离

> **Test Plan**: `docs/tests/plans/PLAN-issue134-agent-config-2026-08-12-xiaoma.md`
> **Issue**: [#134](https://github.com/AINIZE-SPACE/ChorusGate/issues/134)
> **Test Owner**: 小马
> **Date**: 2026-08-12
> **Status**: 用例设计完成，待 SIT 执行时填充 Actual Result

---

## 用例汇总表

| ID | 场景 | 优先级 | 层级 | 状态 |
|----|------|--------|------|------|
| ST-CG134-001 | 默认 agent 启动 | P0 | L3 | ⏳ 待执行 |
| ST-CG134-002 | 显式 agent 启动 | P0 | L3 | ⏳ 待执行 |
| ST-CG134-003 | 自定义 env file | P1 | L3 | ⏳ 待执行 |
| ST-CG134-004 | --agent 与 --env-file 互斥 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-005 | 默认等价 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-006 | 非法 agent-id | P0 | L3 | ⏳ 待执行 |
| ST-CG134-007 | 路径穿越 | P0 | L3 | ⏳ 待执行 |
| ST-CG134-008 | 相对 env path | P1 | L3 | ⏳ 待执行 |
| ST-CG134-009 | 文件缺失 fail closed | P0 | L3 | ⏳ 待执行 |
| ST-CG134-010 | 必需变量缺失 | P0 | L3 | ⏳ 待执行 |
| ST-CG134-011 | shell 覆盖 | P1 | L1 | ⏳ 待执行 |
| ST-CG134-012 | MCP placeholder 修复 | P1 | L1 | ⏳ 待执行 |
| ST-CG134-013 | 模块晚绑定回归 | P1 | L2 | ⏳ 待执行 |
| ST-CG134-014 | 同一 cwd 并行启动隔离 | P0 | L3 | ⏳ 待执行 |
| ST-CG134-015 | 配置来源日志 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-016 | 项目切换身份稳定 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-017 | dry-run 默认 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-018 | apply 写入 | P0 | L3 | ⏳ 待执行 |
| ST-CG134-019 | 目标冲突 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-020 | force + backup | P1 | L3 | ⏳ 待执行 |
| ST-CG134-021 | 源文件保留 | P0 | L3 | ⏳ 待执行 |
| ST-CG134-022 | 非 ChorusGate 键过滤 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-023 | POSIX 路径 | P1 | L1 | ⏳ 待执行 |
| ST-CG134-024 | Windows 路径 | P1 | L1 | ⏳ 待执行 |
| ST-CG134-025 | 日志脱敏 | P0 | L1 | ⏳ 待执行 |
| ST-CG134-026 | 错误可定位性 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-027 | 现有用户迁移路径 | P1 | L3 | ⏳ 待执行 |
| ST-CG134-028 | 文档一致性 | P1 | L4 | ⏳ 待执行 |

---

## 用例详情

### ST-CG134-001: 默认 agent 启动

- **Spec AC**: AC1 - `chorusgate run` 从 `~/.chorusgate/default/.env` 启动
- **前置**: `~/.chorusgate/default/.env` 存在，含合法 `SLACK_BOT_TOKEN=xoxb-test-001` 和 `SLACK_APP_TOKEN=xapp-test-001`
- **步骤**:
  1. 执行 `chorusgate run`（不传 `--agent`）
  2. 观察日志和进程行为
- **预期**: 进程从 `~/.chorusgate/default/.env` 加载配置，日志显示 `agent=default`、配置来源路径，不读取项目根 `.env`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-002: 显式 agent 启动

- **Spec AC**: AC2 - `chorusgate run --agent codex` 只选择 `~/.chorusgate/codex/.env`
- **前置**: `~/.chorusgate/codex/.env` 存在，含 codex profile 的 token
- **步骤**:
  1. 执行 `chorusgate run --agent codex`
  2. 观察日志
- **预期**: 进程从 `~/.chorusgate/codex/.env` 加载，日志显示 `agent=codex`，不读取 `default/.env`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-003: 自定义 env file

- **Spec AC**: AC1 变体 - 高级场景
- **前置**: `/tmp/cg-test/custom.env` 存在，含合法配置
- **步骤**:
  1. 执行 `chorusgate run --env-file /tmp/cg-test/custom.env`
  2. 观察日志
- **预期**: 从指定绝对路径加载，不查找 `~/.chorusgate/`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-004: --agent 与 --env-file 互斥

- **Spec AC**: spec §4.1 - 互斥，避免来源不确定
- **步骤**:
  1. 执行 `chorusgate run --agent codex --env-file /tmp/custom.env`
  2. 观察退出码
- **预期**: 进程报错退出（非 0），错误信息说明两者互斥，不加载任何配置
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-005: 默认等价

- **Spec AC**: AC1 - `chorusgate run` ≡ `chorusgate run --agent default`
- **步骤**:
  1. 先执行 `chorusgate run`，记录加载的配置
  2. 再执行 `chorusgate run --agent default`，记录加载的配置
  3. 对比两者
- **预期**: 两者加载同一文件（`~/.chorusgate/default/.env`），行为一致
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-006: 非法 agent-id

- **Spec AC**: AC5 - spec §4.2 `agent-id` 必须匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`
- **测试数据**: `Invalid_ID!`（大写+特殊字符）、`测试`（CJK）、空字符串
- **步骤**:
  1. 执行 `chorusgate run --agent Invalid_ID!`
  2. 观察退出码和错误信息
- **预期**: 报错退出（非 0），错误信息说明 agent-id 格式非法，不加载配置
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-007: 路径穿越

- **Spec AC**: AC5 - 禁止路径穿越
- **测试数据**: `--agent ../../../etc/passwd`、`--agent ..%2F..%2Fetc`
- **步骤**:
  1. 执行 `chorusgate run --agent ../../../etc/passwd`
  2. 观察退出码
- **预期**: 报错退出，不读取 `/etc/passwd` 或任何穿越路径文件
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-008: 相对 env path

- **Spec AC**: AC5 - spec §4.2 相对路径报错
- **步骤**:
  1. 执行 `chorusgate run --env-file relative/path.env`
  2. 观察错误信息
- **预期**: 报错"必须是绝对路径"，不隐式按 cwd 解析
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-009: 文件缺失 fail closed

- **Spec AC**: AC5 - 显式配置不存在时 fail closed，不回退项目 `.env`
- **前置**: `~/.chorusgate/codex/.env` 不存在；项目根 `.env` 存在（含合法配置）
- **步骤**:
  1. 执行 `chorusgate run --agent codex`
  2. 观察进程是否读取项目 `.env`
- **预期**: 进程失败退出，不回退读取项目根 `.env`，错误信息说明文件不存在
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-010: 必需变量缺失

- **Spec AC**: AC5 - spec §4.2 缺少启动必需项时进程失败
- **前置**: `~/.chorusgate/default/.env` 存在但缺 `SLACK_BOT_TOKEN`
- **步骤**:
  1. 执行 `chorusgate run`
  2. 观察错误信息
- **预期**: 进程失败，错误信息含文件路径 + 缺失变量名 `SLACK_BOT_TOKEN`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-011: shell 覆盖

- **Spec AC**: AC6 - shell 环境变量覆盖配置文件
- **前置**: 配置文件 `SLACK_BOT_TOKEN=xoxb-file-value`；shell `SLACK_BOT_TOKEN=xoxb-shell-value`
- **步骤**:
  1. 设置 shell 环境变量后执行 `chorusgate run`
  2. 检查进程使用的 token
- **预期**: 进程使用 `xoxb-shell-value`（shell 优先）
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-012: MCP placeholder 修复

- **Spec AC**: AC6 - 保持 MCP placeholder 修复行为
- **前置**: `process.env.SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN}"`；配置文件有真实值
- **步骤**:
  1. 模拟 MCP 注入 placeholder
  2. 执行 `chorusgate run`
  3. 检查 placeholder 是否被替换
- **预期**: placeholder 被替换为配置文件值
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-013: 模块晚绑定回归

- **Spec AC**: AC6 - 防止环境变量冻结回归（spec §6 Story B）
- **关联**: commit a4f05c1（#127 修法）、reply-engine.ts:51 注释
- **步骤**:
  1. 在 `loadEnv()` 之前设置 shell `GATEWAY_REPLY_TIMEOUT_MS=999999`
  2. 执行 `chorusgate run`
  3. 检查进程使用的超时值
- **预期**: 进程使用 999999，不冻结为默认值 180000
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-014: 同一 cwd 并行启动隔离

- **Spec AC**: AC3 - 同一项目目录分别启动 claude/codex 时，Bot token / provider / cwd / prefix 不串线
- **前置**: `~/.chorusgate/claude/.env` 和 `~/.chorusgate/codex/.env` 均存在，token 不同
- **步骤**:
  1. 在同一 cwd 下启动两个进程：`--agent claude` 和 `--agent codex`
  2. 对比两者的 Bot token / provider / prefix
- **预期**: 两个进程各自加载对应配置，不串线
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-015: 配置来源日志

- **Spec AC**: AC6 - 日志只显示配置来源和变量名，不显示 token/value
- **步骤**:
  1. 执行 `chorusgate run --agent codex`
  2. 捕获 stderr 日志
  3. 搜索 token value
- **预期**: 日志显示来源路径和 key 名，不出现 `xoxb-` / `xapp-` 后的真实值
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-016: 项目切换身份稳定

- **Spec AC**: AC4 - 切换 cwd/项目不会改变已选 agent 身份
- **步骤**:
  1. 在 proj-A 目录执行 `chorusgate run --agent claude`，记录身份
  2. 切换到 proj-B 目录执行 `chorusgate run --agent claude`，记录身份
  3. 对比
- **预期**: 两次身份一致，不读取 proj-B 的 `.env`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-017: dry-run 默认

- **Spec AC**: AC7 - 迁移默认 dry-run
- **前置**: 源 `.env` 存在含 ChorusGate 键；目标 `~/.chorusgate/codex/.env` 不存在
- **步骤**:
  1. 执行 `chorusgate config migrate --agent codex --from /proj/.env`（无 `--apply`）
  2. 检查目标是否被创建
- **预期**: 输出 dry-run 预览，不写入文件，源文件不变
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-018: apply 写入

- **Spec AC**: AC7 - `--apply` 才写入
- **前置**: 同 017
- **步骤**:
  1. 执行 `chorusgate config migrate --agent codex --from /proj/.env --apply`
  2. 检查目标文件和源文件
- **预期**: 写入 `~/.chorusgate/codex/.env`，源文件保留不删除
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-019: 目标冲突

- **Spec AC**: AC7 - 冲突时不覆盖
- **前置**: 目标 `~/.chorusgate/codex/.env` 已存在
- **步骤**:
  1. 执行 `chorusgate config migrate --agent codex --from /proj/.env --apply`（无 `--force`）
  2. 检查目标内容
- **预期**: 拒绝覆盖，报错，目标内容不变
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-020: force + backup

- **Spec AC**: AC7 - `--force` 前有备份
- **前置**: 目标已存在
- **步骤**:
  1. 执行 `chorusgate config migrate --agent codex --from /proj/.env --apply --force`
  2. 检查备份文件和时间戳
- **预期**: 覆盖前生成时间戳备份（如 `.env.bak.20260812-HHMMSS`），再写入新内容
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-021: 源文件保留

- **Spec AC**: AC7 - 不删除源文件
- **步骤**:
  1. 执行迁移（apply + force）
  2. 检查源 `.env` 内容
- **预期**: 源文件内容不变，未删除
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-022: 非 ChorusGate 键过滤

- **Spec AC**: AC8 - 非 ChorusGate 键不迁入
- **前置**: 源 `.env` 含 `MY_PROJECT_VAR=foo` 和 ChorusGate 键
- **步骤**:
  1. 执行 dry-run 迁移
  2. 检查预览输出
- **预期**: `MY_PROJECT_VAR` 标注"保留在原平台/项目"，不写入 `~/.chorusgate/`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-023: POSIX 路径

- **Spec AC**: AC9 - spec §6 Story C 使用 Node 标准库
- **步骤**:
  1. 在 Linux 上设置 `HOME=/tmp/cg-test-home`
  2. 执行 `chorusgate run --agent codex`
  3. 检查解析路径
- **预期**: 正确解析 `/tmp/cg-test-home/.chorusgate/codex/.env`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-024: Windows 路径

- **Spec AC**: AC9
- **步骤**:
  1. 在 Windows 上设置 `USERPROFILE=C:\Users\test`
  2. 执行 `chorusgate run --agent codex`
  3. 检查解析路径
- **预期**: 正确解析 `C:\Users\test\.chorusgate\codex\.env`
- **Actual**: ⏳
- **Verdict**: ⏳
- **注**: 在 ainize-dev (Windows 11) 上执行

### ST-CG134-025: 日志脱敏

- **Spec AC**: AC6 - spec §4.2 日志只显示配置来源和变量名，不显示 token/value
- **步骤**:
  1. 配置含 `SLACK_BOT_TOKEN=xoxb-secret-123`
  2. 执行 `chorusgate run`
  3. 捕获日志，搜索 `xoxb-secret-123`
- **预期**: 日志不出现 `xoxb-secret-123`，只显示 `***` 或 key 名
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-026: 错误可定位性

- **Spec AC**: spec §4.2 - 给出文件路径与缺失变量
- **步骤**:
  1. 配置缺 `SLACK_BOT_TOKEN`
  2. 执行 `chorusgate run`
  3. 检查错误信息
- **预期**: 错误信息含文件路径（如 `~/.chorusgate/default/.env`）和缺失变量名 `SLACK_BOT_TOKEN`
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-027: 现有用户迁移路径

- **Spec AC**: AC10 - 现有 default 单实例用户有清晰迁移路径
- **前置**: 项目 `.env` 存在，`~/.chorusgate/default/.env` 不存在
- **步骤**:
  1. 执行 `chorusgate config migrate --agent default --from /proj/.env`
  2. 检查输出
- **预期**: dry-run 显示将迁移的键、目标路径、后续启动命令
- **Actual**: ⏳
- **Verdict**: ⏳

### ST-CG134-028: 文档一致性

- **Spec AC**: AC9 - `.env.example` / README / README_CN / CLI help 与实际行为一致
- **步骤**:
  1. 人工核对 `.env.example` 配置项
  2. 核对 README / README_CN 中 `~/.chorusgate/` 的描述
  3. 执行 `chorusgate run --help`，核对 CLI help
- **预期**: 三处文档描述一致，与实际行为一致
- **Actual**: ⏳
- **Verdict**: ⏳

---

## SIT 执行结果汇总（待填充）

| 统计项 | 值 |
|--------|-----|
| 总用例数 | 28 |
| Pass | ⏳ |
| Fail | ⏳ |
| Blocked | ⏳ |
| 执行日期 | ⏳ |
| 执行人 | 小马 |
