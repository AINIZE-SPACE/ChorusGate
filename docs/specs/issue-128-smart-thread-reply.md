# Spec: #128 channel thread 中无 mention 时智能判断是否处理

> **Issue**: [#128](https://github.com/AINIZE-SPACE/ChorusGate/issues/128)
> **Type**: Epic / P1 / Story
> **Analyst**: 小马
> **Date**: 2026-07-17

## 1. 问题分析

### 1.1 需求描述

在 channel thread 中：
- 当前只有 `app_mention` 和 DM(`im`) 触发回复
- `message` 类型（非 mention）在 channel 中被 `shouldReply()` 直接忽略
- 需求：在 thread 中即使没有 @mention，也判断是否需要处理

### 1.2 当前代码行为

**文件**: `src/gateway.ts` L124-145

```typescript
function shouldReply(event: StoredEvent): boolean {
  if (event.subtype) return false;
  if (!event.user || BOT_USER_IDS.has(event.user)) return false;
  if (!cleanText(event.text || "")) return false;

  // 只有 app_mention 触发
  if (event.type === "app_mention") return true;

  // 只有 DM 触发
  if (event.type === "message") {
    const channelType = (event.raw)?.channel_type;
    if (channelType === "im") return true;
  }

  return false;  // <-- channel 中的普通消息直接跳过
}
```

### 1.3 需求细化

根据 issue 描述，需要三层判断：

1. **自己的主消息且没有 mention 其它人 → 回复**
   - bot 自己发的消息（如进度更新）在 thread 里产生了新消息
   - 如果这条消息没有 @mention 其它 agent，说明是给自己的
   
2. **消息中包含自己的名字 → 回复**
   - 用户在 thread 里说 "小扣，你看看这个" 但没 @mention
   - 通过名字匹配检测

3. **让 LLM 判断是否回复**
   - 最终兜底：把消息发给 LLM，让它判断是否与 bot 相关
   - 避免误判和漏判

## 2. 设计方案

### 2.1 多级判断管道

```
消息到达
  │
  ├─ Level 1: 硬过滤（保持现有逻辑）
  │   ├─ subtype → skip
  │   ├─ bot self → skip
  │   ├─ empty text → skip
  │   └─ app_mention → ✅ reply
  │
  ├─ Level 2: DM（保持现有逻辑）
  │   └─ channel_type=im → ✅ reply
  │
  ├─ Level 3: Thread 上下文判断（新增）
  │   ├─ 只对 thread_ts 存在的消息生效
  │   ├─ 条件 A: 消息没有 mention 其他 bot → 可能相关
  │   ├─ 条件 B: 消息文本包含自己的名字 → ✅ reply
  │   └─ 条件 C: 消息回复的是 bot 自己的消息 → ✅ reply
  │
  └─ Level 4: LLM 判断（可选，高级）
      └─ 轻量 LLM 调用判断"这条消息是否与我相关"
```

### 2.2 实现细节

#### 2.2.1 名字匹配 (Level 3B)

```typescript
// 每个 profile 维护一组触发词
interface ProfileTriggers {
  botUserId: string;          // bot 的 Slack user ID
  displayName: string;        // "小扣" / "小克"
  aliases: string[];          // ["CX", "codex"] / ["CC", "claude"]
}

function mentionsMyName(event: StoredEvent, triggers: ProfileTriggers): boolean {
  const text = (event.text || "").toLowerCase();
  if (text.includes(`<@${triggers.botUserId}>`)) return true; // 显式 mention
  for (const alias of [triggers.displayName, ...triggers.aliases]) {
    if (text.includes(alias.toLowerCase())) return true;
  }
  return false;
}
```

#### 2.2.2 Thread 上下文检查 (Level 3A/C)

```typescript
async function isThreadRelevantToBot(
  event: StoredEvent,
  botUserId: string,
): Promise<boolean> {
  // 条件 C: 如果 thread 的 parent message 是 bot 自己发的
  if (event.thread_ts && event.thread_ts !== event.ts) {
    try {
      const web = getWebClient();
      const res = await web.conversations.replies({
        channel: event.channel,
        ts: event.thread_ts,
        limit: 1,
      });
      const parent = res.messages?.[0];
      if (parent?.user === botUserId) return true;
    } catch { /* ignore */ }
  }

  // 条件 A: 消息中没有 mention 其他 bot
  const otherBotMentions = Array.from(BOT_USER_IDS)
    .filter(id => id !== botUserId)
    .some(id => (event.text || "").includes(`<@${id}>`));
  if (!otherBotMentions && isInThreadWithBot(event, botUserId)) return true;

  return false;
}
```

#### 2.2.3 LLM 判断 (Level 4, 可选)

当 Level 3 都不满足时，用轻量 LLM 调用做最终判断：

```typescript
async function llmShouldReply(
  event: StoredEvent,
  botDisplayName: string,
): Promise<boolean> {
  const prompt = `You are ${botDisplayName}. Read this Slack message and decide 
  if it's directed at you or relevant to your current task. 
  Reply ONLY "YES" or "NO".\n\nMessage: "${event.text}"`;
  
  // 用最小模型快速判断
  const result = await quickLlmCall(prompt);
  return result.trim().toUpperCase() === "YES";
}
```

### 2.3 shouldReply 改造

```typescript
// 从同步改为异步
async function shouldReplyAsync(
  event: StoredEvent, 
  profileId: string,
): Promise<boolean> {
  // Level 1: 硬过滤
  if (event.subtype) return false;
  if (!event.user || BOT_USER_IDS.has(event.user)) return false;
  if (!cleanText(event.text || "")) return false;
  if (event.type === "app_mention") return true;

  // Level 2: DM
  const channelType = (event.raw)?.channel_type;
  if (event.type === "message" && channelType === "im") return true;

  // Level 3: Thread context (only in channels, not DMs)
  if (channelType !== "im" && process.env.GATEWAY_THREAD_SMART_REPLY !== "0") {
    const botUserId = getSocketManager().getBotUserId(profileId);
    if (!botUserId) return false;

    // 3B: 名字匹配
    const triggers = getProfileTriggers(profileId);
    if (mentionsMyName(event, triggers)) return true;

    // 3C: thread parent 是自己
    if (await isThreadRelevantToBot(event, botUserId)) return true;

    // Level 4: LLM 判断（可配置开关）
    if (process.env.GATEWAY_LLM_REPLY_JUDGE === "1") {
      return await llmShouldReply(event, triggers.displayName);
    }
  }

  return false;
}
```

### 2.4 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `GATEWAY_THREAD_SMART_REPLY` | `1` | 开启 thread 智能判断 |
| `GATEWAY_LLM_REPLY_JUDGE` | `0` | 开启 LLM 判断（消耗 token） |

Profile 触发词通过环境变量配置:
```
GATEWAY_PROFILE_TRIGGERS_CX=小扣,CX,codex
GATEWAY_PROFILE_TRIGGERS_CC=小克,CC,claude
```

### 2.5 风险分析

| 风险 | 影响 | 缓解 |
|------|------|------|
| 名字误匹配（如"小扣"出现在普通对话中） | 不必要的回复 | LLM 判断兜底 |
| LLM 判断延迟（1-3s） | 用户等待 | 默认关闭，仅 Level 3 开启 |
| Thread API 调用增加 rate limit 压力 | Slack API 限流 | 缓存 thread parent 信息 |
| 自己发的消息触发自回复 | 无限循环 | BOT_USER_IDS 检查 + 新增 self-profile 过滤 |

### 2.6 验收标准

- [ ] Thread 中有人说 bot 名字（无 @mention），bot 能回复
- [ ] Thread parent 是 bot 的消息，后续消息能触发回复
- [ ] Thread 中 @mention 了其他 bot 的消息不会触发回复
- [ ] 普通频道闲聊不会误触发
- [ ] `npm run build` 通过
- [ ] 现有 app_mention / DM 行为不变

## 3. 优先级

**P1** - 提升协作自然度，减少必须 @mention 的摩擦。建议分两期：
- **Phase 1**: Level 3（名字 + thread context）
- **Phase 2**: Level 4（LLM 判断，需评估 token 成本）
