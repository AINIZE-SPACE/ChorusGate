# Slack Scope → Claude Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Claude session UUID。
gateway 用 `claude -p --resume <uuid>` 续接，使同一 scope 跨消息保留上下文。
本文件只存路由 meta —— 真正的对话/记忆在 Claude agent 自己的 session
存储和它的 memory md 里，不在这里。由 gateway 自动维护；可由 git 追踪。

| Scope Key | Session UUID | Started | Last Used |
|------------|--------------|---------|-----------|
| D0B8LES3QUX:1781234600.274279 | 1b85b152-efff-4087-8cfe-d26991b76f25 | yes | 2026-06-12T06:21:08.974Z |
| D0B8LES3QUX:1781227070.272199 | 9df78166-6b98-4500-82ab-9d516e66dec0 | yes | 2026-06-12T01:24:07.997Z |
| D0B8LES3QUX:1781193423.349839 | ef824ba0-9529-494d-a131-29c7da042908 | yes | 2026-06-11T16:22:53.922Z |
| channel:C0B8V9LV8CT | b7cc0d21-eac7-4e8b-ab37-30ced533b6af | yes | 2026-06-11T16:00:32.385Z |
| D0B8LES3QUX:1781183480.341509 | 04346333-5d8b-4e74-ae3b-46be5567fdc4 | yes | 2026-06-11T15:57:52.793Z |
| D0B8LES3QUX:1781179146.830009 | db0dfc41-3fa9-4e86-a2e1-49e2a5c09423 | yes | 2026-06-11T13:11:31.157Z |
| D0B8LES3QUX:1781159772.119749 | 52737e75-dce0-46e1-89e2-5c5fe668ab4b | yes | 2026-06-11T12:03:26.124Z |
