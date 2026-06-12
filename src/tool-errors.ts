// ============================================================
// MCP tool error helpers
// ============================================================

export interface ToolErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ToolError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

const SLACK_ERROR_CODES: Record<string, string> = {
  channel_not_found: "slack_channel_not_found",
  not_in_channel: "slack_not_in_channel",
  user_not_found: "slack_user_not_found",
  message_not_found: "slack_message_not_found",
  invalid_auth: "slack_invalid_auth",
  not_authed: "slack_not_authed",
  token_revoked: "slack_token_revoked",
  missing_scope: "slack_missing_scope",
  ratelimited: "slack_rate_limited",
};

export function slackApiError(action: string, error?: string): ToolError {
  const slackCode = error || "unknown_error";
  const code = SLACK_ERROR_CODES[slackCode] || `slack_${slackCode}`;
  return new ToolError(code, `${action}: ${slackCode}`, { slack_error: slackCode });
}

export function serializeToolError(err: unknown): ToolErrorBody {
  if (err instanceof ToolError) {
    return {
      code: err.code,
      message: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
    };
  }

  if (err instanceof Error) {
    return {
      code: "internal_error",
      message: err.message,
    };
  }

  return {
    code: "internal_error",
    message: String(err),
  };
}
