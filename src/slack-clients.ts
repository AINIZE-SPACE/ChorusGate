// ============================================================
// Shared Slack client instances
// ============================================================

import { WebClient } from "@slack/web-api";

let webClient: WebClient | null = null;
let appToken: string | null = null;

export function initSlackClients(opts: {
  botToken: string;
  appToken: string;
}): WebClient {
  webClient = new WebClient(opts.botToken);
  appToken = opts.appToken;
  return webClient;
}

export function getWebClient(): WebClient {
  if (!webClient) {
    throw new Error(
      "Slack WebClient not initialized. " +
        "Set SLACK_BOT_TOKEN environment variable."
    );
  }
  return webClient;
}

export function getAppToken(): string {
  if (!appToken) {
    throw new Error(
      "Slack App Token not initialized. " +
        "Set SLACK_APP_TOKEN environment variable."
    );
  }
  return appToken;
}
