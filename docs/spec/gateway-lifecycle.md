# Feature: Gateway 生命周期管理

> 对应文件：`bin/chorusgate.mjs`、`src/gateway-control.ts`、`src/gateway-paths.ts`

---

## 功能描述

`chorusgate` 是 gateway 守护进程的控制工具，支持：

| 命令 | 行为 |
|------|------|
| `chorusgate run` | 前台运行（阻塞终端，调试用）|
| `chorusgate start` | 后台守护进程（推荐日常使用）|
| `chorusgate stop` | 停止守护进程（SIGTERM）|
| `chorusgate restart` | stop + start |
| `chorusgate status` | 查看运行状态（pid、运行时长、活跃 session 数）|
| `chorusgate list` | 列出所有 channel→session 映射 |

`npm run start|stop|restart|status|list` 是对应别名。

---

## 控制文件（.gateway/）

运行时状态用文件传递，位置：`.gateway/`（gitignore）。

| 文件 | 写入时机 | 内容 |
|------|---------|------|
| `gateway.pid` | 守护进程启动时 | 进程 PID |
| `gateway.log` | 守护进程 stdout/stderr 重定向 | 日志 |
| `status.json` | 每 5s 写一次 | pid、startedAt、activeSlots、sessions |

**Why 文件而不是 IPC**：跨进程通信最简单的方式。PID 文件是守护进程的行业惯例，`process.kill(pid, 0)` 探活不需要任何协议。

---

## 单实例保证

`start` 时检查 `gateway.pid` 是否存在且进程还活着（`process.kill(pid, 0)` 不抛异常 = 存活）。已有运行中的实例 → 拒绝启动，提示 `restart`。

**Why 重要**：Slack 每个 app 只应有一个 Socket Mode 连接。两个实例 = 事件被 Slack 分流，大量丢失。

---

## 停止方式

`stop` 发 `SIGTERM`，gateway 注册了 SIGTERM handler：
1. `stopSocketMode()`（断开 WebSocket）
2. 删除 `gateway.pid` 和 `status.json`
3. `process.exit(0)`

清理文件让 `status` 能正确报告"已停止"。

---

## 后台启动实现

`start` 命令用 `node:child_process` 的 `spawn` 加 `detached: true`、`stdio: ['ignore', logFile, logFile]`，然后 `child.unref()`。父进程退出后子进程独立运行，日志写 `.gateway/gateway.log`。

---

## status.json 结构

```json
{
  "pid": 12345,
  "startedAt": 1749600000000,
  "updatedAt": 1749600300000,
  "activeSlots": 1,
  "maxConcurrent": 3,
  "sessions": [
    { "key": "channel:C0B8V9LV8CT", "sessionId": "...", "started": true, "lastUsed": 1749600200000 }
  ]
}
```

`status` 命令读这个文件格式化输出；`list` 命令只取 `sessions` 字段。

---

## idle eviction

每 30 分钟扫描 `sessionStore`，evict `lastUsed` 超过 `GATEWAY_SESSION_IDLE_MS`（默认 24h）的映射。eviction 只删内存里的 key→UUID 映射，`memory/sessions.md` 同步更新（删掉对应行），但底层 Claude session 文件不受影响（claude 自己管）。

**Why evict**：长期不用的频道累积映射会让 `sessionStore` 无限增长。evict 只影响路由 meta，不影响对话历史（重新发消息会新建映射，claude 自然开新对话）。
