# Slack Scope → Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Agent session UUID。
gateway 用 `claude -p --resume <uuid>` 或 `codex exec resume <tid>` 续接。
本文件只存路由 meta —— 真正的对话/记忆在 Agent 自己的 session 存储里。
由 gateway 自动维护；可由 git 追踪。

| Scope Key | Session UUID | Provider | Project Dir | Started | Last Used |
|-----------|-------------|----------|-------------|---------|-----------|
| D0B8LES3QUX:1781258095.483969 | 9ccbde41-7c8e-4bf0-b218-bb32804c9597 |  |  | yes | 2026-06-12T10:53:30.168Z |
| D0B8LES3QUX:1781234600.274279 | 1b85b152-efff-4087-8cfe-d26991b76f25 |  |  | yes | 2026-06-12T06:21:08.974Z |
| D0B8LES3QUX:1781227070.272199 | 9df78166-6b98-4500-82ab-9d516e66dec0 |  |  | yes | 2026-06-12T01:24:07.997Z |
| D0B8LES3QUX:1781193423.349839 | ef824ba0-9529-494d-a131-29c7da042908 |  |  | yes | 2026-06-11T16:22:53.922Z |
| channel:C0B8V9LV8CT | b7cc0d21-eac7-4e8b-ab37-30ced533b6af |  |  | yes | 2026-06-11T16:00:32.385Z |
| D0B8LES3QUX:1781183480.341509 | 04346333-5d8b-4e74-ae3b-46be5567fdc4 |  |  | yes | 2026-06-11T15:57:52.793Z |
