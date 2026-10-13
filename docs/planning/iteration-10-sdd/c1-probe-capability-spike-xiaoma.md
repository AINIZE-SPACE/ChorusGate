# CG-I10-002 Capability Spike Record — C1 (opencode via acpx)

> Owner: 小马 (2026-10-13, zederer-mbe)。Operational input: B1 小龙落档 (12a240e)。
> Scope guard: 本记录是 isolated spike 产物（review-g1.md:10-14）——非 runtime integration、非 ADR 验收、未写 runtime 代码。

## 0. Selection criteria & selected candidate

- 唯一候选 C1（review-g1.md:10-14；g1-entry-runtime-candidates.md:11）：`opencode 经 acpx 总线`，对应主线 `Hermes Host+acpx`（V10-HRS-contracts-draft.md:6）。
- 生产侧背书：ma 侧 2026-09-13 起在用，三断言冒烟全绿（真实写盘验证 + 会话持久化 cache_read≈7.2k）；模型 newapi/kimi-k2.7-code（2026-09-22 MOA 决议）。
- 本探针补齐 G1 同一性条件要求的可执行证据（review-g1.md:16-21），全部在本机隔离探针区实测。

## 1. Adapter identity reconciliation — RESOLVED ✅

端到端实测链路：**Hermes Host（主控）→ acpx 0.13.1 → opencode-ai acp 适配器 1.18.23 → newapi/kimi-k2.7-code**。

可执行证据（events_t1.ndjson，181 帧 JSON-RPC 2.0 over stdio）：

- `initialize` → `session/resume` → `session/prompt`（id=2）→ 175 帧 `session/update` 流式通知 → 同 id 响应帧收尾，进程 exit 0。
- 工具调用帧 2 条（read / write），状态 pending→completed。
- 探针回执 `probe_receipt.txt`（宿主侧读回）：`runtime=opencode-via-acpx` + fixture 回读值正确。
- 结论：与主线文档 `Hermes Host+acpx` 为同一适配器身份，review-g1.md:16-21 条件闭环。

## 2. Supported API (observed)

- ACP wire: `initialize` / `session/resume` / `session/prompt` / `session/update`（流式通知）/ 同 id 响应帧收尾。
- acpx CLI 面: `prompt`（持久会话）/ `exec`（一次性）/ `sessions ensure·close·list` / `-s` 命名 / `--no-wait` 队列 / `cancel` / `set·set-mode`；`--format text|json|quiet`；权限 `--approve-all` / `--deny-all`。
- 退出码实测：0 成功 / 3 TIMEOUT / 4 NO_SESSION。

## 3. Isolation

- 探针区 `/opt/ainize/cg-i10-c1-probe`（非 git 目录，仓库外）；命名会话 `c1probe`（cwd 作用域隔离）。
- 数据仅 fixture（`fixture_input.txt` → `probe_receipt.txt`），无敏感数据；未触宿主 secrets / agents_memory / gbrain（B1 §1）。

## 4. Completion callback/poll behavior

- 回调式完成，无需轮询：`session/prompt` 发出后服务端推流 `session/update`，同 id 响应帧到达即完成（进程退出）。证据：events_t1.ndjson 末帧 id=2。
- 会话持久化实测：turn 2 零工具调用即可回述 turn 1 fixture 内容与写出文件名。

## 5. Limits (measured)

- `--timeout` 硬约束生效：2s → 结构化 TIMEOUT（acpxCode `TIMEOUT`，detailCode `QUEUE_RUNTIME_PROMPT_FAILED`），exit 3（events_t3.ndjson）。
- 会话作用域 = agent + cwd + name：未 `sessions ensure` 直接 prompt → NO_SESSION（exit 4）。
- 运营约束（B1 §1）：并发 ≤1；前台执行 ≤600s。
- 单轮 token 量级：~14–16k（input + cache_read + output，acpx 汇总）。

## 6. License & versions

- acpx 0.13.1；opencode-ai 1.18.23（本机）；npm dist-tags latest 1.19.0；license **MIT**（npm registry 实查）。
- 模型面：newapi `/v1/models` 共 7 个，kimi-k2.7-code 在列（opencode provider baseURL `/v1`）。

## 7. No-secret test setup

- API key 仅经外部 runner 环境变量注入（变量名不入仓，见 agents/ma executor-integration 契约）；取证全程未打印、未落盘任何密钥值。
- 探针仅 fixture 数据；B1 落档文件 no-secret 扫描 0 命中。
- 脱敏方法：本记录只含工具名 / 退出码 / 事件方法名 / 模型名 / 版本号等非敏感运行元数据；事件流原文（含 prompt 文本）不入仓，留探针目录。

## 8. Evidence（探针区，不入仓）

`/opt/ainize/cg-i10-c1-probe/`：events_t1.ndjson（181 帧）、events_t3.ndjson、probe_receipt.txt、fixture_input.txt、stderr_t*.log。

复跑示例：

```
acpx --cwd /opt/ainize/cg-i10-c1-probe opencode sessions ensure -s c1probe
acpx --cwd /opt/ainize/cg-i10-c1-probe --approve-all --format json \
  --model newapi/kimi-k2.7-code opencode -s c1probe prompt '<probe task>'
```

## 9. Spike verdict

- tasks.md:11 AC 全项落档：selection criteria + selected candidate → §0；supported API → §2；isolation → §3；completion callback/poll → §4；limits → §5；license/version → §6；no-secret setup → §7。
- review-g2.md:13 C-A（adapter-evidence 腿）由本记录闭环；review-g2.md 为评审快照不作改写，闭环事实以本记录为准。
- 下一步：小扣复核 G2 / ADR-0001；ADR-0001 据此可命名 runtime/adapter。
