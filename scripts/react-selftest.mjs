// Self-test: add a real emoji reaction (as the user) to a recent #aifitness
// message using SLACK_USER_TOKEN (xoxp-, has reactions:write). This fires a
// genuine reaction_added event so we can verify the MCP server receives it —
// without depending on a manual hover-and-click gesture.
import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(here, "..", ".env") });

const CHANNEL = "C0B8V9LV8CT"; // #aifitness
const userToken = process.env.SLACK_USER_TOKEN;
const botToken = process.env.SLACK_BOT_TOKEN;

if (!userToken) {
  console.error("ERROR: SLACK_USER_TOKEN (xoxp-...) not set in .env");
  process.exit(1);
}

async function call(method, token, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 1. Find a recent message to react to (use bot token for history read)
const hist = await call("conversations.history", botToken, { channel: CHANNEL, limit: 5 });
if (!hist.ok || !hist.messages?.length) {
  console.error("could not read channel history:", hist.error);
  process.exit(1);
}
const target = hist.messages.find((m) => m.ts) ?? hist.messages[0];
console.log("reacting to ts:", target.ts, "text:", (target.text || "").slice(0, 40));

// 2. Add a reaction as the user
const react = await call("reactions.add", userToken, {
  channel: CHANNEL,
  timestamp: target.ts,
  name: "white_check_mark",
});
console.log("reactions.add:", react.ok, react.ok ? "" : react.error);
