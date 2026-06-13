# 工作流技能演进

> 基于 summit-saw reflection-skill-evolution 模式增强
> 将迭代中形成的流程编码为可复用技能

## 技能目录

```
skills/
  base/                     ← 通用工作流（跨 agent、跨项目）
    research-planning.md     — M0 Spike → 设计 → 评审 流程
    analysis-design.md       — 架构决策 + 设计文档模板
    development.md           — 分支策略 + commit 规范 + provider 模式
    review-test.md           — 评审清单 + 测试模板
    channel-notify.md        — Slack 通知模板 + mention 语法
    third-party-research.md  — 三方开源研究 → 建议 → 落地 模式
  agents/
    claude-code/             ← Claude Code 特定
      provider-pattern.md    — AgentProvider 实现模板
      stream-json.md         --input-format stream-json 协议
    codex/                   ← Codex 特定
      provider-pattern.md    — Codex CLI spawn 模板
      m0-spike.md           — codex exec --json fixture 固化
```

---

## 技能 1: 研究规划

### Trigger
- 新 feature/EPIC 开始
- 需要研究三方代码/文档
- 技术方案不确定

### Workflow
1. **M0 Spike** — 真实运行 CLI/API，固化 fixture
2. **三方研究** — 阅读源码 + 文档，输出参考分析
3. **EPIC 拆分** — STORY 粒度不超过 3 天工作量
4. **设计文档** — 先写 SPEC 再写代码
5. **评审** — 至少一轮设计评审，修复 P0 再开工

### 设计文档模板
```markdown
# STORY-N: {标题}

> 状态：规划中 | 依赖：STORY-X | P0/P1/P2

## 问题
## 方案
## M0 Spike (如适用)
## 实现清单
## 验收标准
```

### When NOT to use
- bug fix (不需要 EPIC)
- 文档修正 (直接 PR)
- 单文件小改动

---

## 技能 2: 分析设计

### Decision Record 模板

每个架构决策记录为一条记忆或文档段落：

```markdown
### N. {决策标题}

**决策**: {一句话}
**Why**: {原因}
**替代方案**: {考虑过但放弃的方案及原因}
**影响**: {哪些文件/模块受影响}
**跟踪**: #{issue}
```

### 评审清单

- [ ] CLI flag 是否真实存在（M0 验证）？
- [ ] JSON 字段名是否匹配真实输出？
- [ ] 遗留方案引用是否已清理？
- [ ] 单例是否需要拆分为 per-profile？
- [ ] token/配置是否 per-profile 注入？

---

## 技能 3: 开发

### 分支命名
```
v3/story-{N}-{kebab-description}
```

### Commit 规范
```
feat: STORY-N — {简短描述}

{变更清单}
跟踪: [#{issue}]

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Provider 实现模板
1. 先定义 AgentProvider 接口
2. 提取已有 provider (ClaudeProvider)
3. 新建 provider 实现同一接口
4. reply-engine 薄适配层
5. GATEWAY_*_MODE flag 切换

### When NOT to use provider pattern
- 不需要 spawn 外部进程的功能 → 直接写在 gateway
- 一次性的 script → `scripts/` 目录

---

## 技能 4: Channel 通知

### Slack Mention 语法
| 语法 | 效果 |
|------|------|
| `<@U0B91BVKTL2>` | @小马 (个人通知) |
| `<@U0B8VHLHJAX>` | @小克 (个人通知) |
| `<!channel>` | @channel (频道全员) |
| `<!here>` | @here (在线成员) |

### 通知时机
| 事件 | 模板 | 频道 |
|------|------|------|
| 新 Story 开始 | — | #agent-channel-gateway |
| 代码待 Review | 模板 1 | #agent-channel-gateway |
| Review 结果 | 模板 2 | #agent-channel-gateway |
| 测试请求 | 模板 3 | #agent-channel-gateway |
| 发布 | 模板 4 | #agent-channel-gateway |

详见 [notification-templates.md](./notification-templates.md)

---

## 技能 5: 三方开源研究

### Trigger
- 发现同类项目 (如 CC Pocket)
- 需要参考已有实现
- 技术方案需要外部验证

### Workflow
1. **Clone + 逐文件阅读** — 重点看 session/websocket/process 管理
2. **输出参考分析** — `docs/reference/{project}.md`
3. **映射到本项目** — 借鉴/改造/放弃 三类
4. **更新设计文档** — 补架构边界、新增 Story
5. **创建跟踪 Issue** — 防止丢失

### 分析维度
| 维度 | 问题 |
|------|------|
| 架构同构 | 和我们哪部分一样？ |
| 可直接借鉴 | 哪些模式可以直接用？ |
| 需要改造 | 哪些需要适配我们的环境？ |
| 明确放弃 | 哪些不适合我们？ |
| 生产验证 | 是否已生产使用？规模？ |

### 落地步骤
1. `docs/reference/{project}.md` — 参考分析文档
2. 更新 `docs/architecture.md` — 架构借鉴
3. 更新 `docs/planning/` — 新增/修改 Story
4. GitHub Issue — 跟踪借鉴决策
5. `ISSUES.md` 回填

---

## 质量门 (Quality Bar)

每个技能/文档产出应满足：
- [ ] 比原始 session/研究更短
- [ ] 能改变未来行为（不只是记录）
- [ ] 命名了何时用、何时不用
- [ ] 分离了 base 逻辑和 adapter 机制
- [ ] 不需要读原始上下文就能理解
