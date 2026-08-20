# SIT Report - Issue #134: 角色 ID 绑定与 ChorusGate 配置分离

> **Issue**: [#134](https://github.com/AINIZE-SPACE/ChorusGate/issues/134)
> **Defects Issue**: [#135](https://github.com/AINIZE-SPACE/ChorusGate/issues/135)
> **Branch**: `v5/issue-134-agent-profile-config`
> **Commit tested (initial SIT)**: `89225e3` (feat) + `7330373` (Dev Ready)
> **Commit tested (re-SIT 1)**: `e15a54d` (Defects 2-5 fixed)
> **Commit tested (re-SIT 2)**: `ba69b9d` (Defect 1 + Story C migration script)
> **Test Owner**: 小马
> **Date**: 2026-08-12 (initial SIT) + 2026-08-12 (re-SIT 1) + 2026-08-13 (re-SIT 2)
> **Verdict**: ✅ SIT PASSED - 9/9 PASS, all defects resolved

---

## 1. 执行环境

- **Machine**: zederer-mbe (Ubuntu 26.04)
- **Node**: v22.22.1
- **Repo**: `/opt/ainize/ChorusGate`, branch `v5/issue-134-agent-profile-config`
- **Note**: `codex` and `claude` CLI binaries are NOT installed on this machine

---

## 2. SIT 准入交付件检查

| 交付件 | 状态 | 来源 |
|--------|------|------|
| Test strategy | ✅ | `docs/tests/plans/PLAN-issue134-agent-config-2026-08-12-xiaoma.md` |
| Test cases + scripts | ✅ | `docs/tests/cases/2026-08-12-issue134-agent-config-xiaoma.md` + `tests/issue134-agent-config.test.ts` |
| Dev self-test record | ✅ | commit `89225e3` message (小克) |
| Change list | ✅ | 7 files: cli-args.ts, load-env.ts, bootstrap.ts, gateway.ts, gateway-control.ts, .env.example, cli-args.test.ts |
| Dev commit pushed | ✅ | `7330373` on remote |

**准入结果**: 全部 5 项齐备，准予开始 SIT。

---

## 3. 测试执行结果汇总

| 层级 | 范围 | 总数 | Pass | Fail | 结果 |
|------|------|------|------|------|------|
| L0 | TypeScript 类型检查 (`tsc --noEmit`) | 1 | 1 | 0 | ✅ PASS |
| L1 | 单元测试 (`issue134-agent-config.test.ts` + `cli-args.test.ts` + `profile-config.test.ts`) | 62 | 62 | 0 | ✅ PASS |
| L2 | 集成测试（全量 `tests/*.test.ts`） | 199 | 194 | 5 | ⚠️ 非回归 |
| L3 | CLI 烟测 | 10 | 2 | 8 | ❌ FAIL |
| **总计** | | **272** | **259** | **13** | ❌ |

---

## 4. L0 - TypeScript 类型检查

```
Command: npx tsc --noEmit
Result: exit code 0, zero errors
Verdict: ✅ PASS
```

---

## 5. L1 - 单元测试

```
Command: ./node_modules/.bin/tsx --test --test-timeout=30000 --test-force-exit \
  tests/issue134-agent-config.test.ts tests/cli-args.test.ts tests/profile-config.test.ts

Result: 62 tests, 62 pass, 0 fail
Duration: ~1.5s
Verdict: ✅ PASS
```

**覆盖范围**:
- ST-CG134-006/007: agent-id 格式校验 + 路径穿越 (contract tests on spec regex)
- ST-CG134-023/024: POSIX/Windows 路径解析
- ST-CG134-011: shell 环境变量覆盖优先级
- ST-CG134-025: 日志脱敏
- ST-CG134-022: 迁移键过滤
- ST-CG134-026: 错误信息可定位性 (contract test)
- ST-CG134-017~021: 迁移行为契约
- 小克的 cli-args 单元测试 (18 tests)
- 现有 profile-config 单元测试 (回归)

---

## 6. L2 - 集成测试

```
Command: ./node_modules/.bin/tsx --test --test-timeout=60000 --test-force-exit tests/*.test.ts
Result: 199 tests, 194 pass, 5 fail, 0 cancelled
Duration: ~26s
```

### 5 个失败的测试

| Test | File | Error | 原因 |
|------|------|-------|------|
| ST-CX-001 | codex-integration.test.ts | `Must include --json flag` | codex CLI 未安装 |
| ST-CX-002 | codex-integration.test.ts | `Must include --json flag` | codex CLI 未安装 |
| ST-CX-004 | codex-integration.test.ts | `Spawn should be attempted with CJK prompt` | codex CLI 未安装 |
| ST-CX-005 | codex-integration.test.ts | `MAX_ITERATIONS=1 should be in args` | codex CLI 未安装 |
| ST-PROV-003 | provider-routing.test.ts | `spawnargs should contain codex binary` | codex CLI 未安装 |

### 回归确认

在 commit `08ec778`（#134 实现前）执行相同测试，结果完全一致：5 fail / 7 pass。

**结论**: 5 个失败是**环境限制**（codex/claude CLI 不在此机器上），**不是 #134 引入的回归**。

---

## 7. L3 - CLI 烟测

```
Script: /tmp/sit_l3_issue134.sh
Result: 10 tests, 2 pass, 8 fail
```

### 测试结果明细

| ID | 场景 | 结果 | 失败原因 |
|----|------|------|----------|
| ST-CG134-001 | 默认 agent 启动 | ❌ FAIL | 无 `--agent` 时走 legacy 模式，不加载 `~/.chorusgate/default/.env` |
| ST-CG134-002 | 显式 agent 启动 | ❌ FAIL | 加载了配置但进程未退出（rc=0），脚本逻辑误判 |
| ST-CG134-003 | 自定义 env file | ❌ FAIL | 同上，加载了但 rc=0 |
| ST-CG134-006 | 非法 agent-id | ❌ FAIL | 无格式校验，`Invalid_ID!` 未被拒绝 |
| ST-CG134-007 | 路径穿越 | ❌ FAIL | 无校验，`../../../etc/passwd` 未被拒绝 |
| ST-CG134-009 | 文件缺失 fail closed | ❌ FAIL | 无 agent-id 时走 legacy，找不到文件后报 token 缺失而非文件缺失 |
| ST-CG134-010 | 必需变量缺失 | ❌ FAIL | 报错不含文件路径 |
| ST-CG134-025 | 日志脱敏 | ✅ PASS | - |
| ST-CG134-026 | 错误可定位性 | ❌ FAIL | 错误不含文件路径 |
| ST-CG134-016 | 项目切换身份稳定 | ✅ PASS | - |

---

## 8. 缺陷清单

详见 GitHub Issue [#135](https://github.com/AINIZE-SPACE/ChorusGate/issues/135)

| # | 优先级 | 缺陷 | Spec 违反 | 状态 |
|---|--------|------|-----------|------|
| 1 | P0 | `chorusgate run` 无参数时不加载 `~/.chorusgate/default/.env` | AC1, §2.1.5 | ✅ 已修复 (ba69b9d) |
| 2 | P0 | 缺少 agent-id 格式校验 | §4.2 | ✅ 已修复 (f7fd0f5) |
| 3 | P0 | `--env-file` 接受相对路径 | §4.2 | ✅ 已修复 (e15a54d) |
| 4 | P1 | `--agent` 与 `--env-file` 不互斥 | §4.1 | ✅ 已修复 (e15a54d) |
| 5 | P1 | 必需变量缺失错误不含文件路径 | §4.2 | ✅ 已修复 (f7fd0f5) |

---

## 9. 结论与下一步

### Initial SIT 结论: ❌ NOT PASSED (2026-08-12)

5 个缺陷，3 P0 + 2 P1。

### Re-SIT 1 结论: SIT BLOCKED (2026-08-12, after fix commits f7fd0f5 + e15a54d)

小克修复了 Defect 2-5，re-SIT 验证通过。Defect 1 仍未修复，ST-CG134-001 FAIL。

| 缺陷 | 修复状态 | Re-SIT 1 验证 |
|------|----------|-------------|
| Defect 2 agent-id 校验 | ✅ 已修复 (f7fd0f5) | ST-CG134-006 PASS |
| Defect 3 --env-file 绝对路径 | ✅ 已修复 (e15a54d) | ST-CG134-003 PASS |
| Defect 4 互斥校验 | ✅ 已修复 (e15a54d) | cli-args.test.ts 27 cases pass |
| Defect 5 错误含文件路径 | ✅ 已修复 (f7fd0f5) | ST-CG134-026 PASS |
| Defect 1 无参数加载 default | ❌ 未修复 | ST-CG134-001 FAIL - SIT BLOCKED |

### Re-SIT 1 测试结果

| 层级 | 结果 |
|------|------|
| L0 (tsc) | ✅ PASS (zero errors) |
| L1 (unit) | ✅ 87/87 PASS |
| L3 (CLI smoke) | ✅ 8/9 PASS |

### 缺陷 1 - 乐老板裁定: 选 A (符合 Spec)

`chorusgate run` 无参数时走 legacy 模式（加载 ~/.gateway/.env + project .env），不加载 ~/.chorusgate/default/.env。

- **Spec AC1 + §2.1.5** 要求：无参数 ≡ `--agent default`
- **裁定 (2026-08-12)**：选 A，改为默认加载 `~/.chorusgate/default/.env`。当前仅内部使用，无外部客户，可接受破坏向后兼容。
- **附加要求**：需迁移脚本，将当前配置（如 .env）迁移到指定 agent 下（agent 名称 + agent 平台，或通过 env 自动识别）

### Re-SIT 2 结论: ✅ SIT PASSED (2026-08-13, after fix commit ba69b9d)

乐老板裁定选 A 后，小克 push `ba69b9d` 修复 Defect 1 + 实现迁移脚本 (Story C)。

| 缺陷 | 修复状态 | Re-SIT 2 验证 |
|------|----------|-------------|
| Defect 1 无参数加载 default | ✅ 已修复 (ba69b9d) | ST-CG134-001 PASS |
| Story C 迁移脚本 | ✅ 已实现 (ba69b9d) | 见下方迁移脚本验证 |

### Re-SIT 2 测试结果

| 层级 | 结果 |
|------|------|
| L0 (tsc) | ✅ PASS (zero errors) |
| L1 (unit) | ✅ 64/64 PASS |
| L3 (CLI smoke) | ✅ 9/9 PASS |

### 迁移脚本验证 (Story C, commit ba69b9d)

`chorusgate config migrate --from <path> [--agent <id>] [--apply] [--force]`

| 验证项 | 结果 | 证据 |
|--------|------|------|
| dry-run 预览 | ✅ PASS | 4 key 迁移 + 2 key 保留，不写文件 |
| apply 写入 | ✅ PASS | 目标文件创建，4 key 正确写入 |
| 幂等保护 | ✅ PASS | 重复 apply 报错，提示用 --force |
| --force 覆盖+备份 | ✅ PASS | 创建 timestamped backup 后覆盖 |
| 源文件保留 | ✅ PASS | 源 .env 未修改 |
| auto-detect (GATEWAY_PROVIDER) | ✅ PASS | 正确识别 `claude` |
| auto-detect (CLAUDE_BIN) | ✅ PASS | 正确识别 `claude` |
| key 过滤 | ✅ PASS | ANTHROPIC_API_KEY 等非 CG key 留在源文件 |
| auto-detect 失败回退 | ✅ PASS (3f068cc) | 无 provider 标记时回退 `default`，提示用 `--agent` 覆盖 |

**auto-detect 失败行为说明**：

小克在 `ba69b9d` 中实现 auto-detect 失败时抛错，在 thread 中说"回退 default"。`3f068cc` 修复了行为差异，现在无 provider 标记时回退 `default` 并提示用户可用 `--agent <id>` 覆盖。行为与声明一致。

### 下一步

1. ~~乐老板决定缺陷 1 的处理方式~~ -> 已裁定：选 A
2. ~~小克实现修复：无参数时默认加载 `~/.chorusgate/default/.env`~~ -> ✅ 已修复 (ba69b9d)
3. ~~小克实现迁移脚本~~ -> ✅ 已实现 (ba69b9d)
4. ~~re-SIT 验证 ST-CG134-001 通过~~ -> ✅ 9/9 PASS
5. **通知小扣验收**

### 未覆盖项（需后续补充）

| 用例 | 原因 | 补充计划 |
|------|------|----------|
| ST-CG134-012 (MCP placeholder) | 需要实际 MCP 配置注入 | 后续迭代补充 |
| ST-CG134-013 (模块晚绑定) | 需要 gateway 实际启动 | 后续迭代验证 |
| ST-CG134-014 (并行启动隔离) | 需要 Slack 连接 | 在有 Slack token 的环境验证 |
| ST-CG134-017~022 (迁移) | ✅ 已在 re-SIT 2 中验证 | Story C 已交付 |
| ST-CG134-024 (Windows 路径) | 需 Windows 机器 | 在 ainize-dev 上执行 |
| ST-CG134-028 (文档一致性) | 需人工核对 | 验收前补充 |

**注**: 迁移命令 (`config migrate`) 已在 `ba69b9d` 中实现并验证通过。
