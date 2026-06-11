# Slack Scope → Claude Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Claude session UUID。
gateway 用 `claude -p --resume <uuid>` 续接，使同一 scope 跨消息保留上下文。
本文件只存路由 meta —— 真正的对话/记忆在 Claude agent 自己的 session
存储和它的 memory md 里，不在这里。由 gateway 自动维护；可由 git 追踪。

| Scope Key | Session UUID | Started | Last Used |
|------------|--------------|---------|-----------|
| D0B8LES3QUX:1781179146.830009 | db0dfc41-3fa9-4e86-a2e1-49e2a5c09423 | no | 2026-06-11T13:10:42.932Z |
| D0B8LES3QUX:1781159772.119749 | 52737e75-dce0-46e1-89e2-5c5fe668ab4b | yes | 2026-06-11T12:03:26.124Z |
| channel:D0B8LES3QUX | 93036d22-e32a-46be-87cb-ed3d0d92c643 | yes | 2026-06-11T05:00:50.848Z |
| C0B8V9LV8CT:1781108381.126939 | 0fb487e1-295c-42b7-ba87-185c30ef7e89 | yes | 2026-06-10T16:20:07.866Z |
| D0B8LES3QUX:1781010909.460029 | 81a17ecb-6066-4bce-8251-44ced0561266 | yes | 2026-06-10T15:48:16.591Z |
