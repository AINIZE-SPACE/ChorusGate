## 问题
修复 #59 / commit `6dc97bd` 加了 8 处 `link_names: true`，**没有任何测试验证这个行为**。

现状：
- `tests/` 下没有 `tests/send-message.test.ts`
- `tests/` 下没有 `tests/reply.test.ts`（`slack_reply` 工具）
- `tests/` 下没有 `tests/session-commands.test.ts`
- `tests/` 下没有 `tests/gateway-link-names.test.ts`

## 影响
- **回归无防护**：下次重构 `src/tools/reply.ts`、`src/gateway.ts`、`src/interrupt.ts` 时，没人阻止 dev 不小心把 `link_names: true` 删掉 / 改成 `link_names: false`。
- **#59 现象的根因测试缺失**：fix 修的是 `<@USER_ID>` 不触发推送，但没测试断言 `link_names: true` 真的被传给 `chat.postMessage`。一旦 Slack SDK 升级改了 `link_names` 的行为，没有测试会失败。
- **Issue 修法描述有测试要求**：本 issue 系列的修法里都列了"测试验证 `web.chat.postMessage` 被传入 `{ link_names: true }`" — 这条本身就是 P0/P1 fix 的验收条件。

## 修法
新增测试文件 `tests/link-names.test.ts`（或拆为 `tests/send-message-link-names.test.ts` + `tests/reply-link-names.test.ts`），用 `tests/interrupt.test.ts` 那套 `_setXForTests()` test seam 模式 mock 掉 `getWebClient()`，断言：

```typescript
const fakeWeb = {
  chat: {
    postMessage: async (args: any) => {
      // 断言
      assert.strictEqual(args.link_names, true);
      return { ok: true, ts: '1.0' };
    },
  },
};
_setWebClientForTests(() => fakeWeb);

// 调用 sendMessageTool.handler / replyTool.handler / handleCommand / interrupt
// 每个工具至少一个 case 验证 link_names: true 被传入
```

覆盖至少这 8 个 call sites：
1. `src/tools/send-message.ts:40`
2. `src/tools/reply.ts:42`
3. `src/session-commands.ts:129`
4. `src/interrupt.ts:139`
5. `src/gateway.ts:495`（heartbeat placeholder）
6. `src/gateway.ts:583`（permission request）
7. `src/gateway.ts:629`（plan tracker update）
8. `src/gateway.ts:668`（final reply）
9. `src/gateway.ts:695`（error path）

`gateway.ts` 的 5 个调用在 `processEvent` 内部，可用 `interrupt.test.ts` 那种"通过 `getWebClient` mock + 注入 fake event"的方式覆盖。

## 验收
- `npm test` 新增 ≥ 5 个 case，全部 pass
- 临时把 `link_names: true` 改成 `link_names: false` 后 `npm test` 失败
- 测试基线从 91 pass 涨到 ≥ 96 pass

## 关联
- Bug: #59
- Commit: `6dc97bd`
- 父 issue: P0-1 (reply.ts 漏 fix), P1-1 (scope 滥用)
- REVIEW: `docs/tests/REVIEW-MentionNotification-2026-06-14-xiaoma.md`
