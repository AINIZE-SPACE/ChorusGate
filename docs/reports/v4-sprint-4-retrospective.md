---
title: ChorusGate 迭代四回顾
author: Claude Code（小克）
date: 2026-06-21
audience: 项目团队
branch: v4/unified-stream
---

# ChorusGate 迭代四回顾

> **回顾日期**: 2026-06-21
> **分支**: `v4/unified-stream`
> **参与角色**: 小克（Claude Code 开发）、小马（Hermes 测试/评审）、小扣（Codex 管理）

---

## 一、迭代目标达成

迭代四核心目标：**技术债务清零 + M3 流式能力 + Codex 沙箱 + 持久事件 Store**。

| 目标 | 状态 | 备注 |
|------|------|------|
| P0 技术债务清零 | ✅ 完成 | #93 #94 #95 全部修复 |
| P1 Codex CLI Provider Bug | ✅ 完成 | #117 #118 #120 #121 |
| P1 测试基建 | ✅ 完成 | #96 拆分, #97 MCP mock |
| StreamUpdate 统一流式 | ✅ 完成 | #85 #86 Claude M3 + Codex 降级 |
| Codex 沙箱模式 | ✅ 完成 | #84 #99 Spike → 设计 → 编码 |
| DurableEventStore | ✅ 完成 | #1 持久事件状态 + 重试队列 |
| /stop 命令 | ✅ 完成 | #6 Slack 命令控制面 |
| Session Worktree | ❌ 未开始 | 延后到迭代五 |

---

## 二、关键数据

| 指标 | 数值 |
|------|------|
| Issues 关闭 | **28** |
| Commits | **30** |
| 新增/修改文件 | 30 files, +2231 / -389 |
| 测试基线 | **141/141 pass, 0 fail** |
| tsc | **零错误** |
| PR 评审 | 3 PRs, 0 P1 |
| 评审报告 | 3 份存档 |
| 设计文档 | 4 份 (`v4-spike-codex-approval.md`, `v4-story-6-stop-command.md` 等) |

---

## 三、做得好的

1. **P0 清零快** — #93 env const、#94 onSpawn、#95 find-up 三项 P0 在第一周集中修复，无延期
2. **Codex Bug 批量修复** — 5 个 P1 Codex CLI Provider bug（#117-#121）一次性修复+回归通过
3. **StreamUpdate 设计完整** — 11 种中立事件类型，Claude 高保真 + Codex 降级，gateway 统一消费
4. **Spike 先行验证** — #99 Codex 审批协议研究先行，确认 `--ask-for-approval` 不存在后及时转向沙箱方案
5. **DurableEventStore markdown 存储** — `memory/events.md` 可 cat 查看，调试方便
6. **测试基建升级** — `npm test` 拆三套（test/test:fast/test:integration），100s vs 旧 240s+ hang
7. **小马评审严谨** — 每个 PR 5 维评审 + SIT 全量跑，评审报告完整存档
8. **技能持续沉淀** — sprint-handoff v2→v2.1，SIT 交付件验收清单，评审通知规则

---

## 四、做得不好的

1. **/stop 命令跳设计环** — 功能太简单导致误判为 bug fix，越过了设计文档环节（事后补上）
2. **Session Worktree 未启动** — 原计划迭代四实现，被 feature 堆积挤掉
3. **评审通知格式问题** — 小马初期 DM @mention 失败（Hermes 不支持），thread 通知无推送，多次补发
4. **P2 tech debt 累积** — 3 个 PR 各 1 个 P2（测试覆盖/写法），均未在当前迭代修复

---

## 五、教训

| # | 教训 | 行动 |
|---|------|------|
| 1 | 功能再简单也要走设计环 → 代码环 → 评审环，不能跳过 | sprint-handoff 已固化流程 |
| 2 | `require()` 混用 ESM import 容易被 linter 遗漏 | 代码评审环节应显式检查 |
| 3 | Slack thread @mention 不会推送通知给未订阅成员 | 关键通知需发主频道或广播 |
| 4 | 评审完成后必须同时通知小克（结果）+ 小扣（合入），两者缺一不可 | 已写入 小马 memory |
| 5 | `setImmediate` debounce 有小概率丢写入窗口 | 对 gateway 场景影响有限，getReplayable 兜底 |

---

## 六、角色复盘

| 角色 | 主要职责 | 亮点 | 改进 |
|------|---------|------|------|
| **小克 (Claude Code)** | P0 修复、Codex bug、StreamUpdate、DurableEventStore、/stop、沙箱 | 功能开发速度快，全链路打通；Spike 先行验证，及时转向 | /stop 跳设计环需改正；P2 tech debt 应随修随关 |
| **小马 (Hermes)** | 测试基建、SIT 全量跑、3 PR 评审、评审报告存档 | 5 维评审体系化，SIT 每次全量跑；独立评估视角 | DM @mention 投递失败需改用 thread 或频道消息；评审通知规则已记录 |
| **小扣 (Codex)** | 流程协调、文档归档 | 合入前分支关系核验 | `.git` 写权限受限，无法直接 merge——需协调环境 |

---

## 七、技能演进

| 技能 | 版本 | 更新内容 |
|------|------|---------|
| `sprint-handoff` | v2 → v2.1 | M 设计评审第一性原因、SIT 交付件验收清单 |
| `chorusgate-code-review` | 新增 | 5 维评审 + 评审报告模板 |
| 评审通知规则 | 新增 (memory) | 评审完成后必须同时通知小克 + 小扣 |

---

## 八、遗留与展望

### 8.1 待合入

- `v4/unified-stream` → `dev`（可 fast-forward），待小扣推进

### 8.2 Tech Debt (P2 × 3)

| PR | P2 内容 |
|-----|---------|
| #1 | stop handler 无专项测试 |
| #84/#99 | 测试硬编码 flags 数组 → 应调用 `buildHeadlessFlags()` |
| #6 | `parseRow` text_snippet 含 `|` 边界情况 |

### 8.3 迭代五优先

- Session Worktree 隔离 (#33)
- 迭代四 P2 tech debt 清零
- 飞书/Lark 通道 (#7) 或 OpenClaw 适配 (#8)

---

*生成日期：2026-06-21*
*整理：Claude Code（小克）*
