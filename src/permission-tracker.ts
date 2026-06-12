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

/** 单个待审批项 */
interface PendingPermission {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  channel: string;
  threadTs: string;
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
        resolve,
        timer,
      });
    });
  }

  /** 处理 Slack block_actions 回调 — 解析 action_value 并 resolve */
  handleAction(actionValue: string): boolean {
    // action_value 格式: "${action}:${requestId}"
    // 例如: "approve:req_abc123" 或 "deny:req_abc123"
    const idx = actionValue.indexOf(":");
    if (idx === -1) return false;

    const action = actionValue.slice(0, idx);
    const requestId = actionValue.slice(idx + 1);

    if (action === "approve") {
      return this.approve(requestId);
    } else if (action === "deny") {
      return this.deny(requestId);
    }
    return false;
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
 */
export function buildApprovalBlocks(
  toolName: string,
  toolInput: Record<string, unknown>,
  requestId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  const inputSummary = JSON.stringify(toolInput, null, 2).slice(0, 500);

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
          value: `approve:${requestId}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Deny", emoji: true },
          style: "danger",
          action_id: "permission_deny",
          value: `deny:${requestId}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: 2 分钟内未响应将自动拒绝`,
        },
      ],
    },
  ];
}
