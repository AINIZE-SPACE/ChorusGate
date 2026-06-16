整个记忆更新下： 你是小扣， 小查的同體，负责项目管理 协调， Codex以mcp接入slack

---
name: project-team-channels
description: 项目频道和团队成员信息 + Slack mention 语法 + User Token 消息归属识别
metadata:
  node_type: memory
  type: project
  project: ChorusGate
  originSessionId: 593ae189-2be4-4b1b-b8ee-33f50344ab7e
---

## 项目频道

| 名称 | ID | 用途 |
|------|-----|------|
| <#C0BAB3Y7LLC> | C0BAB3Y7LLC | 开发协作主频道 |

## 团队成员

| 角色 | 姓名 | Slack ID | DM 频道 ID |Slack接入方式|備註|
|------|------|----------|-----------|-----------|-----------|
| 设计+开发 | 小克 | U0B8VHLHJAX | D0B8LES3QUX |BOT|硅基-CloudeCode|
| 评审+测试 | 小马 | U0B91BVKTL2 | D0B93701YD7 |BOT|硅基-Hermes|
| 项目管理 协调(发消息) | 小查 | U0B92RM5AGH | D0B9V9HVDCG |APP|小扣的同體，Codex以mcp接入slack|
| 项目管理协调(响应消息) | 小扣 | U0BAGFVD8VB | D0BAMNPPLRX |BOT|硅基, Codex以Gateway接入Slack|
| Master指挥家 | Zederer(老樂) | U0AHDRREVPD | D0AHZ5D7S7K |User|碳基, Slack管理員|

Zederer 负责需求输入，协调各硅基同事协同工作。
** Allowed user IDs (comma-separated, leave empty to deny everyone except paired users): U0B8VHLHJAX,U0B91BVKTL2,U0AHDRREVPD,U0B92RM5AGH,U0BAGFVD8VB,U0AHDRREVPD **

## Slack Mention 语法

| 目标 | 语法 | 是否触发通知 |
|------|------|------------|
|  | `` | :white_check_mark: |
|  | `` | :white_check_mark: |
|  | `` | :white_check_mark: |
| 频道全员 | `<!channel>` | :white_check_mark: |
| `@小马` (纯文本) | — | :x: bot API 发不触发 |

> :warning: **Bot 发消息时 `@name` 只是文本，不触发通知。** 必须用 `<@USER_ID>` 格式。

## User Token 消息归属识别

当 Slack Bot (Agent) 以 **User Token** 发送消息时，Slack 客户端显示的发消息者是 **token 所属用户**（如 Zederer），但消息尾部会标注 **"发送工具 @BotName"**。

**真正的消息发送者 = 尾部 @BotName**，不是显示的用户名。

判断规则：
- 看到 "Zederer" 发的消息 → 检查尾部是否有 "发送工具 @BotName"
- 有 → 实际发送者是 @BotName (如 @ChorusGate, )
- 没有 → 确实是 Zederer 本人发的

## 通知规则 (来自 [[review-handoff-ownership]])

评审、通知、handoff 消息必须包含明确的下一步负责人（用 Slack mention），否则看了消息不知道谁该行动。
