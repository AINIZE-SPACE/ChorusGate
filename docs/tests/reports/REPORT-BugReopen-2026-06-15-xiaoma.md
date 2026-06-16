# ChorusGate Bug Reopen + 测试策略反思报告 (2026-06-15)

> 小马（评审+测试）视角
> 项目：AINEIZE-SPACE/ChorusGate
> 分支：v3/story-8-claude-stream-json (本地 a6e0ea3，GitHub 299100b4)

---

## 1. Bug 验证结果

| # | 描述 | GitHub 状态 | 本地状态 | Fix commit | 结论 |
|---|------|------------|---------|------------|------|
| #76 | reply-engine 不路由 Codex | CLOSED | providerId 被忽略，无 switch | ef6a794 | REOPEN |
| #77 | codex resume --json 位置错误 | CLOSED | --json 在 positional 后 | 7a1fdb1 | REOPEN |
| #78 | Windows 转义缺失 | CLOSED | 无 backslash-doublequote 转义逻辑 | 36225dd | REOPEN |
| #79 | BOT_USER_IDS 自触发循环 | CLOSED | shouldReply() 无 bot 过滤 | 16fe3b5 | REOPEN |

### 根因

本地分支 v3/story-8-claude-stream-json 在 a6e0ea3，落后 GitHub HEAD 299100b4 约 25 commits。

WSL DNS 不稳导致 git fetch 失败，fix commit 都在 GitHub 上但本地无。

4 个 issues 全部 reopen 并在 GitHub 加了详细 comment。

---

## 2. 各 Bug 详细分析

### #76 - reply-engine 不路由到 Codex

本地代码（错误）：
// src/reply-engine.ts:generateReply
const mode = process.env.GATEWAY_CLAUDE_MODE || "legacy";
const provider = mode === "stream" ? claudeStreamProvider : claudeProvider;
// opts.providerId 被完全忽略！

GitHub fix（ef6a794）：
const providerId = opts.providerId || "claude";
switch (providerId) {
  case "codex":       provider = codexProvider;       break;
  case "claude-stream": provider = claudeStreamProvider; break;
  default:            provider = mode === "stream" ? claudeStreamProvider : claudeProvider;
}

### #77 - codex resume --json 位置错误

本地代码（错误）：
// src/providers/codex.ts:resumeSession
const args = ["exec", "resume", sessionId, prompt, "--json"];
// Codex CLI: --json 在 positional args 之后 -> unexpected argument

GitHub fix（7a1fdb1）：
const args = ["exec", "resume", "--json", sessionId, prompt];
// Codex CLI: resume 子命令的 --json 必须在 positional args 前面

### #78 - Windows 转义缺失

本地代码（错误）：
const cmd = win
  ? `"${CODEX_BIN}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`
  : CODEX_BIN;
// 问题: prompt 含双引号 -> 双引号嵌套 -> cmd.exe 解析错误

GitHub fix（36225dd）：
const cmd = win
  ? `"${CODEX_BIN}" ${args
      .map((a) => {
        if (a.includes(" ") || a.includes('"')) {
          return `"${a.replace(/"/g, '\"')}"`;
        }
        return a;
      })
      .join(" ")}`
  : CODEX_BIN;

### #79 - BOT_USER_IDS 自触发循环

本地代码（错误）：
function shouldReply(event: StoredEvent): boolean {
  if (event.subtype) return false;
  if (!cleanText(event.text || "")) return false;
  if (event.type === "app_mention") return true;
  if (event.type === "message") {
    const channelType = ...; if (channelType === "im") return true;
  }
  return false;
}
// 无 BOT_USER_IDS 过滤 -> bot 消息也会触发回复 -> 自循环

GitHub fix（16fe3b5）：
const BOT_USER_IDS = new Set(["U0B8VHLHJAX", "U0BAGFVD8VB"]);
function shouldReply(event: StoredEvent): boolean {
  if (event.subtype) return false;
  if (!event.user || BOT_USER_IDS.has(event.user)) return false;
  ...
}

---

## 3. 测试策略反思

### 为什么 unit test 通过但集成失败

| Bug | Unit test 为什么没发现 | 缺失的 ST 用例 |
|-----|----------------------|----------------|
| #77 --json 位置 | codex-provider.test.ts 只测 generateMCPConfig，零覆盖 resumeSession() | 真实 codex exec resume --json 调用 |
| #78 Windows | 设 CODEX_BIN=nonexistent 直接 ENOENT，永远不跑 spawnCodex Windows 分支 | 含引号 prompt 的 Windows 真实 spawn |
| #76 providerId | 设 CLAUDE_BIN=nonexistent 触发 ENOENT，没跑到 providerId switch 分支 | generateReply({providerId:"codex"}) 验证路由 |
| #79 自触发循环 | shouldReply() 无任何测试覆盖 | bot DM 消息 -> shouldReply() 返回 false |

### 教训（测试 Anti-Patterns）

已更新 test-driven-development skill 的 Testing Anti-Patterns 段：

"Unit-test-passed 不等于 integration-works" - 4 个 bug 都是 unit test 通过但集成失败：
- CLI subcommand-specific flags：flag 对一个子命令有效对另一个无效，mock 不捕获
- Windows shell quoting：真实 cmd.exe shell 行为与 Unix/mock 不同
- Routing options silently ignored：字段存在但从未读取，死代码
- 入口决策点无测试覆盖：shouldReply() 这种 gateway 入口函数没有 ST 覆盖

### 下次 bug fix 的测试要求

每个 bug fix 必须同时满足：
1. UT：写明边界条件（如 CODEX_BIN=nonexistent 强制 ENOENT）
2. ST：至少一个用例从真实入口触发，走实际代码路径（不是 mock）

---

## 4. 当前状态

- 4 个 issues：#76 #77 #78 #79 全部 REOPENED
- Slack 通知：已发 #所有-ainize（C0AHL7U33EE），ts 1781535027.824449
- 阻塞：WSL DNS 不稳，无法 git fetch 更新本地分支
- 下一步：等小克 fetch 最新代码并合入 fix commits 后，重新评审 + 跑 ST 回归测试

---

## 5. 元数据

- 作者：小马（delez911）
- 日期：2026-06-15
- 关联 issues：#76 #77 #78 #79（全部 REOPENED）
- Slack 通知 ts：1781535027.824449
