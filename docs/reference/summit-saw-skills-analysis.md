# Summit-Saw Reflection Skill Evolution — 参考分析

> 来源: https://github.com/AINIZE-SPACE/summit-saw/tree/main/skills/base/reflection-skill-evolution
> 分析日期: 2026-06-13

## 核心模式

### 8 步反思工作流

1. **Frame** — 识别工作目标，区分一次性事实 vs 可复用知识
2. **Search** — 先搜索已有技能（base → adapter → project-local）
3. **Classify** — 四类落点：base / agent-adapter / project-local / defer
4. **Choose smallest change** — 更新已有技能优先，避免"大杂烩"技能
5. **Update base first** — 通用决策规则、工作流、清单放 base
6. **Update adapter** — agent 特定语法、路径、约束放 adapter
7. **Install at right scope** — project-incubating → personal → team → org
8. **Record evidence** — issue ID、PR、session ID 作为证据

### 分类决策表

| 发现 | 落点 |
|------|------|
| 评审、调试、发布、规划的更好顺序 | `skills/base` |
| Codex 特定的响应指令 | `skills/agents/codex` |
| Claude Code 命令元数据 | `skills/agents/claude-code` |
| 仓库特定的部署路径 | project-local skill |
| 单次未验证的轶事 | defer |

### Quality Bar

- 比原始 session 更短
- 能改变未来行为
- 命名何时用、何时不用
- 分离 base 逻辑和 adapter 机制
- 不需要读原始 session 就能理解

## 对我们项目的映射

| summit-saw 概念 | slack4ccmcp 对应 |
|----------------|-----------------|
| `skills/base` | `docs/planning/` — 通用规划文档 |
| `skills/agents/claude-code` | `src/providers/claude.ts` + `claude-stream.ts` |
| `skills/agents/codex` | `src/providers/codex.ts` |
| project-local | `docs/` 根目录已实现功能文档 |
| evidence | GitHub Issues + commit messages |
| dream mechanism | 迭代结束后的记忆写入（memory/*.md） |
| scope promotion | `docs/planning/` → `docs/`（规划→已实现） |

## 通知模板增强

基于 summit-saw 的"通知下游"模式，我们也需要标准化的 channel 通知：

| 事件 | 模板 |
|------|------|
| 新 Story 开始 | Story 编号 + 分支 + 设计文档链接 + 依赖 |
| 代码待 Review | Issue + 分支 + 文件清单 + 评审要点 + 测试要点 |
| Review 通过 | ✅ + 关闭 Issue |
| 测试请求 | 测试要点 + 环境变量 + 预期行为 |
| 发布 | PR 链接 + 变更摘要 |
