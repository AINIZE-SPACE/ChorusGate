// Diagnostic: connect via Socket Mode and log EVERY incoming frame
// (catch-all `slack_event`) plus specific event types. Lets us tell apart
// "socket receives nothing" (Slack Event Subscriptions off) from
// "receives but wrong type".
import { config as loadDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SocketModeClient, LogLevel } from "@slack/socket-mode";

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(here, "..", ".env") });

const client = new SocketModeClient({
  appToken: process.env.SLACK_APP_TOKEN,
  logLevel: LogLevel.DEBUG,
});

client.on("connected", () => console.log("PROBE: connected"));
client.on("ready", () => console.log("PROBE: ready — send a mention now"));

// Catch-all: fires for EVERY frame from Slack
client.on("slack_event", ({ type, body }) => {
  console.log(`PROBE slack_event >>> envelope type=${type}`);
  if (body?.event?.type) console.log(`   inner event type=${body.event.type}`);
});

client.on("app_mention", () => console.log("PROBE: app_mention handler fired"));
client.on("message", () => console.log("PROBE: message handler fired"));
client.on("reaction_added", () => console.log("PROBE: reaction_added handler fired"));

await client.start();
console.log("PROBE: started");
