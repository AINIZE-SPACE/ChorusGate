// ============================================================
// ClaudeStreamParser — 解析 claude -p --input-format stream-json
//                        --output-format stream-json NDJSON
//
// 在 ClaudeEventParser 基础上新增双向 stream-json 事件:
//   - system/subtype:init          → 记录 session 元数据
//   - system/subtype:permission_request → 触发审批回调
//   - system/subtype:api_retry     → 日志记录
//   - user (isReplay)              → stdin 回显消息
//
// M2: Claude 双向 stream-json 控制面
// M3: content_block_delta 增量流式 (--include-partial-messages)
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
//       [#85](https://github.com/AINIZE-SPACE/chorusgate/issues/85)
// ============================================================

import { ClaudeEventParser } from "./claude-parser.js";

/** permission_request 事件载荷 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId?: string;
}

/** system/init 事件载荷 */
export interface StreamInit {
  sessionId: string;
  model: string;
  tools: string[];
  cwd: string;
  permissionMode: string;
}

export class ClaudeStreamParser extends ClaudeEventParser {
  /** 审批请求回调 */
  onPermissionRequest?: (req: PermissionRequest) => void;
  /** result 事件回调 — gateway 用此关闭 stdin 让 Claude 退出 */
  onResult?: () => void;
  /** session 初始化回调 */
  onInit?: (init: StreamInit) => void;
  /** API 重试回调（可选，用于监控） */
  onApiRetry?: (attempt: number, maxRetries: number, delayMs: number) => void;
  /** 用户消息回显回调（可选） */
  onUserReplay?: (message: unknown) => void;

  // ---- M3: 增量流式回调 (#85) ------------------------------------------------
  /** 正文增量（逐 token） */
  onTextDelta?: (text: string) => void;
  /** Extended Thinking 增量 */
  onThinkingDelta?: (thinking: string) => void;

  private _init: StreamInit | null = null;
  private _permissionRequests: PermissionRequest[] = [];
  /** 累积的增量文本（不写入父类 assistantText，避免与完整 assistant 重复） */
  private _streamText = "";

  get init(): StreamInit | null { return this._init; }
  get permissionRequests(): readonly PermissionRequest[] { return this._permissionRequests; }
  get sessionId(): string { return this._init?.sessionId || ""; }
  /** 流式累积文本（用于中途展示） */
  get streamText(): string { return this._streamText; }

  feed(line: string): void {
    const t = line.trim();
    if (!t || t[0] !== "{") return;

    let evt: Record<string, unknown>;
    try { evt = JSON.parse(t); } catch { return; }

    const type = evt.type as string | undefined;

    // M3: content_block_delta events (#85)
    if (type === "content_block_delta") {
      this._handleDelta(evt);
      return;
    }

    if (type === "system") {
      this._handleSystem(evt);
    } else if (type === "user") {
      this._handleUser(evt);
    } else {
      super.feed(line);
      if (evt.type === "result") this.onResult?.();
    }
  }

  // ---- M3 delta handler ------------------------------------------------------

  private _handleDelta(evt: Record<string, unknown>): void {
    const delta = evt.delta as Record<string, unknown> | undefined;
    if (!delta) return;
    const deltaType = delta.type as string | undefined;

    if (deltaType === "text_delta" && typeof delta.text === "string") {
      this._streamText += delta.text;
      this.onTextDelta?.(delta.text);
    } else if (deltaType === "thinking_delta" && typeof delta.thinking === "string") {
      this.onThinkingDelta?.(delta.thinking);
    }
    // input_json_delta: 工具参数片段，暂不推送（内容敏感）
  }

  private _handleSystem(evt: Record<string, unknown>): void {
    const subtype = evt.subtype as string | undefined;

    switch (subtype) {
      case "init": {
        this._init = {
          sessionId: (evt.session_id as string) || "",
          model: (evt.model as string) || "",
          tools: (evt.tools as string[]) || [],
          cwd: (evt.cwd as string) || "",
          permissionMode: (evt.permissionMode as string) || "",
        };
        this.onInit?.(this._init);
        // session_id 回调（兼容 EventParser 接口）
        if (this._init.sessionId) {
          this.onSessionId?.(this._init.sessionId);
        }
        break;
      }
      case "permission_request": {
        const req: PermissionRequest = {
          requestId: (evt.request_id as string) || "",
          toolName: (evt.tool_name as string) || "",
          toolInput: (evt.tool_input as Record<string, unknown>) || {},
          sessionId: (evt.session_id as string) || undefined,
        };
        this._permissionRequests.push(req);
        this.onPermissionRequest?.(req);
        break;
      }
      case "api_retry": {
        const attempt = (evt.attempt as number) || 0;
        const maxRetries = (evt.max_retries as number) || 0;
        const delayMs = (evt.retry_delay_ms as number) || 0;
        this.onApiRetry?.(attempt, maxRetries, delayMs);
        break;
      }
      default:
        // 未知 system 事件，忽略
        break;
    }
  }

  private _handleUser(evt: Record<string, unknown>): void {
    // --replay-user-messages 回显的用户消息
    if (evt.isReplay === true) {
      this.onUserReplay?.(evt.message);
    }
    // 非 replay 的 user 事件忽略（它们不是从 stdout 来的）
  }
}
