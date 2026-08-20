# #141 日志滚动与 `chorusgate log --agent` — SIT 测试报告（预验证）

- **测试人**: 小马 (M)
- **日期**: 2026-08-19
- **分支/SHA**: `v5/logging-liveness` @ `1849fad`
- **PR**: #143（11 文件 / +1186 行，3 commits）
- **模式**: PRE-VERIFICATION（按 2026-08-15 规则：评审/SIT 并行，不等正式 Dev Ready；小扣 评审进行中）
- **环境**: Linux zederer-mbe (Ubuntu 26.04), Node v22.22.1, codex/claude CLI 未安装

## 测试范围（对应 docs/specs/issue-logging-rotation-log-command.md）

| # | 用例 | 层 | 结果 |
|---|------|----|------|
| 1 | L0 TypeScript 类型检查（全仓） | L0 | ✅ 0 错误 |
| 2 | logger 单元测试（自旋日志：大小+跨天旋转、prune .old、fail-closed） | L1 | ✅ 14/14 |
| 3 | log-command + cli-args 单元测试（`log --agent [--lines] [--follow]`） | L1 | ✅ 47/47（合计 61/61） |
| 4 | 全量回归（42 套件） | L1 | ✅ 321/325 pass |
| 5 | 新增代码跨路径审查（未触碰 provider spawn/共享接口） | 人工 | ✅ CC+Codex 双路径不受影响 |

## #141 定向验证（61/61 = logger 14 + log-command/cli-args 47）

```
# tests 61
# pass 61
# fail 0
# cancelled 0
# duration_ms 1011
```

与开发自测数字一致（61/61）。

## 全量回归（42 suites / 325 tests）

```
# tests 325
# suites 42
# pass 321
# fail 4
# cancelled 0
```

**4 个失败均为已知环境失败，非回归**：

| Test | 类别 | 说明 |
|------|------|------|
| ST-CX-001 | codex-integration | codex CLI 未安装（本机 Linux 无 codex 二进制） |
| ST-CX-002 | codex-integration | 同上 |
| ST-CX-004 | codex-integration | 同上 |
| ST-CS-005 → ST-CX-005 | codex-integration | 同上 |

该 4 例在 2026-08-15 #135 Re-SIT 基线（680dcea）上同样失败，属预存环境问题；
2026-08-15 HEAD 498359f 上同为 4 失败。失败集合未扩大。

## 结论

**✅ PASSED（预验证）** — L0/L1 全绿（除已知 4 例 codex 环境失败，非回归）。

待小扣评审通过、PR 合并后，本报告自动转为正式 SIT 结论（SHA `1849fad` 即合并内容）。
若评审引入新 commits，将按增量重跑受影响层。

## 环境注意事项（Windows 侧）

小克 提示的 `NODE_TEST_CONTEXT=child-v8` 机器级环境变量问题仅影响 Windows（ainize-dev）。
本机 Linux 无此变量（验证为空），不受影响。
