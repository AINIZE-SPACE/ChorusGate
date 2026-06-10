// Diagnostic: report the bot token's granted OAuth scopes (from the
// x-oauth-scopes response header) so we can see if event scopes are present.
import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(here, "..", ".env") });

const res = await fetch("https://slack.com/api/auth.test", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
});

const body = await res.json();
console.log("auth.test ok:", body.ok, "| team:", body.team, "| user:", body.user);
console.log("granted scopes:", res.headers.get("x-oauth-scopes"));

const needed = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "reactions:read",
  "chat:write",
];
const have = (res.headers.get("x-oauth-scopes") || "").split(",").map((s) => s.trim());
console.log("\nrequired event scopes:");
for (const s of needed) {
  console.log(`  ${have.includes(s) ? "✅" : "❌ MISSING"}  ${s}`);
}
