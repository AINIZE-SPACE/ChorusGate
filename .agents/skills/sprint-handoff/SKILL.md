---
name: sprint-handoff
description: Sprint 开发完成交接 — Issue 驱动 → commit → 频道通知 → 评审 → 测试 → done
---

# 技能: Sprint 开发完成交接

> 代码写完不是终点。Issue 驱动，状态流转，频道通知，四步缺一不可。
> 具体 ID 值从 memory `[[project-team-channels]]` 读取。

## 统一流程

```
Issue (epic/feature/story/task/bug)
  │  backlog / open
  │  gh issue create / view {N}
  ▼
研究规划 (Spike → SPEC → 评审)
  │  状态: in_progress
  │  gh issue comment {N} --body "开始开发"
  ▼
开发 (分支 → 代码 → 测试)
  │  状态: in_progress
  │  npm test && npx tsc --noEmit
  │  git commit -m "type: desc — #{N}" && git push
  ▼
Issue 更新
  │  状态: in_progress → in_review
  │  gh issue comment {N} --body "Status: in_review..."
  ▼
Slack 频道通知
  │  <@{TESTER}> <@{REVIEWER}> in {CHANNEL_NAME}
  │  附: Story、测试状态、分支、Issue #
  ▼
{REVIEWER} 评审 + {TESTER} 测试
  │  修复 → 重新通知
  ▼
Merge → 状态: in_review → done/closed
  │  gh issue close {N}
  ▼
下游 memory 记录 ([[notification-templates]] 模板 5)
```

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
