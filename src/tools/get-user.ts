// ============================================================
// Tool: slack_get_user_info — Get information about a Slack user
// ============================================================

import type { GetUserInfoInput, GetUserInfoOutput } from "../types.js";
import { getWebClient } from "../slack-clients.js";

export const getUserInfoTool = {
  name: "slack_get_user_info",
  description:
    "Get detailed information about a Slack user by their user ID.",
  inputSchema: {
    type: "object" as const,
    properties: {
      user_id: {
        type: "string",
        description: "Slack user ID (e.g. 'U123456')",
      },
    },
    required: ["user_id"],
  },
  async handler(input: GetUserInfoInput): Promise<GetUserInfoOutput> {
    const web = getWebClient();

    const result = await web.users.info({ user: input.user_id });

    if (!result.ok || !result.user) {
      throw new Error(
        `Failed to get user info: ${result.error || "user not found"}`
      );
    }

    const user = result.user as Record<string, unknown>;
    const profile = user.profile as Record<string, unknown> | undefined;

    return {
      id: (user.id as string) || "",
      name: (user.name as string) || "",
      real_name: (user.real_name as string) || (profile?.real_name as string) || "",
      display_name: (profile?.display_name as string) || "",
      title: (profile?.title as string) || "",
      image_48: profile?.image_48 as string | undefined,
      is_bot: (user.is_bot as boolean) || false,
      timezone: user.tz as string | undefined,
    };
  },
};
