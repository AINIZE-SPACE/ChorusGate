// ============================================================
// PermissionTracker — track pending permission_request events
//                      and resolve them via Slack block_actions
//
// When Claude emits a permission_request, the gateway posts an
// interactive Slack message with Approve/Deny buttons. This module
// bridges the gap between the async stream-json event and the
// user's button click.
//
// M2: Claude 双向 stream-json 控制面
// 跟踪: [#34](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/34)
// ============================================================

/** Slack Block Kit 类型（本模块所需子集） */
interface SlackText {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

interface SlackButtonElement {
  type: "button";
  text: SlackText;
  style?: "primary" | "danger";
  action_id: string;
  value: string;
}

interface SlackContextElement {
  type: "mrkdwn";
  text: string;
}

type SlackElement = SlackButtonElement | SlackContextElement;

interface SlackBlock {
  type: "section" | "actions" | "context";
  block_id?: string;
  text?: SlackText;
  fields?: SlackText[];
  elements?: SlackElement[];
}

/** handleAction 返回值 */
export interface HandleActionResult {
  handled: boolean;
  /** 发起审批的用户 ID（从 button value 解析） */
  requesterUserId?: string;
  /** 审批结果 */
  granted?: boolean;
}

/** 单个待审批项 */
interface PendingPermission {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  channel: string;
  threadTs: string;
  /** 发起审批的 Slack 用户 ID */
  requesterUserId: string;
  /** 用户响应后 resolve */
  resolve: (granted: boolean) => void;
  /** 超时自动拒绝 */
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 min

/**
 * 审批追踪器。
 *
 * 用法:
 *   const tracker = new PermissionTracker();
 *   tracker.onBlockAction = (action) => { ... };
 *
 *   // 在 gateway 中:
 *   const granted = await tracker.waitForApproval(requestId, details);
 *   session.sendPermissionResponse(requestId, granted);
 */
export class PermissionTracker {
  private pending = new Map<string, PendingPermission>();
  private timeoutMs: number;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /** 注册一个待审批请求，返回 Promise 在用户响应后 resolve */
  waitForApproval(
    requestId: string,
    details: {
      toolName: string;
      toolInput: Record<string, unknown>;
      channel: string;
      threadTs: string;
      /** 发起审批的 Slack 用户 ID（用于鉴权） */
      requesterUserId: string;
    },
  ): Promise<boolean> {
    // 清理已存在（理论上不会）
    this.reject(requestId, false);

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        console.error(
          `[permission-tracker] request ${requestId} timed out, auto-denying`,
        );
        this.reject(requestId, false);
      }, this.timeoutMs);

      this.pending.set(requestId, {
        requestId,
        toolName: details.toolName,
        toolInput: details.toolInput,
        channel: details.channel,
        threadTs: details.threadTs,
        requesterUserId: details.requesterUserId,
        resolve,
        timer,
      });
    });
  }

  /** 处理 Slack block_actions 回调 — 解析 action_value 并 resolve */
  handleAction(actionValue: string): HandleActionResult {
    // action_value 格式: "${action}:${requestId}:${requesterUserId}"
    // userId 固定为最后一段 (Slack ID 不含 ":")，requestId 可为中间多段（含 ":" 时）
    // 例如: "approve:req_abc123:U0B8VHLHJAX"
    // 或:   "approve:claude:req:a/b:U0B8VHLHJAX"
    const lastColon = actionValue.lastIndexOf(":");
    if (lastColon === -1) return { handled: false };
    const requesterUserId = actionValue.slice(lastColon + 1);

    const firstColon = actionValue.indexOf(":");
    if (firstColon === lastColon) return { handled: false };
    const action = actionValue.slice(0, firstColon);
    const requestId = actionValue.slice(firstColon + 1, lastColon);

    const pending = this.pending.get(requestId);
    if (!pending) return { handled: false };

    if (action === "approve") {
      const handled = this.approve(requestId);
      return { handled, requesterUserId: pending.requesterUserId, granted: true };
    } else if (action === "deny") {
      const handled = this.deny(requestId);
      return { handled, requesterUserId: pending.requesterUserId, granted: false };
    }
    return { handled: false };
  }

  /** 批准指定请求 */
  approve(requestId: string): boolean {
    return this.reject(requestId, true);
  }

  /** 拒绝指定请求 */
  deny(requestId: string): boolean {
    return this.reject(requestId, false);
  }

  /** 获取待审批请求详情（用于构建 Slack 消息） */
  getPending(requestId: string): PendingPermission | undefined {
    return this.pending.get(requestId);
  }

  /** 是否有待审批项 */
  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 清理所有待审批项 */
  clear(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve(false);
      this.pending.delete(id);
    }
  }

  private reject(requestId: string, granted: boolean): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    p.resolve(granted);
    this.pending.delete(requestId);
    return true;
  }
}

/**
 * 构建审批 Slack 消息的 blocks（interactive message）。
 * 使用 Slack Block Kit 格式。
 *
 * @param timeoutMs 审批超时毫秒数，用于生成动态超时文案
 * @param requesterUserId 发起审批的 Slack 用户 ID，编码到按钮 value 中用于鉴权
 */
export function buildApprovalBlocks(
  toolName: string,
  toolInput: Record<string, unknown>,
  requestId: string,
  requesterUserId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): SlackBlock[] {
  const inputSummary = JSON.stringify(toolInput, null, 2).slice(0, 500);
  const timeoutMinutes = Math.round(timeoutMs / 60000);

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *Claude 请求执行工具* — 需要你的批准`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*工具:*\n\`${toolName}\`` },
        { type: "mrkdwn", text: `*请求ID:*\n\`${requestId}\`` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*参数:*\n\`\`\`${inputSummary}\`\`\``,
      },
    },
    {
      type: "actions",
      block_id: `perm_${requestId}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve", emoji: true },
          style: "primary",
          action_id: "permission_approve",
          value: `approve:${requestId}:${requesterUserId}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Deny", emoji: true },
          style: "danger",
          action_id: "permission_deny",
          value: `deny:${requestId}:${requesterUserId}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: ${timeoutMinutes} 分钟内未响应将自动拒绝`,
        },
      ],
    },
  ];
}
