# 迭代四测试回归报告

> **日期**: 2026-06-18
> **测试员**: 小马 (M)
> **分支**: `v4/unified-stream` @ `1eebd2f`
> **套件**: `npm run test:integration`
> **跟踪**: #117 #118 #119 #120 #121 (小克 修复)

---

## 回归背景

2026-06-17 测试基线报告暴露 6 个新失败 (F1-F6), 已 issue 化为:

| F# | GitHub Issue | 修复内容 |
|----|--------------|----------|
| F2+F3 | #117 | codex `--json` flag 位置放错 (`exec --json` → `--json exec`) |
| F4 | #118 | Windows shell 转义产生空引号对 |
| F5 | #119 | CJK prompt 测试断言不准 (`spawnargs` vs `实际命令行`) |
| F6 | #120 | 缺少 CODEX_BIN 时报 timeout 而非 ENOENT |
| F1 | #121 | mock-claude fixture 未触发 `permission_request` |

小克 已于 2026-06-18 提交修复, 关闭上述 issues。

## 回归命令

```bash
npm run test:integration
```

实际执行: `node --import tsx --test --test-timeout=60000 --test-force-exit tests/*.test.ts`

## 回归结果

| 指标 | 值 |
|------|-----|
| 总用例数 | 135 |
| 通过 | 135 |
| 失败 | 0 |
| 取消 | 0 |
| 跳过 | 0 |
| 耗时 | 88.2s |
| 结果 | **全绿** ✅ |

## 关键验证

之前失败的 6 个用例现在全部通过:

- `claude-stream-integration: permission mode` (原 F1, #121)
- `ST-CX-001: --json before exec` (原 F2, #117)
- `ST-CX-002: resume --json position` (原 F3, #117)
- `ST-CX-003: Windows " escape` (原 F4, #118)
- `ST-CX-004: CJK prompt in args` (原 F5, #119)
- `ST-CX-006: ENOENT for missing CODEX_BIN` (原 F6, #120)

## 相关 Commit

- `4a3586d` fix(codex): correct --json position docs + Windows double-quote escaping (#117, #118)
- `cc89f8c` fix(test): codex integration tests — correct --json order + ENOENT resolve
- `0bb5113` docs(sprint-handoff): add review-gate — don't close issue before ST passes
- `1eebd2f` docs(skills): sprint-handoff v2.1 — add M 设计评审第一性原因

## 结论

- 迭代四 P1 #96 / #97 测试基线 + 后续 5 个 bug 修复回归 **通过**
- `npm test` 不再 hang, 全套 88-100s 稳定跑完
- 没有黑事件 (回归未失败)
- 后续: 按 sprint-handoff v2 通知小扣收尾

---

**附录**: sprint-handoff 测试回归规则

```
K 修完 → M 拉最新分支 → npm run test:integration →
  通过 → 关单/出报告/提交/通知小扣
  失败 → 打回K + docs/black-incidents/ + issue reopen + 入v4 retro
```
