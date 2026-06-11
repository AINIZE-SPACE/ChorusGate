# 坑与调试记录（Gotchas & Debug Notes）

> 调试过程中实测踩到的非显而易见的问题。每一条都是真实故障，不是推测。

---

## Slack 平台

### 1. Socket Mode 事件负载均衡
**现象**：gateway 运行正常，但大量事件收不到，随机漏。  
**原因**：Slack 把每个事件投递到同一 app 的**任意一个** Socket Mode 连接。多个连接 = 事件分流。常见场景：遗留的测试进程没杀、Claude Code MCP server 和 gateway 同时连。  
**诊断**：Socket Mode `hello` 帧里的 `num_connections` 字段，正常应为 1。  
**修复**：`slack-gateway start` 单实例保证；MCP server 共存时设 `MCP_SENDER_ONLY=1`。

### 2. reaction_added 事件的 channel 位置错误
**现象**：`reaction_added` 事件收到了，但 channel 字段为空。  
**原因**：`reaction_added` 的 channel 在 `event.item.channel`，不是 `event.channel`（后者为空）。  
**修复**：`socket-manager.ts` 里 `handleSlackEvent` 用 `item?.channel` 作为 fallback。

### 3. 加表情反应 ≠ 输入 emoji
**现象**：用户"发了 emoji"但没收到 `reaction_added` 事件。  
**原因**：在输入框打 `:smile:` 发出去是普通消息，不是反应。触发 `reaction_added` 必须悬停消息 → 点 😊 图标 → 选 emoji。

### 4. slash command "不支持"
**现象**：Slackbot 提示"消息列不支持 /cc_sessions"。  
**原因**：manifest 里有 `slash_commands` 配置，但没有推送到 api.slack.com / 没有 reinstall app。  
**修复**：api.slack.com → App Manifest → 粘贴更新后的 manifest → Save → Reinstall。

### 5. assistant_view DM 的 slash command
**现象**：channel 里 slash command 正常，DM 里不工作。  
**原因**：`assistant_view: true` 把 bot 的 DM 变成 AI 助理界面，Slack 通过 `assistant_thread_started` 等专有事件流投递，和普通 slash_commands 事件不同。  
**状态**：待处理，需单独支持 `assistant_thread_started` 事件流。

### 6. 空消息触发回复循环
**现象**：bot 连续发"你的消息是空的"，形成循环。  
**原因**：`assistant_thread_started`、`message_changed` 等系统事件也走 `message` 事件路径，text 为空或只有 subtype，`shouldReply` 没有过滤。  
**修复**：`shouldReply` 加两道检查：① `event.subtype` 存在就跳过；② `cleanText(text)` 为空就跳过。

---

## Windows + spawn 问题

### 7. Prompt 被截断（shell:true + argv）
**现象**：claude 回复 "Ready to help..." 默认欢迎语，没有处理实际问题。  
**原因**：Windows `shell:true` spawn 时，多行或含 CJK 的 prompt 作为 argv 传入，cmd.exe 在换行处截断，claude 收到空 prompt。  
**修复**：prompt 通过 stdin 传入（`child.stdin.write(prompt); child.stdin.end()`），不放 argv。

### 8. --mcp-config 内联 JSON 被吃掉
**现象**：claude 报 "MCP config file not found {mcpServers:{}}"。  
**原因**：Windows cmd.exe 把内联 JSON 字符串里的引号吃掉，claude 解析失败。  
**修复**：写临时文件 `config/sender-mcp.generated.json`，传文件路径给 `--mcp-config`。

### 9. Windows exit code 3221225794（0xC0000142）
**现象**：大量 `claude -p exited 3221225794` 错误。  
**原因**：`STATUS_DLL_INIT_FAILED`——空消息触发的 spawn 风暴，Windows 同时创建太多进程，DLL 初始化资源耗尽。  
**修复**：修复 shouldReply 过滤 + MAX_CONCURRENT 限制 spawn 数量。

---

## Claude Code / MCP

### 10. MCP config 位置错误
**现象**：Claude Code `/mcp` 显示 "No MCP servers configured"，明明配置了。  
**原因**：Claude Code 读项目级 MCP 配置的文件是项目根的 `.mcp.json`，不是 `.claude/mcp.json`。  
**修复**：把配置文件放到项目根，或用 `mv .claude/mcp.json .mcp.json`。

### 11. MCP server 的 cwd 问题
**现象**：`dotenv` 没有加载 `.env`，token 读不到。  
**原因**：Claude Code 以任意 cwd 启动 MCP server，`.env` 的相对路径找不到。  
**修复**：用 `import.meta.url` 算出 MCP server 自身所在目录，然后 `resolve(__dirname, '..', '.env')`，不依赖 cwd。

### 12. 子进程 claude 开了第二个 Socket Mode 连接
**现象**：gateway 偶发漏事件，`num_connections` 变成 2。  
**原因**：gateway spawn 的 `claude -p` 加载了项目 `.mcp.json`，其中的 `slack-socket-mcp` 又建了一个 Socket Mode 连接。  
**修复**：`--strict-mcp-config` + 只传 sender-only MCP config（`MCP_SENDER_ONLY=1`），阻止加载项目 `.mcp.json`。

---

## 网络 / 环境

### 13. Bash 工具沙箱网络限制
**现象**：Bash 工具里 `curl api.n1n.ai` 失败，DNS 被劫持。  
**原因**：Claude Code 的 Bash 工具在受限沙箱，用户自定义的 ANTHROPIC_BASE_URL（api.n1n.ai）被 DNS 劫持。  
**影响**：无法在 Claude Code 里直接测试 gateway / claude -p 的真实行为。  
**结论**：凡是涉及真实 Slack API 或 claude -p 的验证，必须在用户自己的原生终端跑。
