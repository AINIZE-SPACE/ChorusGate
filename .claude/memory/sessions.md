# Slack Scope → Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Agent session UUID。
gateway 用 `claude -p --resume <uuid>` 或 `codex exec resume <tid>` 续接。
本文件只存路由 meta —— 真正的对话/记忆在 Agent 自己的 session 存储里。
由 gateway 自动维护；可由 git 追踪。

| Profile | Provider | Scope Key | Session UUID | Project Dir | Started | Last Used |
|---------|----------|-----------|-------------|-------------|---------|-----------|
| default | codex | default:codex:channel:C0BEYCR30TD:E:\my_project\ainize\zederer_ip_test | 01a08dfa-bd43-7771-b255-a94235c47419 | E:\my_project\ainize\zederer_ip_test | yes | 2026-09-12T01:00:47.095Z |
