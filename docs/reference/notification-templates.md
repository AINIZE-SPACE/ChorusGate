# Channel 通知模板

> 基于 summit-saw reflection-skill-evolution 的通知下游模式
> Slack 标准 mention 语法: `<@USER_ID>` 个人, `<!channel>` 频道全员, `<!here>` 在线成员

## 项目频道

| 名称 | ID | 用途 |
|------|-----|------|
| #agent-channel-gateway | C0BAB3Y7LLC | 开发协作主频道 |

## 项目成员

| 名称 | 成员 ID | DM 频道 ID | 角色 |
|------|---------|-----------|------|
| 小克 | U0B8VHLHJAX | D0B8LES3QUX | 设计 + 开发 |
| 小马 | U0B91BVKTL2 | D0B93701YD7 | 评审 + 测试 |

---

## 模板 1: 代码待 Review

> 在 #agent-channel-gateway 发送，@ 小马

```
<@U0B91BVKTL2> **STORY-{N}: {标题} 待 Review**

**Git Issue**: {issue_url}
**设计文档**: `docs/planning/{story-doc}.md`
**分支**: `v3/{branch-name}`

**代码清单**:
- `src/{file1}` ({lines}行, {新建/修改}) — {说明}
- `src/{file2}` ({lines}行, {新建/修改}) — {说明}

**Review 要点**:
1. {要点1}
2. {要点2}

**测试要点**:
1. {测试1}
2. {测试2}
```

### 示例

```
<@U0B91BVKTL2> **STORY-8: Claude 双向 stream-json Provider 待 Review**

**Git Issue**: https://github.com/AINIZE-SPACE/slack4ccmcp/issues/34
**设计文档**: `docs/planning/v3-story-8-claude-stream-json.md`
**分支**: `v3/story-8-claude-stream-json`

**代码清单**:
- `src/providers/claude-stream-parser.ts` (128行, 新建) — 双向 JSONL 解析器
- `src/providers/claude-stream.ts` (258行, 新建) — ClaudeStreamProvider

**Review 要点**:
1. permission_request 格式: request_id 字段是否正确？
2. stdin 审批响应格式: permission_response 是否正确？

**测试要点**:
1. GATEWAY_CLAUDE_MODE=legacy 默认行为不变
2. GATEWAY_CLAUDE_MODE=stream 切换到新 provider
```

---

## 模板 2: Review 通过 / 需要修改

```
<@U0B8VHLHJAX> **STORY-{N} Review 结果**

✅ 通过 → 合并到 dev，关闭 #{issue}
或
❌ 需修改 → 见下方评论

{具体反馈}
```

---

## 模板 3: 测试请求

```
<@U0B91BVKTL2> **STORY-{N}: 测试请求**

**分支**: `v3/{branch}` (已合并到 dev)
**环境变量**:
```
GATEWAY_CLAUDE_MODE=stream
GATEWAY_REPLY_TIMEOUT_MS=900000
```

**测试要点**:
1. {测试项1} — 预期: {预期行为}
2. {测试项2} — 预期: {预期行为}

**验证命令**:
```bash
slack-gateway restart
tail -f .gateway/gateway.log
```
```

---

## 模板 4: 发布通知

```
<!channel> **slack4ccmcp v{version} 发布**

**PR**: {pr_url}
**变更**:
- {变更1}
- {变更2}

**升级**:
```bash
git checkout dev && git pull
npm install && npm link
slack-gateway restart
```
```
