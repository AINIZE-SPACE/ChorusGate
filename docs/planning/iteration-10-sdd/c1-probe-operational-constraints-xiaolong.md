# C1 Probe — Operational Constraints（小龙落档）

> **用途**: I10 review-g1.md:68-72 前置输入（B1），CG-I10-002 capability-spike 的准入条件之一。
> **作者**: 小龙 · **日期**: 2026-10-13 · **来源**: chorus-v10 站会 2026-10-13；review-g1.md Conditions §1。
> **性质**: 运维约束输入，非探针结果、非评审结论。探针本体归 CG-I10-002（小马）。

## 0. 对象与范围

本文件为 **C1（opencode-via-acpx）探针**提供运维约束输入，覆盖 review-g1.md:68-72
要求的四个维度：机器可达/资源、网络出网限制、证据保留/隐私分类、media 工作是否在 scope。
范围以 I10 SDD（`docs/planning/iteration-10-sdd/`）为边界，不授权实现或集成。

## 1. 机器可达性与资源

- **探针执行环境**：C1 探针主体在 **小马侧**（zederer-mbe，Hermes Host+acpx 生产在用的执行器，
  g1-entry-runtime-candidates.md:11，9-13 三断言冒烟通过）；我机 ainize-media 仅作运维旁路与证据归档。
- **ainize-media（本机）**：macOS arm64、RAM 16GB、/opt/ainize 工作区磁盘余量充足
  （df 实测可用 ≥80GB）。opencode CLI 已装 **1.18.32**（`~/.local/bin/opencode` → `~/.opencode/bin/opencode`）。
- **acpx 可用性**：acpx **不在本机 PATH**（`which acpx` 无结果）；本机不承担 acpx 总线角色，
  探针的 acpx 侧以 小马 侧为准。
- **资源上限建议**：C1 探针为 CLI/ACP 轻量调用，建议**并发 ≤1**（隔离探针，杜绝与生产会话竞态）；
  前台执行超时 ≤600s，超限转后台跟踪（与 g1-entry §3 limits 一致）。
- **探针隔离**：使用独立目录 + 独立 session 命名空间，不触宿主 secrets / agents_memory / gbrain 数据
  （review-g1.md No-secret posture）。

## 2. 网络出网限制

- **GitHub 出口**：直连实测**不可达**（curl 8s 超时 000）；经 **http://127.0.0.1:7897 代理可达
  （200，~0.56s）**。本机 git 已配 repo 级 http/https proxy=7897；FlClash 兜底。
  → 探针如需 fetch/push GitHub，必须显式走 7897 代理；禁止依赖直连。
- **模型 API 出口**：模型经 newapi OpenAI-compatible 接入；API key **仅 env 注入 runner**，
  禁止落盘、入 payload、入 commit（review-g1.md No-secret posture；探针载荷零 secret）。
- **探针网络面**：仅允许探针所需的最小出网面（GitHub + 模型 API）；不做任意公网探测。

## 3. 证据保留 / 隐私分类

- **分类**：C1 探针证据属 **ChorusGate 内部规划材料**，与 agents_memory / gbrain / 生产数据严格隔离；
  不含 secrets、Soul、persona 记忆。
- **归档**：探针记录与产出**脱敏后**落 `docs/planning/`（能力-spike 记录 + 后续 ADR 引用点）；
  脱敏方法须在 evidence 中注明（review-g1.md:54-56）。
- **保留策略**：建议默认保留至 **I10 收口评审后**；最终保留/删除策略归 **小扣 FC-I10-02/04** 裁决，
  本文件不作终局。

## 4. media 工作是否在 scope

- **不在 scope**。I10 是 ChorusGate HRS 观察/协调切片（tasks.md CG-I10-006 scope），
  **不含媒体生产**。媒体生产（SadTalker/Wav2Lip/ffmpeg/OpenMontage 等）属 **C4 OpenClaw 平台能力**
  （我机 ainize-media），与 C1 探针域隔离。
- 若未来 I10-FR-01 意图覆盖媒体生产负载，需 **G1 明示扩权**并另行评审（g1-entry §2 选项丙注释），
  不因本文件生效。

## 5. 与 B4/B5 的联动

- FC-I10-02/04（证据保留/隐私分类 + 命名空间）最终决策在小扣；本文件 §3 提供运维侧输入，不越权定论。
- FC-I10-03（WakeAction-to-Attention 优先级）由小马复核 → 小扣决策，本文件不涉及。

## 结论

B1 运维约束输入**已齐**，满足 review-g1.md Conditions §1 的解锁条件；
CG-I10-002（小马）可在本文件 + G1 approval 基础上启动 capability-spike。
