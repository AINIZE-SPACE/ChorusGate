// Add `reaction_added` to the app's bot_events (and ensure reactions:read
// scope) via the Apps Manifest API. Requires an App Configuration Token
// (xoxe-...) in .env as SLACK_CONFIG_TOKEN. Since reactions:read is already
// granted, adding the event typically takes effect without a reinstall.
import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(here, "..", ".env") });

const APP_ID = "A0B95EP9ER2";
const configToken = process.env.SLACK_CONFIG_TOKEN;

if (!configToken) {
  console.error("ERROR: SLACK_CONFIG_TOKEN not set in .env");
  console.error("Generate one at api.slack.com/apps → Your App Configuration Tokens");
  process.exit(1);
}

async function call(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${configToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 1. Export current manifest
const exp = await call("apps.manifest.export", { app_id: APP_ID });
if (!exp.ok) {
  console.error("export failed:", exp.error, exp.errors ?? "");
  process.exit(1);
}
const manifest = exp.manifest;

// 2. Ensure structures exist
manifest.settings ??= {};
manifest.settings.event_subscriptions ??= {};
const ev = manifest.settings.event_subscriptions;
ev.bot_events ??= [];
manifest.oauth_config ??= {};
manifest.oauth_config.scopes ??= {};
manifest.oauth_config.scopes.bot ??= [];

const beforeEvents = [...ev.bot_events];

// 3. Add reaction_added event + reactions:read scope if missing
if (!ev.bot_events.includes("reaction_added")) ev.bot_events.push("reaction_added");
if (!manifest.oauth_config.scopes.bot.includes("reactions:read")) {
  manifest.oauth_config.scopes.bot.push("reactions:read");
}

console.log("bot_events before:", beforeEvents);
console.log("bot_events after :", ev.bot_events);

// 4. Push updated manifest
const upd = await call("apps.manifest.update", { app_id: APP_ID, manifest });
if (!upd.ok) {
  console.error("update failed:", upd.error, JSON.stringify(upd.errors ?? ""));
  process.exit(1);
}
console.log("\n✅ manifest updated.");
console.log("permissions_updated:", upd.permissions_updated);
if (upd.permissions_updated) {
  console.log("⚠️ A reinstall IS required (new scope). Reinstall the app, then update SLACK_BOT_TOKEN in .env if it rotates.");
} else {
  console.log("No reinstall needed — reaction_added should deliver immediately.");
}
