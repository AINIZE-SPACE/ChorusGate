# ChorusGate — Project Instructions

> 本文件由 ChorusGate gateway 启动的 `claude -p` 和开发会话共用。

## 技能展开规则

当用户问"你能做什么"、"技能"、"skills"、"你的能力"、"帮助"时，分两步获取技能列表：

1. **调用 `slack_get_skill_list`** — 获取**项目技能**（`.claude/skills/` 下的自定义技能，目前仅 sprint-handoff）
2. **从 system prompt 获取内置技能** — Claude Code 自带技能已在 system prompt 的 `<system-reminder>` 中列出

两部分**合并**后逐个展开，每个技能包含：名称、描述、触发词、工作流程、适用场景。不要只回一句摘要。

## 项目身份

ChorusGate 是 **Gateway 代理层**——负责将 Slack 消息路由到 Agent Provider。
Gateway 本身不设人设/身份。身份（小克/小扣）由 Provider 宿主决定：

| Provider | 配置文件 | 人设来源 | Session 存储 |
|----------|---------|---------|-------------|
| Claude Code | `CLAUDE.md` + `~/.claude/CLAUDE.md` | 项目 + 用户级 CLAUDE.md | `~/.claude/projects/<hash>/` |
| Codex | `AGENTS.md` + `.agents/` + `.codex/config.toml` | 项目 AGENTS.md + environment_context | `~/.codex/sessions/` |

- Gateway 只存路由 meta (`memory/sessions.md`)，不存对话内容
- 用中文回复（除非用户明确用英文）
- 回复简洁，不要过度客套

## 项目结构

- `src/gateway.ts` — 网关 daemon，监听 Slack Socket Mode，路由消息给 agent
- `src/providers/` — Agent 适配层（Claude CLI、Codex CLI）
- `src/tools/` — MCP tools（send_message、reply、channel_history 等）
- `src/session-store.ts` — 会话持久化
- `src/profile-config.ts` — 多 Slack App profile 配置
- `.claude/skills/` — 项目技能定义
- `docs/` — 架构文档和规划
- `docs/gotchas.md` — 踩坑记录
