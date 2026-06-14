// ============================================================
// diagnose-mention.mjs — 诊断 Slack API mention 通知问题
//
// 测试: Bot 通过 API 发 <@USER_ID> 时，Slack UI 能识别 mention
//      （hover 显示 profile card），但对方收不到通知。
//
// 用法: node scripts/diagnose-mention.mjs
//
// 输出: 实际 API payload、响应、以及诊断建议。
// ============================================================

import { WebClient } from "@slack/web-api";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Load .env
const envPath = resolve(projectRoot, ".env");
try {
  const envContent = readFileSync(envPath, "utf8");
  config({ path: envPath });
} catch {
  console.error("WARNING: .env not found at", envPath);
}

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("FATAL: SLACK_BOT_TOKEN not set");
  process.exit(1);
}

// ---- 测试目标 ----
const TEST_CHANNEL = process.argv[2] || "C0BAB3Y7LLC"; // #agent-channel-gateway
const TEST_USER = process.argv[3] || "U0B91BVKTL2";     // 小马

async function main() {
  const web = new WebClient(BOT_TOKEN);

  // 1. 检查 bot 身份
  console.log("=== 1. Bot 身份 ===");
  try {
    const auth = await web.auth.test();
    console.log("Bot user_id:", auth.user_id);
    console.log("Bot team:", auth.team);
    console.log("Bot user (full):", JSON.stringify(auth, null, 2));
  } catch (err) {
    console.error("auth.test 失败:", err.message);
  }

  // 2. 检查 bot scopes
  console.log("\n=== 2. 验证 bot 能否读取用户信息 ===");
  try {
    const userInfo = await web.users.info({ user: TEST_USER });
    console.log("✅ users:read scope 正常");
    console.log("用户信息:", JSON.stringify(userInfo.user, null, 2).slice(0, 500));
  } catch (err) {
    console.error("❌ users:read 失败:", err.message);
    console.error("→ 这可能是通知失败的根本原因！bot 需要 users:read scope");
  }

  // 3. 发送测试消息（多种 mention 格式）
  console.log("\n=== 3. 发送测试消息 ===");

  const tests = [
    {
      label: "<@USER_ID> 单独一行",
      text: `<@${TEST_USER}>`,
    },
    {
      label: "<@USER_ID> 消息开头",
      text: `<@${TEST_USER}> 这是一条测试消息。如果你收到通知，请回复确认。`,
    },
    {
      label: "<@USER_ID> 带粗体",
      text: `*测试通知* — <@${TEST_USER}> 请确认收到。`,
    },
  ];

  for (const t of tests) {
    try {
      const result = await web.chat.postMessage({
        channel: TEST_CHANNEL,
        text: t.text,
        unfurl_links: false,
      });
      console.log(`✅ [${t.label}] ts=${result.ts}`);
      console.log(`   text: ${JSON.stringify(t.text)}`);
    } catch (err) {
      console.error(`❌ [${t.label}]:`, err.message);
    }
    // 间隔避免 rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  // 4. 诊断结论
  console.log("\n=== 4. 诊断结论 ===");
  console.log("如果上面消息在 Slack 中 hover 能看到 profile card 但没通知:");
  console.log("");
  console.log("可能原因 1: Bot token 发送的 mention 不触发推送通知");
  console.log("  → Slack 的设计: Bot mention 只在以下情况触发通知:");
  console.log("    a) 用户已在该频道活跃");
  console.log("    b) Bot 使用了 users:read + chat:write.customize scopes");
  console.log("    c) 消息在 thread 中 @用户（thread 中的 mention 表现不同）");
  console.log("");
  console.log("可能原因 2: 需要 User Token 而非 Bot Token 发消息");
  console.log("  → 用 user token (xoxp-...) 发的 mention 行为与人工输入一致");
  console.log("  → Bot token (xoxb-...) 的 mention 可能被降级为 '软 mention'");
  console.log("");
  console.log("可能原因 3: Slack workspace 设置");
  console.log("  → 检查 workspace 的 notification 设置");
  console.log("  → 检查用户是否 mute 了该频道");
  console.log("");
  console.log("建议验证:");
  console.log("  1. 用 user token (xoxp-...) 发同样格式的消息 → 看是否有通知");
  console.log("  2. 在 DM 频道 (D0B93701YD7) 中发 <@U0B91BVKTL2> → 看是否有通知");
  console.log("  3. 检查 Slack App 的 OAuth scopes 是否包含 users:read.email");
}

main().catch((err) => {
  console.error("诊断脚本失败:", err);
  process.exit(1);
});
