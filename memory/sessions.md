# Slack Scope → Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Agent session UUID。
gateway 用 `claude -p --resume <uuid>` 或 `codex exec resume <tid>` 续接。
本文件只存路由 meta —— 真正的对话/记忆在 Agent 自己的 session 存储里。
由 gateway 自动维护；可由 git 追踪。

| Scope Key | Session UUID | Provider | Project Dir | Started | Last Used |
|-----------|-------------|----------|-------------|---------|-----------|
| channel:C0BAB3Y7LLC | 567432f0-b7c8-4598-a1b8-0a36a9147167 |  |  | yes | 2026-06-13T05:30:58.871Z |
