# CC Pocket — 参考分析

> 来源：https://github.com/K9i-0/ccpocket (MIT License)
> 分析日期：2026-06-12
> 复核：GitHub README 显示 CC Pocket 是通过自托管 Bridge Server 控制 Codex / Claude sessions 的移动/桌面 App，支持审批、文件/差异查看、断线恢复、git worktree 并行隔离和服务化 Bridge setup。

---

## 一句话

CC Pocket 是一个 Flutter 跨平台 App，通过自托管 WebSocket Bridge 在手机/平板上远程操控 Codex / Claude Code 编码 agent。

---

## 架构

```
┌───────────────────────┐
│  CC Pocket App         │  Flutter (iOS/Android/macOS/Linux/Windows)
│  用户界面                │  - 会话管理、审批、文件浏览、prompt 编辑
└──────┬────────────────┘  - 语音输入、图片附件、Markdown 自动补全
       │ WebSocket
       ▼
┌───────────────────────┐
│  Bridge Server         │  Node.js (TypeScript)
│  自托管中转层            │  - 部署在开发机上（npx @ccpocket/bridge）
│                        │  - 暴露 WebSocket，App 扫码连接
│                        │  - 管理 agent CLI 生命周期
└──────┬────────────────┘  - 持久化服务（launchd / systemd）
       │ spawn / stdio
       ▼
┌───────────────────────┐
│  Agent CLI             │  Codex CLI 或 Claude Code (claude -p)
│  实际执行编码            │  - 运行在同一台机器上
│                        │  - 代码不离开开发机
└───────────────────────┘
```

**核心设计原则**：代码始终留在用户自己的机器上，App/Bridge 只是遥控器。

---

## 技术栈

| 层 | 技术 | 占比 |
|---|---|---|
| App UI | Flutter (Dart) | ~72% |
| Bridge Server | Node.js (TypeScript) | ~22% |
| 原生平台代码 | Swift (macOS/iOS) | ~3% |
| 推送/后台 | Firebase | — |
| Agent 集成 | MCP (`.mcp.json`) | — |

---

## 对 slack4ccmcp 的参考价值

### 1. Bridge ↔ Gateway 同构

ccpocket 的 Bridge Server 和我们的 Gateway 是同一模式：**本地常驻进程，在用户界面和 agent CLI 之间做中转**。

| 维度 | ccpocket Bridge | slack4ccmcp Gateway |
|---|---|---|
| 用户界面 | Flutter App (WebSocket) | Slack (Socket Mode) |
| 传输协议 | 自建 WebSocket | Slack Socket Mode (WebSocket) |
| Agent CLI | spawn Codex / Claude | spawn `claude -p` |
| 持久化 | 内置状态管理 | `memory/sessions.md` |
| MCP | `.mcp.json` | sender-only MCP config |

**关键差异**：slack4ccmcp 不需要自建 WebSocket server——Slack 的 Socket Mode 已经提供了持久双向连接。Bridge 负责的"授权和传输"在 Slack 生态里由 Slack 自己的基础设施承担。

### 2. Git Worktree 会话隔离 :high:

ccpocket 每个 session 跑在独立 git worktree 里，避免长时间运行的并行任务互相污染。

**对应 v3**：我们 `v3-story-4-multi-project.md` 的 `GATEWAY_PROJECT_ROOTS` 多项目隔离，可以用 git worktree 做更强的沙箱——不仅是不同项目，同一项目的不同并发 session 也能隔离。

**落地建议**：
- v3 先实现会话级 `projectDir`，保持简单。
- 后续新增 `GATEWAY_WORKTREE_MODE=per-session`，为长任务或显式 `/cc_new --worktree` 建 worktree。
- SessionStore 增加 `worktreeDir`，清理逻辑单独实现，避免把 worktree 生命周期塞进 provider。

### 3. 审批循环 (Approval Loop) :high:

ccpocket 的核心 UX 是"移动端审批"：
- Agent 提出操作 → 手机推送通知 → 用户批准/拒绝 → Agent 继续

**对应我们**：`docs/architecture.md` 已知局限第一条"无 session-host"，核心就是缺审批透传。ccpocket 的做法是：
- Bridge 拦截 agent 的审批请求
- 通过 WebSocket 推送到 App
- App UI 展示选项（approve/deny）
- 结果通过 Bridge 返回给 agent

**slack4ccmcp 可以这样做**：Gateway 拦截 `claude -p` 的审批 stream event → 通过 Slack interactive message（按钮）推送给用户 → 用户点击 Approve/Deny → Gateway 把结果喂回 agent。

**落地前提**：一次性 `claude -p` 进程很难完整支持控制回写。真正形态应落到 Session Host / RuntimeControlCommand，而不是把 approve/deny 包成普通用户 prompt。

### 4. 离线韧性 (Offline Resilience) :med:

ccpocket 处理断连的方式：
- 离线时消息入队
- 重连后自动重发
- 恢复丢失的流式更新

**对应我们**：已知局限第二条"无重试/状态机"。slack4ccmcp 可以借鉴队列模式：
```
pending → processing → (streaming) → replied
                                    → failed → retry_queue → pending
```

**落地建议**：先把 `eventStore` 从纯内存变成 gateway-owned durable trace，不直接持久化完整对话；只记录 event id、scope、status、attempt、last error、reply target、runtime turn id。

### 5. 多 Agent 支持 :med:

ccpocket 同时支持 Codex 和 Claude，在同一个 App 里切换。

**对应 v3 EPIC**：我们的 `v3-story-2-codex-provider.md` 是同一方向。ccpocket 的做法是 Bridge 抽象了 agent 的 spawn 和通信，上层 UI 不感知具体是哪个 CLI。这正是我们 Provider Abstraction (`v3-story-1`) 要做的。

### 6. 系统服务化 :low:

ccpocket 用 `bridge setup` 一条命令注册为 launchd/systemd 服务。

**对应我们**：`feature-install-lifecycle.md` 已有 plan，实现思路一致。

### 7. 设备发现 (QR Code / mDNS) :low:

扫码连接 + mDNS 局域网发现 + Tailscale 远程访问。

**对 slack4ccmcp**：这个需求不大——Slack App 安装本身就是"配对"过程。但如果未来做 CLI 工具（非 Slack 通道），QR/mDNS 值得参考。

---

## 灵感清单

- [ ] **Slack 审批按钮**：Gateway 解析 `claude -p` stream 中的 permission 事件 → `chat.postMessage` 带 interactive blocks（Approve / Deny 按钮）→ `block_actions` 事件回传结果
- [ ] **消息队列 + 重试**：`pending` → `processing` → `replied/failed` + 离线积压队列
- [ ] **Worktree 隔离**：session 级 git worktree，防止并发 session 文件冲突
- [ ] **Bridge 抽象层**：spawn agent 的接口抽象（`startAgent(provider, opts)`），同时支持 Claude 和 Codex

## 已映射到本项目文档

| CC Pocket 点 | slack4ccmcp 文档落点 |
|---|---|
| Bridge Server = 本地控制面 | `docs/architecture.md`、`docs/planning/architecture-boundaries.md` |
| approval loop | `docs/roadmap.md`、GitHub issue |
| offline queue / stream recovery | `docs/roadmap.md`、GitHub issue |
| git worktree session isolation | `docs/planning/v3-story-4-multi-project.md`、GitHub issue |
| bridge setup / system service | `docs/planning/feature-install-lifecycle.md` |

## 不建议照搬的部分

- **自建 WebSocket 协议**：Slack Socket Mode 已经提供稳定 WebSocket 事件通道；再加一层 Bridge 会增加部署面。
- **QR/mDNS 配对**：Slack App 安装、token 和 workspace 权限就是配对机制；QR/mDNS 更适合自建 App。
- **完整移动端文件浏览 UI**：Slack 不适合做 IDE 级文件浏览；更适合发摘要、diff 链接、审批按钮和状态更新。
- **Bridge 直接拥有业务工具面**：slack4ccmcp 应保持 Channel / Gateway / Runtime 分层，Slack API 工具仍走 sender-only MCP 或 channel provider。

---

## 与本项目定位差异

| 维度 | CC Pocket | slack4ccmcp |
|---|---|---|
| 定位 | 通用远程编码遥控器 | Slack 原生 Claude Code 助手 |
| 用户界面 | Flutter App（需要单独安装） | Slack（已有基础设施） |
| 使用场景 | 离开电脑时编码 | 团队协作 + 随时 @ 助手 |
| 安装门槛 | 装 App + 装 Bridge + 扫码 | Slack App 一键安装 |
| 多用户 | 单人单 Bridge | 天然多用户（Slack workspace） |
| 团队协作 | 不支持 | 天然支持（频道/DM/thread） |

CC Pocket 更像一个"通用 agent 遥控器"，而 slack4ccmcp 是"把 agent 嵌入团队沟通流"。两者的方向互补而非竞争——CC Pocket 适合单人移动场景，slack4ccmcp 适合团队协作场景。
