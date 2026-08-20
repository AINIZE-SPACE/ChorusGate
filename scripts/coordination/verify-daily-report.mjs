#!/usr/bin/env node
// verify-daily-report.mjs — 投递校验（#149 关键加固）
// 用法: node scripts/coordination/verify-daily-report.mjs [yyyy-MM-dd]
// 检查 3 个频道在今天是否出现了含 "站会" 且带日期的日报消息。
// 全部命中 → exit 0；任一缺失 → exit 1 并打印缺失频道（供定时任务重试/报警）。
//
// 目的：定时任务 exit 0 != 已投递（codex daily-standup.ps1 曾静默成功但频道无日报），
// 这里用 Slack Web API 实证核对，杜绝"看起来成功、实际没发"。

import { WebClient } from '@slack/web-api';

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.error('SLACK_BOT_TOKEN not set (load ~/.chorusgate/claude/.env first)');
  process.exit(2);
}

const CHANNELS = {
  C0BLZ8KD8DD: 'zgos-ip-sprint3',
  C0BMEKM8YLA: 'chorusgate-sprint5',
  C0BMCL6GTUN: 'aifitness-sprint1',
};

const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const web = new WebClient(token);
// 小克 bot 用户（post 时 m.user 为该 ID）；可用 SLACK_APP_USER_ID 覆盖
const botUser = process.env.SLACK_APP_USER_ID ?? 'U0B8VHLHJAX';

let allDelivered = true;
for (const [channel, name] of Object.entries(CHANNELS)) {
  let found = false;
  try {
    const res = await web.conversations.history({ channel, limit: 50 });
    found = (res.messages ?? []).some(
      (m) =>
        !m.subtype &&
        (m.text ?? '').includes('站会') &&
        (m.text ?? '').includes(today) &&
        // 只认小克自己的 bot 日报，避免把小龙/小马的站会算成小克已投递
        m.user === botUser,
    );
  } catch (err) {
    console.error(`[${name}] history fetch failed: ${err?.data?.error ?? err.message}`);
    found = false;
  }
  if (found) {
    console.log(`[ok] ${name} (${channel}) has standup for ${today}`);
  } else {
    console.error(`[MISSING] ${name} (${channel}) — no standup for ${today}`);
    allDelivered = false;
  }
}

process.exit(allDelivered ? 0 : 1);
