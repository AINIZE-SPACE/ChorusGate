# Issue Tracking - chorusgate M2 Code Review (delez / 小马)

**Generated:** 2026-06-13
**Branch:** 
**Reviewer:** delez (小马)
**Review Doc:** [REVIEW-v3-2026-06-13-delez.md](./REVIEW-v3-2026-06-13-delez.md)
**关联 Epic:** #32, #34 (M2 Claude stream-json)

---

## 概要

| 严重 | 发现 | 已修 | 待修 (本 PR) | 转 backlog |
| --- | ---: | ---: | ---: | ---: |
| P0 Critical | 4 | 4 | 0 | 0 |
| P1 High | 5 | 5 | 0 | 0 |
| P2 Medium | 6 | 0 | 0 | 6 |
| P3 Low | 5 | 0 | 0 | 5 |
| **总计** | **20** | **9** | **0** | **11** |

P0/P1 共 9 项修复已记录在评审 doc，对应代码改动全部由小克在本 PR 内完成。
P2/P3 共 11 项转入 sprint backlog，issue 仍在 GitHub 跟踪。

---

## 本 PR 待修 — 9 项 P0/P1 (全部由小克执行)

### P0-1:  永远用  而非 
- **文件：** 
- **修法：** 区分 （opts.sessionId 为空时预生成）和 （opts.sessionId 已传时）。参考 。
- **测试：**  (新建) — mock claude 二进制验证 args 包含正确的 flag。
- **优先级：** P0 — M2 验收硬卡

### P0-2: 审批消息按钮 resolve 后仍可点击
- **文件：** 
- **修法：** gateway 在  返回 true 时，调用  把原 message 的 blocks 替换为"Approved/Denied by <@user> at <time>"。需要先存  + 。
- **测试：** 扩展  — mock web client，验证 chat.update 被调用。
- **优先级：** P0

### P0-3: 任何频道成员都能审批别人的工具调用
- **文件：**  (handleAction) +  (block action handler)
- **修法：** button value 改为 （发起者 user_id）。 返回 {granted, requester}。gateway 校验 ，不匹配则忽略 + 日志。
- **测试：** 新加 case — 非发起者点击被拒绝。
- **优先级：** P0 — 安全

### P0-4: 缺失 4 类关键测试覆盖
- **新增文件：**
  -  — 假 claude 进程 (Node 脚本)
  -  — spawn mock claude, 验证双向流
  -  — block_actions handler 单测
  -  —  路由
  -  扩展：发起者鉴权 + 消息回写
- **优先级：** P0

### P1-1:  一次性 vs  双向命名歧义
- **文件：**  (文件头)
- **修法：** 加详细注释 + 文档化"legacy one-shot variant, use  for bidirectional"。
- **测试：** 无需
- **优先级：** P1

### P1-2:  硬编码 "2 分钟" 文案
- **文件：** 
- **修法：** 加  入参，文案动态生成：。
- **测试：** 扩展 。
- **优先级：** P1

### P1-3:  返回 
- **文件：** 
- **修法：** 定义本地  interface（或引用 ），去掉  和 。
- **测试：** typecheck 即可验证
- **优先级：** P1

### P1-4:  在  之后才绑定的竞态
- **文件：**  + 
- **修法：**  增加  构造参数；或者内部用 queue：spawn 前注册回调，spawn 后 flush 已收到的 permission_request。
- **测试：** 集成测试 — mock claude 立刻 emit permission_request，验证回调被触发。
- **优先级：** P1

### P1-5:  结果返回后没有调用 
- **文件：** 
- **修法：** 
- **测试：** 验证 child stdin 被 end
- **优先级：** P1

---

## P2/P3 Backlog (本 PR 不修，转 sprint 后续)

详细见 REVIEW doc P2/P3 章节。issue 编号待 GitHub 创建后回填：

- P2-1:  含  破坏 action value 解析
- P2-2:  /  spawn 模板重复
- P2-3:  不导出  覆写
- P2-4:  文档化
- P2-5: 审批消息里没显示发起者 @ 提及
- P2-6:  没有去重/限流
- P3-1:  第 4 参数类型标注
- P3-2:  强转 parser
- P3-3:  缓存 env 不重读
- P3-4: Windows shell quoting 脆弱
- P3-5:  handler 不处理 modal/submit

---

## 验证步骤 (小克改完自验)

1.  — 必须 0 error
2.  — 必须全绿 (当前 21 个 + 新增 14 个 = 35 个)
3. **手动验证 spawn 双向流：**
   
4. **真实网络审批往返** — 跑 gateway 实际触发一个 Bash 权限请求，确认：
   - Slack 出现 Approve/Deny 按钮
   - 点击 Approve → message 变成"Approved by @you"
   - Claude 继续执行

---

## Reviewer Sign-off

- [x] P0/P1 修复方案已对齐小克
- [ ] 小克 verify 通过后由 delez 二次验收
- [ ] 合并到 dev → main

---

**Reviewer:** delez (小马)
**生成时间：** 2026-06-13
