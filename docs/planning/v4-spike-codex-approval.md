# Codex 统一审批 — Spike 研究 + 方案设计

> 状态: 🟢 设计评审通过 → 开发中 | Issue: #84, #99
> 评审人: 小马 (2026-06-21) — 方案B可行，补充沙箱边界，保持测试兼容
> 目标: 让 Codex 审批与 Claude 共享同一套 4-Button Approval UI
> 方法: Spike 实测 → 协议可行性 → 方案选择 → 设计输出
> 日期: 2026-06-21

---

## 1. 研究背景

Claude stream-json 模式已经完整实现了双向审批管道：`permission_request` 事件 → Slack 4-button → 用户点击 → stdin 写回 `permission_response` → Claude 继续。Codex 侧目前使用 `--dangerously-bypass-approvals-and-sandbox`，完全跳过审批。v4 目标是为 Codex 建立同等级别的安全控制。

## 2. Spike 实测结果

### 2.1 `--ask-for-approval` flag — 不存在

```
$ codex exec --ask-for-approval=on-request "echo hello"
error: unexpected argument '--ask-for-approval' found
```

**`--ask-for-approval` flag 在 Codex CLI v0.139.0+ 中不存在**。设计文档 `v4-story-8-unified-approval.md` 中的假设是错的。

### 2.2 Codex 安全控制面（实际可用）

```
--dangerously-bypass-approvals-and-sandbox   # 跳过所有审批 + 无沙箱（当前模式）
-s, --sandbox <MODE>                         # read-only | workspace-write | danger-full-access
--dangerously-bypass-hook-trust             # 跳过 hook 信任检查
```

### 2.3 代码层面现状

- `codex.ts:buildHeadlessFlags()` 返回 `["--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"]`
- 没有 `--sandbox` 参数
- stdin 只用于传 prompt，不保持打开双向通信
- Codex `--json` JSONL 是单向事件流（没有 `permission_request` 事件）

### 2.4 Claude 审批 vs Codex 审批：能力矩阵

| 维度 | Claude | Codex (实际) |
|------|--------|-------------|
| 审批协议 | stream-json `permission_request/response` | ❌ 不存在 |
| 工具级审批 | ✅ 粒度到单个 tool | ❌ 无此能力 |
| 沙箱 | 内置 | `-s workspace-write` |
| stdin 双向 | ✅ 保持打开读写 | ❌ prompt 写完即关 |
| 端到端审批延迟 | ≤ 1s（Slack → stdin） | N/A |

## 3. 方案分析

### 方案 A: 模拟审批——解析 Codex JSONL 拦截工具调用（不推荐）

gateway 解析 Codex JSONL 中的 `tool_use` 事件 → 发 Slack 审批按钮 → 用户点击后 **但无法中止 Codex 进程**（stdin 已关闭）。

**致命缺陷**: Codex 的 stdin 写完后立即 `end()`，无法写回审批指令。要中止只能 `SIGKILL`——这等于把审批降级为"批准 or kill"，没有"拒绝后继续对话"的能力。

### 方案 B: 沙箱升级——用 `-s workspace-write` 替代 bypass（推荐）

```
- --dangerously-bypass-approvals-and-sandbox
+ -s workspace-write
```

Codex 改为在沙箱中运行，shell 命令文件写入限制在 workspace 内。不是审批按钮，但提供了实质性安全提升。

**优势**:
- Codex CLI 原生支持，无需破坏性改造
- 沙箱能阻止 `rm -rf /`、写入系统路径等危险操作
- 可与 `--dangerously-bypass-hook-trust` 组合（hook 仍可审查）
- 实现成本极低（改一行 flag）

**劣势**:
- 用户看不到"审批"按钮（Codex 没有能力暴露）
- 沙箱不等于审批——无法针对单次工具调用决策

### 方案 C: 完全 bypass——保持现状，不做任何安全升级（不推荐）

保持 `--dangerously-bypass-approvals-and-sandbox`。技术上最简单但安全上最差。

## 4. 推荐方案：B（沙箱升级）

### 4.1 产品定位依据

迭代 4 核心定位："把现有 Slack + Claude/Codex 双 agent 做扎实，不盲目扩展"。Codex 是 Tier 2 runtime，产品层面**不追求与 Claude 功能等价**——Claude 提供审批交互，Codex 提供沙箱安全。这和 `v4-story-8-unified-streaming.md` 的哲学一致："Codex 降级实现，gateway 按可选存在消费"。

### 4.2 实现方案

```typescript
// codex.ts: buildHeadlessFlags()
function buildHeadlessFlags(): string[] {
  const mode = process.env.GATEWAY_CODEX_APPROVAL_MODE || "sandbox";
  const flags = ["--skip-git-repo-check"];
  if (mode === "bypass") {
    flags.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    // "sandbox" (default) — safer than bypass
    flags.push("-s", "workspace-write");
  }
  return flags;
}
```

### 4.2.1 沙箱边界说明

`-s workspace-write` 在 Codex CLI 中的限制：

| 操作 | workspace-write | bypass (旧) |
|------|----------------|-------------|
| 读/写项目目录 (cwd) | ✅ 允许 | ✅ 允许 |
| 读用户 home 目录 | ❌ 阻止 | ✅ 允许 |
| 写 `/etc` `/system` `/Windows` | ❌ 阻止 | ✅ 允许 |
| `rm -rf /` | ❌ 沙箱阻止 | ❌ 允许（危险）|
| 网络请求 (curl/fetch) | ✅ 允许 | ✅ 允许 |
| 写入 `/tmp` | ✅ 允许 | ✅ 允许 |
| 读非项目路径（如 `~/.ssh`） | ❌ 阻止 | ✅ 允许 |
| Git 操作 (push/pull) | ✅ 允许 (workspace内) | ✅ 允许 |

> Codex sandbox 基于文件系统路径白名单，workspace = cwd。工具调用超出 workspace 时 Codex 内核拒绝执行，不会到达 OS 层。

### 4.2.2 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GATEWAY_CODEX_APPROVAL_MODE` | `sandbox` = 沙箱模式 / `bypass` = 跳过审批 | `sandbox` |

### 4.3 安全对比

| 场景 | bypass (旧) | sandbox (新,推荐) |
|------|-----------|-------------------|
| 写项目文件 | ✅ 全磁盘可写 | ✅ 限于 workspace |
| 读系统文件 | ✅ 全磁盘可读 | ✅ 限于 workspace |
| `rm -rf /` | ❌ 允许 | ✅ 沙箱阻止 |
| 审批交互 | ❌ 无 | ❌ 无（CLI 不支持） |
| 适用环境 | 完全信任的内部沙箱 | 通用环境 |

### 4.4 验收标准

- [ ] `GATEWAY_CODEX_APPROVAL_MODE=sandbox` 时 spawn flags 包含 `-s workspace-write`
- [ ] `GATEWAY_CODEX_APPROVAL_MODE=bypass` 时保持原有 `--dangerously-bypass-approvals-and-sandbox`
- [ ] 默认值 `sandbox`（不改 env 就获得安全升级）
- [ ] `buildHeadlessFlags()` 注释更新——移除对不存在的 `--ask-for-approval` 的引用
- [ ] `docs/planning/v4-story-8-unified-approval.md` 更新为最终结论

## 5. 结论

**Codex 无法实现与 Claude 同等的交互式审批**——CLI 不支持。v4 中 Codex 安全方案从"审批"降级为"沙箱"：

| 维度 | v3 (Sprint 3) | v4 (迭代 4) |
|------|-------------|-----------|
| 模式 | `--dangerously-bypass-approvals-and-sandbox` | `-s workspace-write` |
| 安全 | 无 | 沙箱限制 workspace |
| 审批 | 无 | 无（CLI 不支持，**不是我们的 gap**） |

#99 (研究) → 本文即为研究产出，关闭时不需额外贴文档。
#84 (实现) → 实现沙箱方案，代码量 ~10 行。
