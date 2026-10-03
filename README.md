# ChorusGate

**本地协调边界（Local Coordination Boundary）**：连接 Channels、Gateway 与数字员工运行时（digital-employee runtimes）的控制平面制度试验田。

> 本项目不是通用“硅基组织控制面”、HR/绩效平台、知识库、IAM 层或调度器/运行时的替代品。运行时的推理、记忆、调度、工具与副作用仍由运行时自身持有。

## V10 语境

- **独立网关阶段**已于 **2026-08-26** 关闭，标签 [`gateway-final`](https://github.com/AINIZE-SPACE/ChorusGate/releases/tag/gateway-final) 与分支 `gateway-final` 是最终完整网关快照。
- **Hermes** = 躯壳与神经系统；**GBrain** = 人格与记忆；**acpx** = 神经总线；**ChorusGate** = 本地协调边界与控制平面制度试验田。
- `main` 当前仅保留 **V10 观察面**（`src/v10/`）：只读 fixture 投影与本地 Web 服务，不连接 Slack、Soul、gbrain、agents_memory、mem0 或生产运行时。

## 核心循环六环

```text
Event -> WakePolicy -> TaskEnvelope -> HarnessAdapter -> Completion -> Attention/Delivery
```

1. **Event**：来自 Slack 等 Channel 的归一化事件。
2. **WakePolicy**：决定是否唤醒一次任务。
3. **TaskEnvelope**：把任务封装为带权威、范围、验收标准的信封。
4. **HarnessAdapter**：在选定运行时的隔离边界内执行任务。
5. **Completion**：记录终端完成状态与证据收据。
6. **Attention/Delivery**：把结果递交给正确的人或 Channel。

## 目录结构

```text
src/v10/
  types.ts            # HRS 观察面类型
  fixture-adapter.ts  # 确定性 fixture 运行时记录
  employee-view.ts    # adapter -> Web API 投影
  web-page.ts         # HTML 页面渲染
  web-server.ts       # 本地 HTTP 服务
tests/
  v10-web.test.ts     # 转换与 HTTP 验收测试
  test-env.mjs        # 测试环境预加载
docs/
  planning/iteration-10-sdd/   # V10 SDD 包
  architecture-v10.md          # V10 架构定位
  design-iteration-10.md       # 迭代 10 设计导航
  code-framework.md            # 代码框架说明
  README.md                    # 本文档导航
package.json
  build / typecheck / test / v10:web
```

## 快速开始

```bash
npm install
npm run build     # tsc --noEmit
npm test          # 实测数字见下方
npm run v10:web   # 默认 http://127.0.0.1:4310
```

最近一次清理后的测试基线：

```text
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ duration_ms 1194
```

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/architecture-v10.md`](docs/architecture-v10.md) | V10 架构定位、边界与模块关系 |
| [`docs/design-iteration-10.md`](docs/design-iteration-10.md) | 迭代 10 SDD 导航、门禁状态、任务与未决问题 |
| [`docs/code-framework.md`](docs/code-framework.md) | 技术栈、`src/v10/` 模块地图、构建与测试基线 |
| [`docs/planning/iteration-10-sdd/`](docs/planning/iteration-10-sdd/) | SDD 包（intent/constitution/spec/plan/tasks/review-g0/review-g1） |

> pre-V10 历史文档与旧网关完整实现：见 tag/分支 [`gateway-final`](https://github.com/AINIZE-SPACE/ChorusGate/releases/tag/gateway-final)。

## 迭代状态

- **G0 SDD 完整性**：`PASS`（`review-g0.md`，2026-09-30）
- **G1 范围/契约评审**：`CONDITIONAL PASS`（`review-g1.md`，2026-10-02）
- **G2-G4**：`PENDING`，待 小马 提供 C1 适配器探针证据、小龙 提供运维约束、小扣 审批 ADR-0001。
- **外部跟踪**：`PENDING / NOT EXECUTED`，未创建或修改 Trello/GitHub Issue。

## License

MIT
