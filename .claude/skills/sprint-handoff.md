# 技能: Sprint 开发完成交接

> 代码写完不是终点——提交、通知、更新需求状态、记录 memory 四步缺一不可。
> 参考: `E:\my_project\ainize\summit-saw\domains\dev\notification-templates.md`

## Trigger

- 一个或多个 Story/Task 开发完成，所有测试通过
- 用户说 "通知测试"、"提交代码"、"交接"、"小马测试"

## 四步工作流

### 1. 提交代码

```bash
git add -A
git commit -m "feat(scope): 描述

详细变更列表
Refs: #issue1, #issue2"
```

- Commit 格式: Conventional Commits (`feat:`, `fix:`, `refactor:`)
- Commit body 列出主要变更文件和要点
- 尾部引用相关 GitHub Issues

### 2. 通知评审/测试

通过 Slack DM 或 Channel 通知。通知模板:

```
*{项目} {版本/Epic} — {完成的 Story 列表}*

<@REVIEWER_ID> 以下 Story 已实现完毕，请测试验证：

*{Story 1}*
• 要点 1
• 要点 2

*{Story 2}*
• 要点 1

*测试状态*
• N/N 测试通过 | TypeScript 零错误
• 分支: `{branch-name}`

*测试要点*
1. ...
2. ...
```

### 3. 更新需求状态

```bash
gh issue comment {N} --body "**Status: in_review** — implementation complete.

### 实现摘要
- ...
"
```

- 每个完成的 Story/Bug 都要在对应 Issue 里更新进展
- 状态流转: `in_progress` → `in_review`
- 如果 Issue 不存在，先创建

### 4. 记录 Memory

在项目 memory 目录记录关键决策:

```markdown
---
name: {kebab-case-slug}
description: {一句话}
metadata:
  type: project
  project: ChorusGate
  issue: {url}
---

{详细决策/产物/教训}
```

## 通知目标

| 项目 | 评审人 | Slack ID |
|------|--------|----------|
| ChorusGate | 小马 (delez) | U0AHDRREVPD |

## Quality Bar

- [ ] 代码已 commit 到当前分支
- [ ] Slack 通知已发送
- [ ] GitHub Issues 状态已更新 (in_review)
- [ ] 关键决策已记录到 project memory
