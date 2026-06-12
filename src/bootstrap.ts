// ============================================================
// Shared bootstrap — env loading + token validation + client init
//
// Both the MCP server (index.ts) and the gateway daemon (gateway.ts)
// need this exact sequence. Extracted to avoid duplication and ensure
// the token validation stays consistent.
// ============================================================

import { loadEnv, fixMcpPlaceholders } from "./load-env.js";
import { initSlackClients } from "./slack-clients.js";

/**
 * Run the full bootstrap sequence:
 *   1. Load .env (global + cwd)
 *   2. Fix MCP config placeholders
 *   3. Validate token formats
 *   4. Initialize Slack clients
 *
 * Returns the merged parsed .env (for callers that need placeholder fixup details).
 * Calls process.exit(1) on unrecoverable config errors.
 */
export function bootstrap(): Record<string, string> {
  const dotEnvParsed = loadEnv();
  fixMcpPlaceholders(dotEnvParsed, ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"]);

  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

  if (!SLACK_BOT_TOKEN) {
    console.error(
      "[slack-socket-mcp] FATAL: SLACK_BOT_TOKEN environment variable is required"
    );
    process.exit(1);
  }

  if (!SLACK_APP_TOKEN) {
    console.error(
      "[slack-socket-mcp] FATAL: SLACK_APP_TOKEN environment variable is required"
    );
    process.exit(1);
  }

  // Validate token formats (warn only — don't exit)
  if (!SLACK_BOT_TOKEN.startsWith("xoxb-")) {
    console.error(
      "[slack-socket-mcp] WARNING: SLACK_BOT_TOKEN should start with 'xoxb-'. " +
        "Got: " + SLACK_BOT_TOKEN.substring(0, 5) + "..."
    );
  }
  if (!SLACK_APP_TOKEN.startsWith("xapp-")) {
    console.error(
      "[slack-socket-mcp] WARNING: SLACK_APP_TOKEN should start with 'xapp-'. " +
        "Got: " + SLACK_APP_TOKEN.substring(0, 5) + "..."
    );
  }

  // Initialize Slack clients
  initSlackClients({
    botToken: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
  });

  return dotEnvParsed;
}
