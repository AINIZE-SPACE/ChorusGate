# STORY-4: 会话级多项目支持

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P1 | 依赖：STORY-1

## 问题

当前 `CLAUDE_CWD` 是全局的——所有 session 在同一个项目目录下运行。用户想要在同一个 Slack 频道里，不同 session 能跑在不同项目目录。

## 方案

### 会话级 cwd

SessionStore 增加 `projectDir` 字段：

```markdown
| Scope Key | Session UUID | Provider | Project Dir | Started | Last Used |
|-----------|-------------|----------|-------------|---------|-----------|
| channel:C01 | 0fb487e1… | claude | E:\project-a | yes | 2026-06-12 |
| channel:C01 | thread_abc | codex | E:\project-b | yes | 2026-06-12 |
```

- 新建 session 时，cwd 默认从 `GATEWAY_DEFAULT_CWD` 或当前环境取
- `/cc_new` / `/cc_resume` 命令支持 `--project <dir>` 切换工作目录
- 同一个 channel scope key 下可以有多个 session（按 provider 区分）

### Slash Command 扩展

```
/cc_new --project E:\my_project_a    # 在指定目录开新 Claude 会话
/cc_new --provider claude             # 用 claude
/cc_new --provider codex --project ~/work/codex_proj
```

### Codex 的 projectDir 处理

Codex 从项目目录读取 `AGENTS.md`（类似 Claude 的 `CLAUDE.md`）。不同 project 有不同的项目指令。

```bash
# Codex 在指定 cwd 运行
codex exec --json --full-auto <prompt>   # cwd 就是 projectDir
```

### 环境变量

```env
# 默认 project dir（未指定时）
GATEWAY_DEFAULT_CWD=E:\my_project\slack4ccmcp

# 各 provider 默认 cwd
GATEWAY_CWD_CLAUDE=E:\project-a
GATEWAY_CWD_CODEX=E:\project-b
```

## 验收标准

- [ ] SessionStore 支持 projectDir 字段
- [ ] `/cc_new --project <dir>` 将新 session 绑定到指定目录
- [ ] Claude 和 Codex session 在同一频道互不干扰
- [ ] 未指定 `--project` 时使用默认目录
