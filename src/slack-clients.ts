// ============================================================
// Shared Slack client instances — singleton (backward compat) +
// per-profile factory for multi-app support.
//
// Legacy callers (MCP server, tools) still use:
//   initSlackClients({ botToken, appToken })  → once at startup
//   getWebClient()                            → anywhere
//   getAppToken()                             → anywhere
//
// Multi-profile callers (SocketManager, gateway) use:
//   createSlackClientSet({ botToken, appToken }) → independent pair
// ============================================================

import { WebClient } from "@slack/web-api";
import type http from "node:http";

// ---- types -------------------------------------------------------------------

/** An independent WebClient + app-token pair for one Slack app profile. */
export interface SlackClientSet {
  web: WebClient;
  appToken: string;
}

// ---- legacy singleton (backward compat) --------------------------------------

let webClient: WebClient | null = null;
let appToken: string | null = null;

/**
 * Initialize the default singleton clients.
 * Called once by bootstrap() for single-profile / MCP server mode.
 * `agent`（#147 proxy 模式）传给 WebClient 使 HTTP 请求走代理。
 */
export function initSlackClients(opts: {
  botToken: string;
  appToken: string;
  agent?: http.Agent;
}): WebClient {
  webClient = new WebClient(opts.botToken, opts.agent ? { agent: opts.agent } : undefined);
  appToken = opts.appToken;
  return webClient;
}

/** Get the default singleton WebClient. */
export function getWebClient(): WebClient {
  if (!webClient) {
    throw new Error(
      "Slack WebClient not initialized. " +
        "Set SLACK_BOT_TOKEN environment variable.",
    );
  }
  return webClient;
}

/** Get the default singleton app token. */
export function getAppToken(): string {
  if (!appToken) {
    throw new Error(
      "Slack App Token not initialized. " +
        "Set SLACK_APP_TOKEN environment variable.",
    );
  }
  return appToken;
}

// ---- per-profile factory (multi-profile support) -----------------------------

/**
 * Create an independent WebClient + app-token pair.
 * Does NOT affect the legacy singleton.  Used by SocketManager so each
 * profile gets its own Slack connection.
 */
export function createSlackClientSet(opts: {
  botToken: string;
  appToken: string;
  agent?: http.Agent;
}): SlackClientSet {
  return {
    web: new WebClient(opts.botToken, opts.agent ? { agent: opts.agent } : undefined),
    appToken: opts.appToken,
  };
}
