# Slack Thread → Claude Session Map

每个 Slack thread 绑定一个持久 Claude session UUID。gateway 用
`claude -p --resume <uuid>` 续接，使 thread 跨消息保留上下文。
本文件只存路由 meta —— 真正的对话/记忆在 Claude agent 自己的 session
存储和它的 memory md 里，不在这里。由 gateway 自动维护；可由 git 追踪。

| Thread Key | Session UUID | Started | Last Used |
|------------|--------------|---------|-----------|
| channel:D0B8LES3QUX | 93036d22-e32a-46be-87cb-ed3d0d92c643 | yes | 2026-06-11T05:00:50.848Z |
| C0B8V9LV8CT:1781108381.126939 | 0fb487e1-295c-42b7-ba87-185c30ef7e89 | yes | 2026-06-10T16:20:07.866Z |
| D0B8LES3QUX:1781010909.460029 | 81a17ecb-6066-4bce-8251-44ced0561266 | yes | 2026-06-10T15:48:16.591Z |
