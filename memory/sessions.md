# Slack Scope → Claude Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Claude session UUID。
gateway 用 `claude -p --resume <uuid>` 续接，使同一 scope 跨消息保留上下文。
本文件只存路由 meta —— 真正的对话/记忆在 Claude agent 自己的 session
存储和它的 memory md 里，不在这里。由 gateway 自动维护；可由 git 追踪。

| Scope Key | Session UUID | Started | Last Used |
|------------|--------------|---------|-----------|

