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

## Bug 修复强制流程

**任何 bug 修复或新功能必须走完整流程，不得跳过：**

1. **提单**: `gh issue create` → 记录现象、根因、修复方案
2. **修复**: 代码 + `npx tsc --noEmit`
3. **自测**: `npm test` + 涉及 CLI 的跑 `node scripts/verify-codex-cli.mjs`
4. **CC 影响审查**: 检查 Claude Code 路径是否受影响
5. **提交**: `git add -A && git commit && git push`
6. **通知**: `slack_send_message` → `{CHANNEL_ID}` → `@{TESTER}` `@{REVIEWER}`
7. **Issue 关闭**: `gh issue close {N}`

**:zap: 自测硬规则（Sprint 3 血泪教训）**:
- **改完代码必须先 `npm test` 再提交**——代码写完不是终点
- **CLI flag 必须先 `node scripts/verify-codex-cli.mjs` 实测**——文档有≠版本支持
- **禁止猜参数**——每个 flag 都要对着 `codex exec --help` / `claude -p --help` 确认

## Quality Bar

- [ ] Issue 提单了（不是修完才补）
- [ ] 测试通过 (`npm test` + `npx tsc --noEmit`)
- [ ] CLI 实测通过 (`node scripts/verify-codex-cli.mjs`，如涉及)
- [ ] CC 路径审查通过（改动不影响 Claude Code）
- [ ] `git push` 到远程
- [ ] Slack 频道通知（`@{TESTER}` `@{REVIEWER}`，mention 置首行）
- [ ] GitHub Issue 已关闭

## Sprint 3 实战教训

**:warning: 测试 fixture 必须和真实输出格式一致**
`stream_event` 拆包的 bug 经历了 4 次 round-trip 才修好，因为 fixture 没 mock 真实格式。
→ 新功能必须先抓真实 CLI 输出写 fixture，再写 parser。

**:warning: 代码写完 ≠ 终点，必须走完整流程**
#88-#91 全是修完才补 issue。正确流程：先提单 → 修 → 自测 → 通知 → 关。
→ 每修一个 bug 发一条 Slack 通知。

**:warning: 一条日志抵十次猜测**
`super.feed(rawLine)` vs `super.feed(JSON.stringify(evt))` ——没日志根本看不出差了一行代码。
→ 新功能加关键路径日志，修 bug 靠日志不靠猜。
