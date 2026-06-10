// Attempt to add the `reaction_added` bot event + `reactions:read` scope
// programmatically via the Apps Manifest API, using whatever token works.
// Tries the app-level token (xapp-, has app_configurations:write) first.
import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(here, "..", ".env") });

const APP_ID = "A0B95EP9ER2";
const appToken = process.env.SLACK_APP_TOKEN;

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

console.log("--- apps.manifest.export (app token) ---");
const exp = await call("apps.manifest.export", appToken, { app_id: APP_ID });
console.log(JSON.stringify(exp, null, 2).slice(0, 1500));
