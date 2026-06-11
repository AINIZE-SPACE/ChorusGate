# Roadmap

> 已完成的功能不在这里，见各 feature 文档。这里只列明确规划但尚未实现的内容。

---

## 近期（High Priority）

### 1. assistant_view DM slash command 支持
**问题**：`assistant_view: true` 在 manifest 里开启后，bot 的 DM 变成 AI 助理界面。Slack 通过专有事件流（`assistant_thread_started`、`assistant_thread_context_changed`）投递，slash command 在这个界面里行为不同。  
**方案**：监听 `assistant_thread_started` 事件，按 Slack AI 助理协议处理（`threads.setTitle`、`threads.setStatus`、`threads.setSuggestedPrompts`）。  
**Why 重要**：DM 是 bot 的主要使用入口，slash command 在 DM 里不可用是明显短板。

---

### 2. 消息状态机（pending → processing → replied/failed）
**问题**：当前消息只跑一次，失败直接报错，没有重试。gateway 重启后 in-flight 消息直接丢。  
**方案**：在 `memory/` 下维护一个 `events.md`（md 表格，不用 SQLite），记录每条消息的状态。gateway 重启时扫描 pending 状态的消息补跑。  
**关键细节**：
- 状态：`pending` → `processing` → `replied` / `failed`
- 幂等：同一 event ts 只处理一次（当前 inFlight Set 已有部分保证，但不跨重启）
- Slack 重投递 dedup：event ts 作为唯一 key

---

## 中期

### 3. Session Host（真透明转发）
**问题**：`claude -p` 是一次性进程，无法透传 `/approve`、`/edit` 等操作命令——这些是 gateway runtime 功能，不是 claude CLI 参数。  
**方案**：维护一个常驻 claude 进程（session host），接管 stdin/stdout stream；gateway 作为 Slack ↔ session host 的双向桥接器。Slack 消息 → stdin；stdout → Slack 发消息；slash command → stdin 注入命令。  
**影响**：
- 支持 `/approve`、`/edit`、`/view` 等全部操作命令
- 不再一次性 spawn，响应更快（无进程启动开销）
- 复杂度大幅上升：需要 session host 进程管理、crash recovery、stream 多路复用  
**When**：当前 session 命令（/sessions /resume /new）满足主要需求后再做。

---

### 4. 多 bot / 多工作区支持
**问题**：当前 `.env` 里只配置一组 Slack tokens，只能服务一个工作区。  
**方案**：支持多 profile 配置（如 `--profile work` / `--profile personal`），每个 profile 独立 tokens + session store。  
**When**：用户有多工作区需求时。

---

## 低优先级 / 有想法

### 5. Web dashboard for sessions
`memory/sessions.md` 是 md 表格，已经可读。可以做一个简单的本地 HTTP 服务展示 session 列表 + 实时 gateway 状态，类似 `slack-gateway status` 但是 Web UI。

### 6. 消息 thread 摘要
`/sessions` 目前只显示 session UUID + key + 时间。可以在 session 创建时记录对话首句（摘要），让 `/sessions` 显示"这个 session 是关于什么的"，方便选 `/resume`。

### 7. 定时任务 / 主动推送
gateway 当前只响应事件。可以增加 cron 模式——定时给指定频道发消息（日报、摘要、提醒），类似 Hermes 的 standup/digest 功能。

---

## 永久否决（不做）

| 方案 | 否决原因 |
|------|---------|
| SQLite 持久化 | 太重，无法 git 追踪，不可读 |
| 读 `~/.claude/projects/<hash>/` jsonl | 耦合内部实现，跨机无法使用，方案极差 |
| 每次新建 claude -p session | 无上下文延续，每条消息从头开始，体验差 |
