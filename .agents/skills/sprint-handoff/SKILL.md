---
name: sprint-handoff
description: Sprint 开发完成交接 — Issue 驱动 → commit → 频道通知 → 评审 → 测试 → done
---

# 技能: Sprint 开发完成交接

> 代码写完不是终点。Issue 驱动，状态流转，频道通知，四步缺一不可。
> 具体 ID 值从 memory `[[project-team-channels]]` 读取。

## 统一流程

> 基于 [REPORT-v3-2026-06-16-executive.md §10.2](../../../docs/reports/REPORT-v3-2026-06-16-executive.md) 流程图。

```mermaid
flowchart LR
    classDef actor     fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1
    classDef system    fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#bf360c
    classDef database  fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#4a148c
    classDef decision  fill:#fffde7,stroke:#f9a825,stroke-width:2px,color:#e65100
    classDef process   fill:#ffffff,stroke:#424242,stroke-width:1px,color:#212121
    classDef async     fill:#e0f7fa,stroke:#00838f,stroke-width:2px,color:#006064,stroke-dasharray:5 5

    style 设计规划环 fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style 开发环 fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style 测试验证环 fill:#fffde7,stroke:#f9a825,stroke-width:2px
    style 集成发布环 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    Z(["🛡️ Z / delez / Zederer<br>目标下发 & 设计验收 & 最终验收"]):::actor
    K("🤖 K / 小克 / Claude Code<br>开发"):::system
    M("🤖 M / 小马 / Hermes<br>测试"):::system
    C("🤖 C / 小查 / 小扣 / Codex<br>管理整合"):::system
    S[("📢 Slack 迭代协作频道")]:::database
    DM[("💬 Slack DM<br>Z → K")]:::database
    Git[("🗄️ GitHub Repo")]:::database

    Z -->|下发任务 goal| DM
    DM --> K

    subgraph 设计规划环
        direction TB
        D1["➡️ 调研需求、分析产品方案"]:::process --> D2["➡️ 输出产品方案"]:::process
        D2 --> D3["➡️ M 评审产品方案"]:::process
        D3 --> D4["➡️ C 拆分 GitHub issues<br>feature / epic"]:::process
        D4 --> D5{"❓ Z 设计验收通过?"}:::decision
        D5 -->|驳回修改| D1
    end

    K --> D1
    D5 -->|通过| N1[/📣 Slack 通知消息<br>进入开发环/]:::async
    N1 -.-> S

    subgraph 开发环
        direction TB
        P1["➡️ 认领 issue / 编写 spec"]:::process --> P2["➡️ 代码实现 + 单元测试"]:::process
        P2 --> P3["➡️ 推送功能分支 + PR 草稿"]:::process
    end

    N1 --> P1
    P3 --> P4

    subgraph 测试验证环
        direction TB
        P4["➡️ M 代码评审 + 系统测试"]:::process --> P5{"❓ 需求测试通过?"}:::decision
        P5 -->|不通过| P6["➡️ 提 bug / K 修复"]:::process
        P6 --> P4
        P5 -->|通过| P7["➡️ 创建合并 PR"]:::process
    end

    P7 --> P8

    subgraph 集成发布环
        direction TB
        P8{"❓ 发布评审通过?"}:::decision -->|驳回修改| P1
        P8 -->|验收通过| N2[/📣 Slack 通知消息<br>开发完成待发布/]:::async
        N2 --> R1["➡️ 合并发布 + 回顾总结"]:::process
        R1 --> R2["➡️ 文档整理归档"]:::process
        R2 --> R3["➡️ PR 合入 main 分支发布"]:::process
    end

    N2 -.-> S
    D4 -.->|创建 issues| Git
    P1 -.->|拉取 issue| Git
    P7 -.->|提交 PR| Git
    R3 -.->|合并 PR| Git
```

### 设计规划环

1. **Z 下发目标**：通过 Slack DM 向 K 下发本次迭代 `goal`。
2. **K 调研设计**：调研需求、分析产品方案并输出。
3. **M 评审**：K 完成后在 Slack 频道 `@M` 提请评审。
4. **C 规划落地**：M 通过后 `@C` 将目标拆分为可落地的 GitHub issues（feature / epic）。
5. **Z 验收**：C 汇总 issue 规划并 `@Z` 验收。
6. **判断结束节点**：若 Z 驳回，回到第 2 步继续循环；若验收通过，由独立 Slack 通知节点宣布进入开发环。

### 开发环

1. **K 认领需求**：从 GitHub issues 认领需求，编写 spec 技术方案与开发计划。
2. **开发与自测**：完成代码实现、单元测试与自测。
3. **提交 PR 草稿**：推送功能分支并创建 PR 草稿。
4. 完成后由 Slack 通知节点驱动进入测试验证环。

### 测试验证环

1. **M 代码评审**：对 PR 草稿进行代码评审，确保需求 / 方案 / 代码三者对齐。
2. **系统测试**：制定并执行集成/系统测试方案、用例与脚本，持续提 bug 并驱动 K 修复。
3. **判断结束节点**：若测试不通过，回到代码评审/修复；若通过，创建并提交合并 PR。
4. **发布评审**：C / M 评审发布特性 PR。若驳回，回到开发环重新开发；若验收通过，由 Slack 通知节点宣布进入集成发布环。

### 集成发布环

1. **用户验收与回顾**：全部需求开发测试完成后，Z 在频道发起用户验收与迭代回顾。
2. **整理报告**：各方在频道补充回顾内容；C 整理并输出产品迭代报告。
3. **合入 main**：C 将迭代报告与最终代码通过 PR 合并到 `main` 分支，并在频道通知完成发布。

### 版本优化（v4 目标）

1. **需求管理跟踪移至 Trello**：迭代目标与需求看板统一迁移到 Trello 管理；GitHub issues 继续承担 bug 跟踪。升级技能让 bot 在 Trello 卡片与 GitHub issue 之间同步状态。
2. **多需求 / BUG 并行**：依托 git tree，设计环与开发环的子环可多环并行。不同 feature / epic 在独立分支上同时推进，频道消息按需求上下文区分，避免串线。
3. **Slack stream 输出 + approve / reject**：补齐 agent 流式输出到 Slack 频道的实时渲染；在关键节点（设计验收、测试通过、发布评审）支持 approve / reject 按钮，点击后自动驱动流程进入下一节点或打回重做。

## Issue 类型与状态流转

| 类型 | 粒度 | 生命周期 |
|------|------|---------|
| epic | 大（多 sprint） | backlog → in_progress → done |
| feature | 中（系统级） | proposed → approved → in_progress → in_review → done |
| story | 中（≤ 3 天） | backlog → in_progress → in_review → done |
| task | 小（≤ 1 天） | todo → in_progress → done |
| bug | 不定 | open → in_progress → fixed → verified → closed |

## 通知模板

```
<@{TESTER}> <@{REVIEWER}> {PROJECT} — {TYPE} #{N}: {标题} 开发完成，请验收。

*变更*
• {要点1}
• {要点2}

*测试*
• {N}/{N} 测试通过 | typecheck 零错误
*分支*: {branch} (已 push)

Refs: #{N}
```

## 变量参考

所有变量值从 memory `[[project-team-channels]]` 读取：

| 变量 | 说明 |
|------|------|
| `{CHANNEL_NAME}` | 开发频道名 |
| `{CHANNEL_ID}` | 开发频道 ID |
| `{TESTER}` | 测试负责人 Slack ID |
| `{REVIEWER}` | 评审负责人 Slack ID |

## Slack 通知规范

- `<@USER_ID>` 格式，放消息首行
- `chat.postMessage`: `link_names: true`
- mention 在顶层 `text`，不在 blocks

## Quality Bar

- [ ] Issue 存在且状态正确
- [ ] `git push` 到远程
- [ ] Slack 频道通知（非 DM），mention 置首行
- [ ] GitHub Issue comment 更新状态
- [ ] 关键决策记录到 project memory



