# 多 Agent 网关协作复盘（ChorusGate v3）

> **Domain**: dev / agent-gateway
> **来源项目**: ChorusGate (`E:/my_project/ainize/ChorusGate_Test`)
> **复盘日期**: 2026-06-16
> **适用**: 任何需要把多个 AI agent runtime 接入同一协作平面（Slack、Discord、Lark 等）的项目
>
> 本文件按 `reflection-skill-evolution` 分层规则从项目经验中抽取**可跨项目复用**的部分。ChorusGate 专用实现细节保留在项目技能中。

## 一、分层归属

| 知识 | 归属 | 位置 |
|------|------|------|
| ESM 环境变量早绑规范 | base / dev-domain | 见 [test-spawn-fake-binary.md](../../../summit-saw/domains/dev/test-spawn-fake-binary.md) + 项目技能 `chorusgate-env-vars` |
| 多 agent 流式统一抽象 | base / dev-domain | 本节 + 项目技能 `chorusgate-stream-adapter` |
| 审批与中断控制 | base / dev-domain | 本节 + 项目技能 `chorusgate-approval-interrupt` |
| 项目级交接流程 | project-local | `.agents/skills/sprint-handoff` |
| ChorusGate 具体 CLI flag / JSONL 字段 | agent-adapter | `chorusgate-stream-adapter` / `chorusgate-approval-interrupt` |
| Slack token、channel ID、profile 配置 | project-local | ChorusGate `profile-config.ts` / `.env` |

## 二、多 Agent 网关的通用模式

### 2.1 统一 Provider 抽象

把 gateway 与具体 agent runtime 解耦：

```
gateway
  鈫?AgentProvider 接口（createSession / resumeSession / generateMCPConfig）
    鈫?ClaudeProvider
    鈫?CodexProvider
    鈫?（未来）OpenClawProvider / GeminiProvider
```

**通用规则**:
- gateway 只依赖接口，不依赖 spawn 细节
- 每个 provider 负责自己的 CLI 调用、JSONL 解析、session ID 提取
- provider 通过回调（`onSpawn`, `onStreamUpdate`, `onSessionId`）把控制面交还 gateway

### 2.2 统一流式抽象

不同 agent 的输出粒度差异巨大：Claude 可到 token 级，Codex 只能到 item/turn 级。gateway 应消费统一事件：

| 通用事件 | 含义 | 展示策略 |
|----------|------|----------|
| `session_id` | 会话标识 | 内部记录 |
| `progress` | 粗略进度 | 更新状态文本 |
| `text` | 正文增量 | 追加到回复 buffer |
| `thinking` | reasoning 增量 | 可选折叠展示 |
| `tool_call` | 工具调用 | 显示“处理中” |
| `metrics` | token/cost | 最终消息脚注 |
| `done` | 流结束 | 刷新最终消息 |

**关键原则**: 缺失事件按“可选存在”处理，不能崩溃。

### 2.3 审批控制

任何把 agent 的权限请求透给用户 UI 的系统，都应满足：

1. **身份绑定**: 请求中编码 `requesterUserId`，响应前校验
2. **防重入**: 按钮点击后立即移除/替换按钮
3. **Scope 缓存**: once / session / always / deny 四级，且按用户 + profile 隔离
4. **kill + 清理**: interrupt 时必须杀进程并清理所有 timer

### 2.4 环境变量早绑

ESM 模块在 `import` 时立即求顶层 `const`。如果 `.env` 在 `bootstrap()` 之后加载，则：

```ts
// 坏：顶层 const 在 loadEnv 前求值
const BIN = process.env.BIN || "default";

// 好：使用点 inline 读取
function run() {
  const bin = process.env.BIN || "default";
}
```

这是跨项目通用问题，适用于任何 Node.js/ESM + dotenv 的项目。

### 2.5 测试 fake binary

spawn 外部 CLI 的测试应避免依赖真实 binary：

1. 用环境变量覆盖为明显不存在的字符串（如 `nonexistent-claude-binary-for-test`）
2. 在 `import` 被测模块前设置 env
3. `finally` 恢复原始值

详见 [test-spawn-fake-binary.md](../../../summit-saw/domains/dev/test-spawn-fake-binary.md)。

## 三、从 ChorusGate 提取的具体证据

| 问题 | 项目 Issue | 通用教训 |
|------|------------|----------|
| env var 顶层 const 反复出现 | #36 / #41 / P2-1 | 改前 rg、改后 rg、回归测试 |
| Claude/Codex 流式能力不对等 | #86 | 统一 `StreamUpdate` 接口，按可选存在降级 |
| 任何人可批准他人请求 | #36 | 审批必须绑定 requesterUserId |
| 审批按钮 resolve 后仍可点击 | P0-2 | 立即 `chat.update` 替换为确认文本 |
| 入口函数缺少集成测试 | #76 / #79 | 新增入口必须同时加 ST |
| Windows cmd 元字符注入 | #69 | spawn 参数转义不能照搬 Unix |

## 四、何时抽取到 domain

满足以下条件时，可把项目技能中的某条规则提升到这里：

1. 在 ChorusGate 已验证至少两次
2. 不依赖 ChorusGate 具体文件名、CLI flag、Slack app ID
3. 另一项目遇到同类问题时可直接套用

不满足的保留在项目技能或 agent-adapter。

## 五、相关文件

- `E:/my_project/ainize/ChorusGate_Test/.agents/skills/chorusgate-env-vars`
- `E:/my_project/ainize/ChorusGate_Test/.agents/skills/chorusgate-stream-adapter`
- `E:/my_project/ainize/ChorusGate_Test/.agents/skills/chorusgate-approval-interrupt`
- `E:/my_project/ainize/ChorusGate_Test/.agents/skills/sprint-handoff`
- `E:/my_project/ainize/ChorusGate_Test/docs/reports/sprint-3-retrospective-roles.md`
- `E:/my_project/ainize/summit-saw/skills/base/reflection-skill-evolution/SKILL.md`
- `E:/my_project/ainize/summit-saw/skills/base/skill-library-governance/SKILL.md`
