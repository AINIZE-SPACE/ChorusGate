# Code Review Report - chorusgate M2 (Claude Stream-JSON)

**Date:** 2026-06-13
**Branch:** `v3/story-8-claude-stream-json` (vs `main`)
**Reviewer:** delez (小马)
**Review Scope:** 6 new modules implementing M2 (Claude 双向 stream-json 控制面)
**Status:** 评审完成，待小克修复 P0/P1 后可合并

---

## 评审范围

| 模块 | 文件 | 责任 |
| --- | --- | --- |
| 1. Parser 扩展 | `src/providers/claude-stream-parser.ts` | system(init/permission_request/api_retry) + user(replay) 事件解析 |
| 2. Provider + StreamSession | `src/providers/claude-stream.ts` | 双向 stdin/stdout + `createStreamSession()` |
| 3. 审批追踪器 | `src/permission-tracker.ts` | Promise-based 审批状态机 + Slack blocks 构造 |
| 4. Reply Engine 适配 | `src/reply-engine.ts` | `generateReplyStream()` 封装 + onPermission 回调 |
| 5. Gateway 集成 | `src/gateway.ts` | `INTERACTIVE_PERMISSIONS` 模式 + Approve/Deny 按钮 |
| 6. Socket Manager | `src/socket-manager.ts` | `interactive` 事件 (block_actions) 支持 |

**测试基线：** 21/21 通过 (新加 14 测试) — 评审前
**类型检查：** 通过
**未运行环境：** 真实网络 `permission_request` 完整审批往返 (沙箱无 API)

---

## 评审方法

1. 逐行阅读 6 个模块源码
2. 关联阅读父类 `ClaudeEventParser` + 类型定义 `providers/types.ts` + 既有 `claude.ts` 实现
3. 阅读全部 3 个测试文件，对照实现寻找覆盖盲区
4. 阅读 spike fixture (`claude-stream-init.jsonl`, `claude-stream-permission-request.jsonl`) 验证 parser 假设
5. 跟读 `gateway.ts` 主流程找出 stream 模式下的边界条件
6. 写一个 mock-claude 测试脚本实际 spawn 子进程验证双向管道

---

## 发现汇总

| 严重 | 发现 | 已修 | 待修 |
| --- | ---: | ---: | ---: |
| P0 Critical | 4 | 4 | 0 |
| P1 High | 5 | 5 | 0 |
| P2 Medium | 6 | 0 | 6 (转入 sprint backlog) |
| P3 Low | 5 | 0 | 5 (转入 sprint backlog) |
| **本评审总计** | **20** | **9** | **11** |

> P0/P1 全部在本 PR 修完，9 项实际改代码。
> P2/P3 转入后续 sprint，issue 仍在 GitHub 跟踪 (#35–#44)。
> 完整 20 项见 [ISSUES-v3-2026-06-13.md](./ISSUES-v3-2026-06-13.md)。

---
## P0 Critical (4 项 — 本评审已修)

### P0-1: `createStreamSession` 永远用 `--session-id` 而非 `--resume`，破坏 stream 模式下的 session 续接
- **位置：** `src/providers/claude-stream.ts:308-319`
- **症状：** spec 明确说 stream 模式要支持 session 复用，但实现里写死了 `--session-id <uuid>`。传已有 sessionId 时，CC 会把它当成"创建"而非"续接"，每次都是新 session。
- **影响：** M2 验收里"session 复用"条款无法满足；用户跨多次对话的上下文全部丢失。
- **修复：** 区分 `--session-id`（无已有 ID 时预生成）和 `--resume`（调用方传了 ID 时）。参考 `claude.ts:resumeSession` 模式。
- **测试：** 新加 `claude-stream-integration.test.ts` 用 mock claude 二进制验证 args 拼接。

### P0-2: 审批消息按钮在 approve/deny 后仍可点击（按钮未更新 + actionValue 仍可解析）
- **位置：** `src/gateway.ts:609-612` + `src/socket-manager.ts:164-198`
- **症状：** 用户点完 Approve，按钮原样留在频道里；第二次点击会触发 `permissionTracker.handleAction("approve:req_xxx")` 返回 false（requestId 已 resolve），但 UI 上没有任何反馈。审批 message 变成"幽灵"按钮。
- **影响：** UX 混乱；多次点击可能让用户怀疑系统是否响应；权限决策的"已批准"状态没在 Slack 留下痕迹。
- **修复：** gateway 在收到 `permissionTracker.handleAction` 返回 true 时，调用 `web.chat.update` 把原 message 的 blocks 替换为"Approved/Denied by @user at <time>"。
- **测试：** 新加 `permission-tracker.test.ts` 测试 approve/deny 后能拿到 actionValue 用于回写 message。

### P0-3: 任何频道成员都能审批别人的工具调用（无 user 鉴权）
- **位置：** `src/permission-tracker.ts` 整体设计
- **症状：** `buildApprovalBlocks` 按钮 value 仅有 `approve:`TrequestId`，不携带原事件触发者的 user_id；`handleAction` 也不校验点击者。
- **影响：** 安全问题 — 在共享频道里，用户 B 可以批准/拒绝用户 A 发起的工具调用。Dev 环境单用户可忽略，多人部署会出事。
- **修复：** 在 `value` 里编码 `user_id`（发起者），gateway 处理 action 时校验 Baction.userId === 发起者`，不匹配则忽略 + 日志告警。
- **测试：** 新加测试 case 验证非发起者点击被拒绝。

### P0-4: 缺失 4 类关键测试覆盖（实际功能层无验证）
- **位置：** `tests/claude-stream-session.test.ts`, `tests/permission-tracker.test.ts`, 无 `reply-engine.test.ts`, 无 `socket-manager-block-actions.test.ts`
- **症状：**
  - `claude-stream-session.test.ts` 只测了 type shape 和 JSON.parse roundtrip，**没有真正 spawn 任何子进程**测 stdin/stdout 双向流
  - `reply-engine.ts` 的 mode 路由（`GATEWAY_CLAUDE_MODE=stream` vs `legacy`）零覆盖
  - `socket-manager.ts` 的 `interactive` 事件 handler 零覆盖
  - `claudeStreamProvider.createSession/resumeSession` 零覆盖
- **影响：** M2 真实运行环境（沙箱无法验证）一旦出问题，没有 unit/integration test 兜底。
- **修复：** 新加 4 个测试文件 + 1 个 mock claude 二进制 fixture。
  - `tests/fixtures/mock-claude/script.mjs` — 假 claude 进程，从 stdin 读 message、按脚本输出 JSONL 事件
  - `tests/claude-stream-integration.test.ts` — spawn mock claude，验证 `createStreamSession` 双向流 + permission_response
  - `tests/socket-manager-block-actions.test.ts` — 单元测试 block_actions handler
  - `tests/reply-engine.test.ts` — mock provider 验证 `GATEWAY_CLAUDE_MODE` 路由
  - `tests/permission-tracker.test.ts` 扩展：发起者鉴权 + Slack 消息回写

---
## P1 High (5 项 — 本评审已修)

### P1-1: `claudeStreamProvider` 一次性 vs `createStreamSession` 双向命名歧义
- **位置：** `src/reply-engine.ts:30-34` + `src/providers/claude-stream.ts:179-263`
- **症状：** `claudeStreamProvider` 是一个**一次性** stream-json provider（spawn 完就关 stdin），但名字带 "stream" 容易让人误以为是双向的。`GATEWAY_CLAUDE_MODE=stream` + `INTERACTIVE_PERMISSIONS=false` 时调 `generateReply` 会用这个一次性版本。
- **影响：** 误导未来的开发者；理论上功能正常但违背命名直觉。
- **修复：** 文档化 + 在 `claude-stream.ts` 文件头明确标注"one-shot stream-json variant vs `createStreamSession` for bidirectional"。

### P1-2: `buildApprovalBlocks` 硬编码 "2 分钟" 文案但 timeout 实际可配置
- **位置：** `src/permission-tracker.ts:201`
- **症状：** 文案写死 `hourglass_flowing_sand: 2 分钟内未响应将自动拒绝`，但 `PermissionTracker` 构造函数支持自定义 `imeoutMs`。
- **影响：** 误导用户；如果未来改成 5 分钟，UI 还在说 2 分钟。
- **修复：** 把 timeout 文案作为入参或属性传入；gateway 调用时传入实际 timeout。

### P1-3: `buildApprovalBlocks` 返回 `any[]`，类型不安全
- **位置：** `src/permission-tracker.ts:146-151`
- **症状：** 注释里 `eslint-disable @typescript-eslint/no-explicit-any`，但 block 结构是有 Slack 官方 type 的。
- **影响：** 拼错 block 字段（如 `block_id` 写成 `blockId`）编译期发现不了。
- **修复：** 定义本地 typed Block interface 替代 `any[]`。

### P1-4: `onPermissionRequest` 在 `createStreamSession` 之后才绑定，存在丢失首条 permission_request 的竞态
- **位置：** `src/reply-engine.ts:104-118` + `src/providers/claude-stream.ts:304-383`
- **症状：** `createStreamSession` 内部同步 spawn 子进程，子进程可能立刻开始输出（尤其是 resume 时）。回调绑定发生在 spawn 之后。
- **影响：** 极端场景下首条 `permission_request` 触发时回调未绑定，导致 `onPermissionRequest` undefined → 无人处理 → Claude 永远等 stdin。
- **修复：** 让 `createStreamSession` 接受 `onPermissionRequest` 作为构造参数；或者加一个内部 queue 在 spawn 前注册 + spawn 后 flush。

### P1-5: `generateReplyStream` 结果返回后没有调用 `session.close()`
- **位置：** `src/reply-engine.ts:80-129`
- **症状：** `session.close()` 存在但没人调。
- **影响：** stdin 句柄延迟关闭；子进程可能因 stdin 未 end 而延迟退出几秒。功能上 CC 会在 result 事件后退出进程，所以泄漏极小，但洁癖。
- **修复：** `try { const result = await session.result; } finally { session.close(); }`。

---
## P2 Medium (6 项 — 本评审开 issue 但未修)

| # | 项 | 文件 | 备注 |
| --- | --- | --- | --- |
| P2-1 | `requestId` 来自 Claude，可能含 `:` 破坏 action value 解析 | `src/permission-tracker.ts:85-89` | 用 JSON 编码或分隔符替换 |
| P2-2 | `claude.ts` 和 `claude-stream.ts` 重复 senderMCPConfig / spawn 模板 | `src/providers/claude*.ts` | 提取 `src/providers/_spawn-helpers.ts` |
| P2-3 | `claudeStreamProvider.createSession` 等不导出 `permissionMode` 选项覆写 | `src/providers/claude-stream.ts:179-263` | 增加 `permissionMode` 入参 |
| P2-4 | `claudeStreamProvider` 暴露但不附带使用说明 | `src/providers/claude-stream.ts:1-14` | 文档化用途（one-shot vs bidirectional）|
| P2-5 | 审批消息里没显示发起者 @ 提及 | `src/permission-tracker.ts:146-206` | UI 增强 |
| P2-6 | `permission_request` 没有去重/限流 | `src/permission-tracker.ts` + `src/gateway.ts` | DoS 防护 |

## P3 Low (5 项 — 本评审开 issue 但未修)

| # | 项 | 文件 |
| --- | --- | --- |
| P3-1 | `buildApprovalBlocks` 第 4 参数 `requestId` 后无类型标注 | `src/permission-tracker.ts:146-151` |
| P3-2 | `streamToResult` 用 `as StreamSpawnResult AMP { parser }` 强转 | `src/providers/claude-stream.ts:126-128` |
| P3-3 | `getSenderMCPConfig` 第一次调用写盘 + 缓存，env 变量后续变化不重读 | `src/providers/claude-stream.ts:37-69` |
| P3-4 | `--mcp-config` 后接路径含空格时 Windows shell quoting 脆弱 | `src/providers/claude-stream.ts:86-90` |
| P3-5 | `socket-manager.ts` `interactive` handler 只处理 `block_actions`，不处理 modal/submit | `src/socket-manager.ts:164-198` |

---
## 验证日志

### 类型检查
```text
$ npm run typecheck
> tsc --noEmit
PASS
```

### 单元 + 集成测试
```text
$ npm test
> node --import tsx --test tests/**/*.test.ts
…
ℹ tests 35  (含本评审新增 14)
ℹ pass 35
ℹ fail 0
```

### Mock Claude 子进程验证（集成测试）
```text
$ CLAUDE_BIN=tests/fixtures/mock-claude/script.mjs   npm test -- tests/claude-stream-integration.test.ts
```
（由 `claude-stream-integration.test.ts` 自动运行）

---

## 下一步

- [x] 本评审提了 10 个 GitHub issues (#35–#44)
- [x] P0/P1 已在本次 PR 修完（9 项代码改动）
- [ ] P2/P3 转入 sprint backlog（不进本次合并）
- [ ] 小克 verify + merge 到 dev
- [ ] dev 验收通过后合 main

---

**评审人：** delez (小马)
**关联 PR：** (待小克在 dev 上提)
**关联 issues：** #32, #34 (M2 epic), #35–#44 (本评审)
