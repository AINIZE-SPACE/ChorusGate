# 代码框架说明

> 本文档概括 ChorusGate `main` 分支的 V10-only 代码组织、技术栈与命令。pre-V10 旧代码与文档见 tag `gateway-final`。

## 技术栈

- **语言**：TypeScript（ES Module，`"type": "module"`）
- **运行时/加载器**：Node.js 18+，`tsx`
- **测试框架**：`node:test` + `node:assert/strict`
- **类型检查**：`tsc --noEmit`
- **外部依赖**：`tsx`、`typescript`

## `src/v10/` 模块地图

| 文件 | 一句话职责 |
| --- | --- |
| `src/v10/types.ts` | HRS 观察面类型定义 |
| `src/v10/fixture-adapter.ts` | 确定性 fixture 运行时记录 |
| `src/v10/employee-view.ts` | adapter 数据 -> Web API 投影 |
| `src/v10/web-page.ts` | HTML 页面渲染 |
| `src/v10/web-server.ts` | 本地 HTTP 服务入口 |

## 测试

| 文件 | 说明 |
| --- | --- |
| `tests/v10-web.test.ts` | 转换与 HTTP 验收测试 |
| `tests/test-env.mjs` | 测试环境预加载 |

## 常用命令

```bash
npm run build   # tsc --noEmit
npm test        # node --import tsx --import ./tests/test-env.mjs --test ...
npm run v10:web # tsx src/v10/web-server.ts
```

## 历史

pre-V10 旧网关实现（src 网关核心/会话/Slack 协议/providers/bin/scripts）：见 tag `gateway-final`（35efd40c）。
