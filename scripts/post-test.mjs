// One-off: post a test app_mention to #aifitness using tokens from .env.
// Used to verify the Socket Mode server receives events in real time.
import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebClient } from "@slack/web-api";

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(here, "..", ".env") });

const web = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL = "C0B8V9LV8CT"; // #aifitness
const BOT = "U0B8VHLHJAX"; // ChorusGate

const res = await web.chat.postMessage({
  channel: CHANNEL,
  text: `<@${BOT}> socket mode 端到端测试 — 验证实时事件接收 (${process.argv[2] ?? ""})`,
});
console.log("posted:", res.ok, res.ts);
