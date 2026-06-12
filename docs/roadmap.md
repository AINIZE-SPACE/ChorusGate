# Roadmap

> 已完成的功能不在这里，见各 feature 文档。这里只列明确规划但尚未实现的内容。

---

## v2 规划方向

> 版本定位：从个人 Claude Code Slack 桥，扩展为可自托管、多平台、运维完善的 IM → Claude Code 网关。

### 方向 1：Slack Command 增强

高优先级（详见 [feature-slack-commands.md](./feature-slack-commands.md)）：

| 命令 | 说明 |
|------|------|
| `/stop` | 终止当前 channel 正在运行的 claude 进程 |
| `/retry` | 重新发送最后一条用户消息 |
| `/model [name]` | 切换当前 session 使用的模型 |
| `/agents` | 显示 in-flight 进程列表 |
| `/background <prompt>` / `/bg` | 后台跑 prompt，不打断当前对话 |
| `/restart` | Graceful restart gateway |
| `/update` | git pull + build + restart |

依赖 Session Host 的命令（中期）：`/approve`、`/deny`、`/branch`、`/compress`。

### 方向 2：安装生命周期 + 系统服务

（详见 [feature-install-lifecycle.md](./feature-install-lifecycle.md)）

| 功能 | 说明 |
|------|------|
| `npm run install-all` | 一键安装：检测 claude CLI、配置 .env、build |
| Claude Code CLI 自动安装 | 检测 `claude` 是否在 PATH，没有就 `npm install -g @anthropic-ai/claude-code` |
| `npm run service:install` | 注册系统服务（Windows: Task Scheduler / macOS: launchd / Linux: systemd）|
| `npm run service:uninstall` | 注销系统服务 |

目标：`git clone` → `npm run install-all` → 填写 .env → `npm run service:install` 四步完成，开机自启。

### 方向 3：飞书（Lark）支持

（详见 [feature-feishu.md](./feature-feishu.md)）

1. Platform 抽象重构：抽出 `Platform` 接口，Slack 实现为 `SlackPlatform`
2. 飞书接入：`FeishuPlatform`，使用飞书官方 SDK 长连接（无需公网，类似 Socket Mode）
3. 飞书 MCP Tools：`feishu_send_message`、`feishu_channel_history` 等 7 个工具
4. 多 platform 配置：`GATEWAY_PLATFORMS=slack,feishu`

### 方向 4：开源 + MIT 协议

`package.json` 已有 `"license": "MIT"`。正式开源前需：

- [ ] 根目录加 `LICENSE` 文件（MIT 标准文本）
- [ ] 确认 `.env` 没有进 git，token 没有硬编码
- [ ] `memory/sessions.md` 清理真实 channel ID / session UUID（或确认可以公开）
- [ ] README 写面向新用户的安装向导
- [ ] 确认所有依赖协议兼容 MIT

---

## 近期（继承自 v1 未完成）

### 1. assistant_view DM slash command 支持

**问题**：`assistant_view: true` 开启后，DM 里的 slash command 行为不同，当前不工作。

**方案**：按 Slack AI 助理协议处理 `assistant_thread_started`（`threads.setTitle`、`threads.setStatus`、`threads.setSuggestedPrompts`）。

**Why 重要**：DM 是 bot 的主要使用入口，slash command 在 DM 里不可用是明显短板。

---

### 2. 消息状态机（pending → processing → replied/failed）

**问题**：当前消息只跑一次，失败直接报错，没有重试。gateway 重启后 in-flight 消息直接丢。

**方案**：在 `memory/events.md`（md 表格，不用 SQLite）记录每条消息状态，重启时扫描 pending 补跑。

**关键细节**：
- 状态：`pending` → `processing` → `replied` / `failed`
- 幂等：event ts 作为唯一 key，同一 ts 只处理一次
- 参考 CC Pocket：断线期间排队，重连后恢复流式更新或补发结果。

---

## 中期

### 3. Session Host（真透明转发）

**问题**：`claude -p` 是一次性进程，无法透传 `/approve`、`/edit` 等交互命令。

**方案**：常驻 claude 进程 + stdin/stdout stream 接管，gateway 作为 Slack ↔ session host 的双向桥接器。

**影响**：支持全部操作命令，响应更快（无进程启动开销），但复杂度大幅上升，单独立项。

### 3.1 Slack 审批循环（参考 CC Pocket）

**问题**：移动端/Slack 场景下，agent 的 approve/deny/question 不能只靠 prompt 模拟；它是控制面事件。

**方案**：runtime 产出 approval request → gateway 发 Slack interactive message（Approve / Deny / Answer）→ `block_actions` 回传 → runtime `sendControl()`。

**约束**：需要 Session Host 或支持 control event 的 runtime；`claude -p` 一次性进程只能先做有限降级。

**跟踪**：[#32](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/32)

### 4. 多工作区 / 多 profile 支持

支持多组 Slack/飞书 tokens（`--profile work` / `--profile personal`），每个 profile 独立 session store。

### 4.1 Session 级 git worktree 隔离

**问题**：会话级 cwd 不能防止同一 repo 的两个长任务同时修改一个工作树。

**方案**：可选 `GATEWAY_WORKTREE_MODE=per-session`，为每个 session 创建独立 git worktree，并把 `worktreeDir` 写入 SessionStore。

**来源**：CC Pocket 用 worktree 保证并行 session 隔离，适合作为 v3 多项目之后的增强。

**跟踪**：[#33](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/33)

---

## 低优先级 / 有想法

### 5. Web dashboard for sessions

本地 HTTP 服务展示 session 列表 + gateway 实时状态，类似 `status` 命令但是 Web UI。

### 6. 消息 thread 摘要

`/cc_sessions` 记录对话首句，让列表显示"这个 session 是关于什么的"，方便 `/cc_resume` 选择。

### 7. 定时任务 / 主动推送

cron 模式——定时给指定频道发消息（日报、摘要、提醒），类似 Hermes standup/digest 功能。

---

## 永久否决（不做）

| 方案 | 否决原因 |
|------|---------| 
| SQLite 持久化 | 太重，无法 git 追踪，不可读 |
| 读 `~/.claude/projects/<hash>/` jsonl | 耦合内部实现，跨机无法使用，方案极差 |
| 每次新建 claude -p session | 无上下文延续，每条消息从头开始，体验差 |
