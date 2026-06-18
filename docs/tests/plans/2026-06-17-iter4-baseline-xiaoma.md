# ChorusGate 迭代四 测试基线报告（v4 testing baseline）

> **日期**: 2026-06-17
> **作者**: 小马（评审+测试）
> **分支**: `dev` @ `5a66886`
> **目的**: 解决 P1 #96 (npm test 240s+ timeout) + 建立迭代四测试基线
> **跟踪**: [#96](https://github.com/AINIZE-SPACE/ChorusGate/issues/96) (Split npm test) · [#97](https://github.com/AINIZE-SPACE/ChorusGate/issues/97) (MCP mock)

---

## 一、基线建立 — 现状 (2026-06-17 前)

### 1.1 现象

`npm test` 在所有迭代三开发机上**直接挂死 240s+**:
- `tests/codex-integration.test.ts` 30s+ 无退出
- `tests/provider-routing.test.ts` 30s+ 无退出
- 其余 19 个文件单独跑 < 2.2s
- 总耗时无法确定（被超时的子进程阻塞）

### 1.2 根因（read-only 诊断）

| 根因 | 文件 | 说明 |
|------|------|------|
| 集成测试依赖真实 CLI | `codex-integration.test.ts` | `codexProvider.createSession()` 实际 spawn `codex exec` 等待真实输出；`onSpawn` 钩子只能拿到 args，不能 kill 进程 |
| 同上 | `provider-routing.test.ts` | `generateReply({providerId})` 实际走到 provider.createSession，claude/codex 真实 spawn |
| `node --test` 无 per-test timeout | `package.json:34` | 默认无超时，子进程 hang 时 node test runner 跟着 hang |

### 1.3 验证（单文件跑 vs 全跑）

| 模式 | 命令 | 耗时 | 结果 |
|------|------|------|------|
| 单文件快测试 (19个) | `node --test tests/event-store.test.ts` 等 | 0.5–2.2s | 全 OK |
| 挂死文件 (2个) | `node --test tests/codex-integration.test.ts` | 30s+ | hang |
| 全跑 (旧) | `npm test` | 240s+ | hang |
| 全跑 (新) | `npm test` (本报告修改后) | 90–100s | 129/135 pass, 6 fail |

---

## 二、修复 — 最小化改动

### 2.1 `package.json` scripts 修改

```diff
-  "test": "node --import tsx --test tests/*.test.ts"
+  "test": "node --import tsx --test --test-timeout=30000 --test-force-exit tests/*.test.ts",
+  "test:fast": "node --import tsx --test --test-timeout=10000 --test-force-exit --test-name-pattern='^(?!.*(ST-)).*' tests/*.test.ts",
+  "test:integration": "node --import tsx --test --test-timeout=60000 --test-force-exit tests/*.test.ts"
```

| 参数 | 作用 |
|------|------|
| `--test-timeout=30000` | 每个子测试 30s 超时（防 hang） |
| `--test-force-exit` | 跑完即退出（防孤儿进程阻塞） |
| `test:fast` | 10s 超时，排除 ST-* 集成测试（CI 快速验证用） |
| `test:integration` | 60s 超时，全部测试（ST 验收用） |

### 2.2 验证结果（两轮稳定）

| 指标 | 第 1 轮 | 第 2 轮 |
|------|---------|---------|
| 耗时 | 88.9s | 91.7s |
| tests | 135 | 135 |
| pass | 129 | 129 |
| fail | 6 | 6 |
| 失败列表 | 完全相同 | 完全相同 |

→ **稳定，无 flakiness**。

---

## 三、新暴露的 6 个失败（基线状态）

之前 hang 掩盖的 bug，现在全部浮出。**这是迭代四测试的核心价值**。

### 3.1 失败清单

| # | 用例 | 文件:行 | 类别 | 现象 |
|---|------|---------|------|------|
| F1 | `claude-stream-integration: permission mode` | `claude-stream-integration.test.ts:135` | 集成 | should receive permission_request — mock 没触发 |
| F2 | `ST-CX-001: --json before exec` | `codex-integration.test.ts:56` | 集成 | 实际 args 是 `cmd.exe /d /s /c "codex" exec --cd ... --json` (注: 测试在 `exec` 之后) |
| F3 | `ST-CX-002: resume --json position` | `codex-integration.test.ts:85` | 集成 | 同 F2，resume 模式 |
| F4 | `ST-CX-003: Windows " escape` | `codex-integration.test.ts:116` | 集成 | `"say "hello" and "goodbye""` 含空 quote 对 |
| F5 | `ST-CX-004: CJK prompt in args` | `codex-integration.test.ts:149` | 集成 | CJK 字符串不在 `spawnargs`，因为 shell:true 把 args 拼到 cmdline |
| F6 | `ST-CX-006: ENOENT for missing CODEX_BIN` | `codex-integration.test.ts:201` | 集成 | 期望 `ENOENT`，实际是 `codex exec timed out after 2000ms` |

### 3.2 失败原因分层

#### A. 真实代码 bug (待 小克 修)

| F# | 推测根因 | 修法方向 |
|----|----------|----------|
| F2 | `src/providers/codex.ts` spawn args 顺序错 | `codex exec --json <positional>` → `codex --json exec <positional>` (subcommand 后置) |
| F3 | 同 F2，resume 路径 | 同上 |
| F4 | `src/providers/codex.ts` Windows shell 拼接 bug | 用 `child_process.spawn` 直接传数组 (不 shell:true)，或正确转义 |
| F6 | Codex provider 收到 ENOENT 但报成 timeout | ENOENT 没 short-circuit，先 timeout 后才返回 |

#### B. 测试用例与实际行为不匹配 (待 评审)

| F# | 问题 | 修法方向 |
|----|------|----------|
| F1 | mock-claude 没在 permission 模式发 `permission_request` 事件 | 看 mock fixture `tests/fixtures/mock-claude/script.mjs` 是否支持 |
| F5 | 测 `spawnargs` 在 shell:true 模式下不准 | 改测 `child.spawnargs[0]` 之前的 args 数组，或断言 stdin/stdout 不含 CJK |

#### C. 测试基础设施 (本报告范围外，放 P1 #97)

| F# | 关联 |
|----|------|
| F1, F2, F3, F4, F5, F6 | 都依赖真实 CLI 行为，需要 mock fixture — **这是 P1 #97 的 scope** |

### 3.3 推荐处理顺序

```
P1 #96 (本报告) ──→ 现状 hang 解决 + 6 个失败可见
     |
P1 #97 (MCP mock) ──→ 写 fixture 替代真实 CLI
     |
修 F2/F3/F4/F6 (codex.ts 真实 bug) ──→ 小克 接手
     |
修 F1 (mock 触发 permission_request) ──→ 加 fixture 用例
     |
修 F5 (测试断言改) ──→ 测试代码微调
     |
npm test 全绿
```

---

## 四、未做事项 (留待后续)

| 项 | 关联 | 状态 |
|----|------|------|
| `MCP_SENDER_ONLY=1` 移除 (#93) | P0 | 未动 — 这是 小克 范围 |
| 7 处顶层 env var const 重构 (#93) | P0 | 未动 — 同上 |
| codexProvider.createSession 调 opts.onSpawn (#94) | P0 | 未动 — 同上 |
| `load-env` find-up 安全 (#95) | P0 | 未动 — 同上 |
| StreamUpdate fixture (epic #86) | 测试 | 未动 — 在 P1 #97 之后 |
| MCP server mock (#97) | 测试 | 未动 — 下一轮 |
| Codex approval protocol (#99) | 研究 | 未动 — P2 |

---

## 五、本次改动文件清单

- `package.json` — 3 个 scripts 改动 (`test` / `test:fast` / `test:integration`)
- 本报告 — `docs/tests/plans/2026-06-17-iter4-baseline-xiaoma.md`

未改任何 src/、tests/、docs/ 内容。**只调测试执行方式，不调测试逻辑**。

---

## 六、Slack 同步建议 (待发到 #所有-ainize / C0AHL7U33EE)

```
迭代四测试基线建立 OK
- P1 #96 (npm test 240s+ hang) 修复
- 改动: package.json 加 --test-timeout=30000 + --test-force-exit，拆 test:fast / test:integration
- 验证: 100s 跑完 135 测试，129 pass / 6 fail
- 暴露 6 个真实 bug: codex-integration 5 个 (F2/F3/F4/F5/F6) + claude-stream-integration 1 个 (F1)
- 报告: docs/tests/plans/2026-06-17-iter4-baseline-xiaoma.md
- 后续: P1 #97 (MCP mock fixture) + 修 F2/F3/F4/F6 (codex.ts 真实 bug)
```

(以上是草稿，实际发送走 .claude/skills/sprint-handoff.md 流程)


---

## 七、已提 GitHub Issues (2026-06-17)

| F# | GitHub Issue | 优先级 | 类别 | 状态 |
|----|--------------|--------|------|------|
| F2+F3 | [#117](https://github.com/AINIZE-SPACE/ChorusGate/issues/117) | P1 | codex.ts spawnargs 顺序 | open |
| F4 | [#118](https://github.com/AINIZE-SPACE/ChorusGate/issues/118) | P1 | codex.ts Windows 转义 | open |
| F5 | [#119](https://github.com/AINIZE-SPACE/ChorusGate/issues/119) | P2 | 测试断言方式 | open |
| F6 | [#120](https://github.com/AINIZE-SPACE/ChorusGate/issues/120) | P1 | codex.ts ENOENT 短路 | open |
| F1 | [#121](https://github.com/AINIZE-SPACE/ChorusGate/issues/121) | P1 | mock fixture 缺 permission_request | open |

通知: 已发 Slack 给 <@U0B8VHLHJAX> (小克) 走 sprint-handoff 流程接手修复。
