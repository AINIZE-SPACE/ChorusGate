// ============================================================
// Socket Mode Connection Manager — multi-profile support
//
// SocketManager manages one SocketModeClient per Slack app profile.
// Each profile gets independent tokens, WebClient, bot identity,
// and event routing so two Slack apps (e.g. CC + Codex) can run
// concurrently without event leakage.
//
// Backward compat: startSocketMode() / stopSocketMode() are kept
// as convenience wrappers for single-profile callers (MCP server).
//
// 跟踪: [#24](https://github.com/AINIZE-SPACE/chorusgate/issues/24)
// 跟踪: [#30](https://github.com/AINIZE-SPACE/chorusgate/issues/30)
// ============================================================

import { SocketModeClient, LogLevel } from "@slack/socket-mode";
import { eventStore } from "./event-store.js";
import {
  createSlackClientSet,
  type SlackClientSet,
} from "./slack-clients.js";
import type { ProfileConfig } from "./profile-config.js";
import type { StoredEvent, SlackEventType } from "./types.js";
import {
  ReconnectPolicy,
  type ReconnectPolicyConfig,
} from "./reconnect-policy.js";

// ---- reconnect policy config (#148) ------------------------------------------
// 读取 GATEWAY_RECONNECT_* / GATEWAY_CIRCUIT_* 环境变量；缺省即默认值。
function reconnectPolicyConfig(): ReconnectPolicyConfig {
  const num = (k: string, d: number): number | undefined => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const ratio = (k: string, d: number): number | undefined => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : d;
  };
  return {
    baseDelayMs: num("GATEWAY_RECONNECT_BASE_DELAY_MS", 1000),
    maxDelayMs: num("GATEWAY_RECONNECT_MAX_DELAY_MS", 60_000),
    multiplier: num("GATEWAY_RECONNECT_MULTIPLIER", 2),
    jitterRatio: ratio("GATEWAY_RECONNECT_JITTER", 0.3),
    circuitOpenAfter: num("GATEWAY_CIRCUIT_OPEN_AFTER", 5),
    circuitCooldownMs: num("GATEWAY_CIRCUIT_COOLDOWN_MS", 300_000),
  };
}

// ---- callbacks (profile-aware) ----------------------------------------------

/** Called for every stored Slack event.  profileId tells the gateway which app. */
export type EventCallback = (event: StoredEvent, profileId: string) => void;

/** A Slack slash command received over Socket Mode. */
export interface SlashCommand {
  command: string;
  text: string;
  channelId: string;
  userId: string;
  userName?: string;
  /** Which profile (Slack app) received this command. */
  profileId: string;
}
export type SlashCallback = (cmd: SlashCommand) => void | Promise<void>;

/** A block_actions interaction (e.g. Approve/Deny button click). */
export interface BlockAction {
  type: "block_actions";
  channelId: string;
  userId: string;
  actionValue: string;
  actionId: string;
  messageTs: string;
  /** Which profile (Slack app) received this action. */
  profileId: string;
}
export type BlockActionCallback = (
  action: BlockAction,
) => void | Promise<void>;

// ---- internal per-profile state ---------------------------------------------

interface RunningProfile {
  config: ProfileConfig;
  clients: SlackClientSet;
  socket: SocketModeClient;
  botUserId: string | null;
  /** #148 指数退避 + 熔断策略（每 profile 独立）。 */
  policy: ReconnectPolicy;
  /** 已排定的重连定时器（去重，避免多源重复调度）。 */
  reconnectTimer: NodeJS.Timeout | null;
  /** 是否已排定重连（防叠加重连风暴）。 */
  reconnectPending: boolean;
  /** 主动重连中（forceReconnect 内部 disconnect 阶段）——忽略 disconnected 事件。 */
  intentionalReconnect: boolean;
}

// ---- SocketManager ----------------------------------------------------------

export class SocketManager {
  private profiles = new Map<string, RunningProfile>();
  /** #148: stopAll 后置位，停止一切自动重连调度。 */
  private shutdownStarted = false;

  private onEvent: EventCallback | null = null;
  private onSlash: SlashCallback | null = null;
  private onBlockAction: BlockActionCallback | null = null;

  // ---- configuration --------------------------------------------------------

  /** Set the global event callback (called for all profiles). */
  setEventCallback(cb: EventCallback): void {
    this.onEvent = cb;
  }

  /** Set the global slash-command callback. */
  setSlashCallback(cb: SlashCallback): void {
    this.onSlash = cb;
  }

  /** Set the global block-action callback. */
  setBlockActionCallback(cb: BlockActionCallback): void {
    this.onBlockAction = cb;
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Start a single profile — create SocketModeClient, register handlers. */
  async startProfile(config: ProfileConfig): Promise<void> {
    if (this.profiles.has(config.id)) {
      console.error(
        `[socket-manager] profile '${config.id}' already running, skipping`,
      );
      return;
    }

    const clients = createSlackClientSet({
      botToken: config.botToken,
      appToken: config.appToken,
    });

    // Resolve our own bot user ID to filter self-messages
    let botUserId: string | null = null;
    try {
      const auth = await clients.web.auth.test();
      botUserId = auth.user_id ?? null;
      console.error(
        `[socket-manager] profile '${config.id}': bot user ID = ${botUserId}`,
      );
    } catch (err) {
      console.error(
        `[socket-manager] profile '${config.id}': failed to resolve bot user ID, ` +
          `self-message filtering disabled: ${(err as Error).message}`,
      );
    }

    const socket = new SocketModeClient({
      appToken: clients.appToken,
      logLevel: LogLevel.INFO,
      // #148: 关掉库内建线性重连（5–10s 风暴），重连统一走 ReconnectPolicy。
      autoReconnectEnabled: false,
    });

    const rp: RunningProfile = {
      config,
      clients,
      socket,
      botUserId,
      policy: new ReconnectPolicy(reconnectPolicyConfig()),
      reconnectTimer: null,
      reconnectPending: false,
      intentionalReconnect: false,
    };
    this.profiles.set(config.id, rp);

    // Wire Socket Mode lifecycle events
    socket.on("connecting", () => {
      console.error(
        `[socket-manager] profile '${config.id}': connecting to Slack...`,
      );
    });
    socket.on("connected", () => {
      console.error(
        `[socket-manager] profile '${config.id}': Socket Mode connected`,
      );
      rp.intentionalReconnect = false;
      rp.policy.recordSuccess();
    });
    socket.on("ready", () => {
      console.error(
        `[socket-manager] profile '${config.id}': ready, listening for events`,
      );
    });
    socket.on("disconnecting", () => {
      console.error(
        `[socket-manager] profile '${config.id}': disconnecting...`,
      );
    });
    // autoReconnectEnabled=false 时，ws 意外关闭后库只会 emit "disconnected"。
    // 这是 ChorusGate 层重连的主驱动：记录失败 + 按退避/熔断调度重连。
    socket.on("disconnected", () => {
      if (rp.intentionalReconnect || this.shutdownStarted) return;
      console.error(
        `[socket-manager] profile '${config.id}': disconnected unexpectedly`,
      );
      this.onFailure(config.id, "socket disconnected");
    });
    socket.on("error", (error) => {
      console.error(
        `[socket-manager] profile '${config.id}': Socket Mode error: ` +
          (error as Error).message,
      );
    });

    // ---- Slack event handlers (profile-scoped) ----------------------------

    const pid = config.id;

    socket.on("app_mention", async ({ event, ack }) => {
      await this.handleSlackEvent("app_mention", event, pid, clients, botUserId);
      await ack();
    });

    socket.on("message", async ({ event, ack }) => {
      // Skip messages from our own bot
      if (botUserId && (event as Record<string, unknown>).user === botUserId) {
        await ack();
        return;
      }
      // Skip bot_message subtypes from other bots
      const subtype = (event as Record<string, unknown>).subtype as
        | string
        | undefined;
      if (subtype === "bot_message") {
        await ack();
        return;
      }
      await this.handleSlackEvent("message", event, pid, clients, botUserId);
      await ack();
    });

    socket.on("reaction_added", async ({ event, ack }) => {
      await this.handleSlackEvent(
        "reaction_added",
        event,
        pid,
        clients,
        botUserId,
      );
      await ack();
    });

    // Slash commands — ack immediately (3s timeout), then dispatch
    socket.on("slash_commands", async ({ body, ack }) => {
      await ack();
      if (this.onSlash) {
        const cmd: SlashCommand = {
          command: (body.command as string) || "",
          text: ((body.text as string) || "").trim(),
          channelId: (body.channel_id as string) || "",
          userId: (body.user_id as string) || "",
          userName: (body.user_name as string) || undefined,
          profileId: pid,
        };
        try {
          await this.onSlash(cmd);
        } catch (err) {
          console.error(
            `[socket-manager] profile '${pid}': slash command handler error: ` +
              (err as Error).message,
          );
        }
      }
    });

    // Interactive messages (block_actions)
    socket.on("interactive", async ({ body, ack }) => {
      const payload = body as Record<string, unknown>;
      if (payload.type !== "block_actions") {
        if (payload.type === "view_submission" || payload.type === "view_closed") {
          console.error(
            `[socket-manager] profile '${pid}': unsupported interactive type ` +
              `"${payload.type}" — modal/view handlers not implemented`,
          );
        }
        await ack();
        return;
      }
      await ack();
      if (!this.onBlockAction) return;

      const actions = payload.actions as Array<Record<string, unknown>> | undefined;
      if (!actions || actions.length === 0) return;

      for (const action of actions) {
        const ch = payload.channel as Record<string, unknown> | undefined;
        const usr = payload.user as Record<string, unknown> | undefined;
        const msg = payload.message as Record<string, unknown> | undefined;
        const container = payload.container as Record<string, unknown> | undefined;
        const blockAction: BlockAction = {
          type: "block_actions",
          channelId: ((ch?.id || payload.channel_id || "") as string),
          userId: ((usr?.id || payload.user_id || "") as string),
          actionValue: (action.value as string) || "",
          actionId: (action.action_id as string) || "",
          messageTs: ((msg?.ts || container?.message_ts || "") as string),
          profileId: pid,
        };
        try {
          await this.onBlockAction(blockAction);
        } catch (err) {
          console.error(
            `[socket-manager] profile '${pid}': block_action handler error: ` +
              (err as Error).message,
          );
        }
      }
    });

    // #148: 初始连接失败不抛错——profile 留在 map 里，交给退避/熔断调度重试，
    // 避免"启动即网络抖动"导致 daemon 直接退出。
    try {
      await socket.start();
      rp.policy.recordSuccess();
    } catch (err) {
      console.error(
        `[socket-manager] profile '${config.id}': initial connect failed — ` +
          (err as Error).message,
      );
      this.onFailure(config.id, "initial connect failed");
    }
  }

  /** Start all profiles from a parsed config list. */
  async startAll(configs: ProfileConfig[]): Promise<void> {
    await Promise.allSettled(configs.map((c) => this.startProfile(c)));
    const managed = [...this.profiles.keys()];
    if (managed.length === 0) {
      throw new Error("No profiles could be started. Check your configuration.");
    }
    console.error(
      `[socket-manager] ${managed.length} profile(s) managed: ${managed.join(", ")}`,
    );
  }

  /** Stop a single profile. */
  async stopProfile(id: string): Promise<void> {
    const rp = this.profiles.get(id);
    if (!rp) return;
    rp.intentionalReconnect = true;
    this.clearReconnectTimer(id);
    try {
      await rp.socket.disconnect();
    } catch {
      // ignore
    }
    this.profiles.delete(id);
    console.error(`[socket-manager] profile '${id}': stopped`);
  }

  /** Stop all running profiles. */
  async stopAll(): Promise<void> {
    this.shutdownStarted = true;
    const ids = [...this.profiles.keys()];
    await Promise.all(ids.map((id) => this.stopProfile(id)));
  }

  /** Number of running profiles. */
  get profileCount(): number {
    return this.profiles.size;
  }

  // ---- liveness probe + reconnect (Issue: 休眠唤醒不恢复) -------------------

  /**
   * Whether a profile's Socket Mode connection is currently believed active.
   *
   * SocketModeClient has no public isConnected(); the underlying
   * `websocket?.isActive()` reflects the ws readyState === OPEN. In a
   * half-open TCP (Modern Standby) the ready state stays OPEN even though
   * no data flows — hence Layer 2 of liveness treats this as a probe, not
   * a guarantee.
   */
  isConnected(profileId: string = "default"): boolean {
    const rp = this.profiles.get(profileId);
    if (!rp) return false;
    try {
      return rp.socket.websocket?.isActive() ?? false;
    } catch {
      return false;
    }
  }

  /** True if at least one profile is connected (gateway-level probe). */
  anyConnected(): boolean {
    for (const id of this.profiles.keys()) {
      if (this.isConnected(id)) return true;
    }
    return this.profiles.size === 0 ? true : false;
  }

  /**
   * Force a reconnect across all running profiles. Returns true only if
   * every profile ended up connected. Never throws — errors are logged.
   * #148: 尊重熔断/已排定重连——熔断打开或已排定重连的 profile 跳过，不再硬连。
   */
  async forceReconnectAll(): Promise<boolean> {
    const ids = [...this.profiles.keys()];
    if (ids.length === 0) return true;
    const results = await Promise.all(
      ids.map((id) => this.forceReconnect(id)),
    );
    return results.every(Boolean);
  }

  /**
   * Force a Socket Mode reconnect for a profile — actively tear down the
   * (possibly half-open) WebSocket and establish a fresh session.
   * SocketModeClient supports start() again after disconnect(). Returns
   * whether the connection is believed active afterwards.
   *
   * #148: 熔断打开时跳过并返回 false（由冷却定时器驱动下一次尝试）；主动
   * reconnect 期间置 intentionalReconnect，忽略 disconnected 事件回声。
   */
  async forceReconnect(profileId: string = "default"): Promise<boolean> {
    const rp = this.profiles.get(profileId);
    if (!rp) {
      console.error(`[socket-manager] profile '${profileId}': not running, cannot reconnect`);
      return false;
    }
    if (rp.reconnectPending) {
      console.error(
        `[socket-manager] profile '${profileId}': reconnect already scheduled — skipping`,
      );
      return this.isConnected(profileId);
    }
    if (rp.policy.isCircuitOpen()) {
      console.error(
        `[socket-manager] profile '${profileId}': circuit OPEN — skipping forced reconnect ` +
          `(${rp.policy.circuitRemainingMs()}ms remaining)`,
      );
      return false;
    }
    console.error(
      `[socket-manager] profile '${profileId}': forcing reconnect (zombie socket)`,
    );
    rp.intentionalReconnect = true;
    try {
      await rp.socket.disconnect();
    } catch (err) {
      console.error(
        `[socket-manager] profile '${profileId}': disconnect during forced reconnect failed: ` +
          (err as Error).message,
      );
    }
    try {
      await rp.socket.start();
      rp.policy.recordSuccess();
      rp.intentionalReconnect = false;
      return this.isConnected(profileId);
    } catch (err) {
      rp.intentionalReconnect = false;
      console.error(
        `[socket-manager] profile '${profileId}': forced reconnect failed: ` +
          (err as Error).message,
      );
      // 记录失败并按退避/熔断调度下一次尝试。
      this.onFailure(profileId, "forced reconnect failed");
      return false;
    }
  }

  // ---- #148 退避/熔断驱动重连 ------------------------------------------------

  /** 记录一次连接失败，并按策略调度下一次尝试（去重）。 */
  private onFailure(profileId: string, reason: string): void {
    const rp = this.profiles.get(profileId);
    if (!rp || this.shutdownStarted) return;
    const { opened, cooldownMs } = rp.policy.recordFailure();
    console.error(
      `[socket-manager] profile '${profileId}': connection failed (${reason}) — ` +
        `consecutive=${rp.policy.consecutiveFailures()}`,
    );
    if (opened) {
      console.error(
        `[socket-manager] profile '${profileId}': circuit OPEN for ${cooldownMs}ms`,
      );
    }
    this.scheduleReconnect(profileId);
  }

  /** 按策略计算等待并排定重连（幂等：已排定则跳过）。 */
  private scheduleReconnect(profileId: string): void {
    const rp = this.profiles.get(profileId);
    if (!rp || rp.reconnectPending || this.shutdownStarted) return;
    const waitMs = rp.policy.isCircuitOpen()
      ? rp.policy.circuitRemainingMs()
      : rp.policy.nextDelayMs();
    rp.reconnectPending = true;
    console.error(
      `[socket-manager] profile '${profileId}': reconnect scheduled in ${waitMs}ms`,
    );
    rp.reconnectTimer = setTimeout(() => {
      rp.reconnectPending = false;
      rp.reconnectTimer = null;
      void this.doReconnect(profileId);
    }, waitMs);
    rp.reconnectTimer.unref?.();
  }

  /** 执行一次排定的重连；成功复位策略，失败继续排下一次。 */
  private async doReconnect(profileId: string): Promise<void> {
    const rp = this.profiles.get(profileId);
    if (!rp || this.shutdownStarted) return;
    if (rp.policy.isCircuitOpen()) {
      // half-open：熔断刚结束允许一次尝试；若仍开着（其他源重试了）则再等。
      this.scheduleReconnect(profileId);
      return;
    }
    const ok = await this.forceReconnect(profileId);
    if (ok) {
      rp.policy.recordSuccess();
      console.error(
        `[socket-manager] profile '${profileId}': reconnect successful — backoff reset`,
      );
    } else if (!rp.reconnectPending) {
      // forceReconnect 抛错路径已 onFailure 排下一次；这里覆盖"start() 成功但
      // socket 未 active"或"熔断跳过"的静默失败。
      this.onFailure(profileId, "reconnect not active");
    }
  }

  private clearReconnectTimer(profileId: string): void {
    const rp = this.profiles.get(profileId);
    if (!rp) return;
    if (rp.reconnectTimer) {
      clearTimeout(rp.reconnectTimer);
      rp.reconnectTimer = null;
    }
    rp.reconnectPending = false;
  }

  /**
   * #148 最后兜底：某 profile 连续宕机超过 maxDownMs 仍未恢复 → true，
   * gateway 据此 exit(1) 交给 watchdog 重启（新鲜进程可能走不同网络路径）。
   */
  shouldExitForWatchdog(maxDownMs: number): boolean {
    const nowMs = Date.now();
    for (const rp of this.profiles.values()) {
      const f = rp.policy.firstFailureAt();
      if (rp.policy.consecutiveFailures() > 0 && f > 0 && nowMs - f > maxDownMs) {
        return true;
      }
    }
    return false;
  }

  /** Get the bot user ID for a profile. */
  getBotUserId(profileId: string): string | null {
    return this.profiles.get(profileId)?.botUserId ?? null;
  }

  // ---- event conversion ------------------------------------------------------

  private async handleSlackEvent(
    type: SlackEventType,
    rawEvent: unknown,
    profileId: string,
    _clients: SlackClientSet,
    _botUserId: string | null,
  ): Promise<void> {
    try {
      const evt = rawEvent as Record<string, unknown>;
      const item = evt.item as Record<string, unknown> | undefined;

      const stored = eventStore.push({
        type,
        subtype: evt.subtype as string | undefined,
        channel:
          (evt.channel as string) || (item?.channel as string) || "",
        user: (evt.user as string) || "",
        text: (evt.text as string) || "",
        ts: (evt.ts as string) || (evt.event_ts as string) || "",
        thread_ts: evt.thread_ts as string | undefined,
        reaction: evt.reaction as string | undefined,
        reaction_user: evt.user as string | undefined,
        reaction_item_channel: item?.channel as string | undefined,
        reaction_item_ts: item?.ts as string | undefined,
        user_name: undefined,
        channel_name: undefined,
        profileId,
        raw: rawEvent,
      });

      console.error(
        `[socket-manager] profile '${profileId}': event stored — ` +
          `${stored.type} from ${stored.user} in ${stored.channel} (id: ${stored.id})`,
      );

      if (this.onEvent) {
        this.onEvent(stored, profileId);
      }
    } catch (err) {
      console.error(
        `[socket-manager] profile '${profileId}': error handling event: ` +
          (err as Error).message,
      );
    }
  }
}

// ---- singleton (multi-profile gateway uses one instance) ---------------------

let _instance: SocketManager | null = null;

/** Get or create the shared SocketManager instance. */
export function getSocketManager(): SocketManager {
  if (!_instance) {
    _instance = new SocketManager();
  }
  return _instance;
}

// ---- backward-compat wrappers (MCP server mode) -----------------------------

// 注意：以下函数仅为 MCP server 模式（src/index.ts）保留向后兼容。
// Gateway 模式应使用 SocketManager 多 profile API。

let _legacySocket: SocketModeClient | null = null;

/** Resolve user/channel names for a stored event (best effort). */
export async function enrichEvent(event: StoredEvent): Promise<StoredEvent> {
  // MCP server mode uses the legacy singleton web client.
  const { getWebClient } = await import("./slack-clients.js");
  const web = getWebClient();

  if (event.channel && !event.channel_name) {
    try {
      const info = await web.conversations.info({ channel: event.channel });
      if (info.channel) {
        event.channel_name =
          (info.channel as Record<string, unknown>).name as string | undefined;
      }
    } catch {
      // Channel info not available
    }
  }

  if (event.user && !event.user_name) {
    try {
      const info = await web.users.info({ user: event.user });
      if (info.user) {
        event.user_name =
          (info.user as Record<string, unknown>).real_name as
            | string
            | undefined;
      }
    } catch {
      // User info not available
    }
  }

  return event;
}

/**
 * Start a single Socket Mode connection (MCP server backward compat).
 *
 * For multi-profile use, create a SocketManager and call startProfile() /
 * startAll() instead.
 */
export async function startSocketMode(
  onEvent: (event: StoredEvent) => void,
  onSlash?: SlashCallback,
  onBlockAction?: BlockActionCallback,
): Promise<void> {
  const { getAppToken, getWebClient } = await import("./slack-clients.js");
  const appToken = getAppToken();

  let botUserId: string | null = null;
  try {
    const web = getWebClient();
    const auth = await web.auth.test();
    botUserId = auth.user_id ?? null;
    console.error(`[chorusgate-mcp] Bot user ID: ${botUserId}`);
  } catch (err) {
    console.error(
      "[chorusgate-mcp] Failed to resolve bot user ID, " +
        "self-message filtering disabled:",
      (err as Error).message,
    );
  }

  _legacySocket = new SocketModeClient({
    appToken,
    logLevel: LogLevel.INFO,
  });

  _legacySocket.on("connecting", () => {
    console.error("[chorusgate-mcp] Connecting to Slack via Socket Mode...");
  });
  _legacySocket.on("connected", () => {
    console.error("[chorusgate-mcp] Socket Mode connected");
  });
  _legacySocket.on("ready", () => {
    console.error("[chorusgate-mcp] Socket Mode ready, listening for events");
  });
  _legacySocket.on("disconnecting", () => {
    console.error("[chorusgate-mcp] Socket Mode disconnecting...");
  });
  _legacySocket.on("reconnecting", () => {
    console.error("[chorusgate-mcp] Socket Mode reconnecting...");
  });
  _legacySocket.on("error", (error) => {
    console.error(
      "[chorusgate-mcp] Socket Mode error:",
      (error as Error).message,
    );
  });

  // --- event handlers (delegate to the same internal conversion) ---

  const pushEvent = (type: SlackEventType, rawEvent: unknown): StoredEvent => {
    const evt = rawEvent as Record<string, unknown>;
    const item = evt.item as Record<string, unknown> | undefined;
    return eventStore.push({
      type,
      subtype: evt.subtype as string | undefined,
      channel:
        (evt.channel as string) || (item?.channel as string) || "",
      user: (evt.user as string) || "",
      text: (evt.text as string) || "",
      ts: (evt.ts as string) || (evt.event_ts as string) || "",
      thread_ts: evt.thread_ts as string | undefined,
      reaction: evt.reaction as string | undefined,
      reaction_user: evt.user as string | undefined,
      reaction_item_channel: item?.channel as string | undefined,
      reaction_item_ts: item?.ts as string | undefined,
      user_name: undefined,
      channel_name: undefined,
      raw: rawEvent,
    });
  };

  _legacySocket.on("app_mention", async ({ event, ack }) => {
    const stored = pushEvent("app_mention", event);
    await ack();
    onEvent(stored);
  });

  _legacySocket.on("message", async ({ event, ack }) => {
    if (botUserId && (event as Record<string, unknown>).user === botUserId) {
      await ack();
      return;
    }
    const subtype = (event as Record<string, unknown>).subtype as
      | string
      | undefined;
    if (subtype === "bot_message") {
      await ack();
      return;
    }
    const stored = pushEvent("message", event);
    await ack();
    onEvent(stored);
  });

  _legacySocket.on("reaction_added", async ({ event, ack }) => {
    const stored = pushEvent("reaction_added", event);
    await ack();
    onEvent(stored);
  });

  _legacySocket.on("slash_commands", async ({ body, ack }) => {
    await ack();
    if (onSlash) {
      const cmd: SlashCommand = {
        command: (body.command as string) || "",
        text: ((body.text as string) || "").trim(),
        channelId: (body.channel_id as string) || "",
        userId: (body.user_id as string) || "",
        userName: (body.user_name as string) || undefined,
        profileId: "default",
      };
      try {
        await onSlash(cmd);
      } catch (err) {
        console.error(
          "[chorusgate-mcp] slash command handler error:",
          (err as Error).message,
        );
      }
    }
  });

  _legacySocket.on("interactive", async ({ body, ack }) => {
    const payload = body as Record<string, unknown>;
    if (payload.type !== "block_actions") {
      await ack();
      return;
    }
    await ack();
    if (!onBlockAction) return;

    const actions = payload.actions as Array<Record<string, unknown>> | undefined;
    if (!actions || actions.length === 0) return;

    for (const action of actions) {
      const ch = payload.channel as Record<string, unknown> | undefined;
      const usr = payload.user as Record<string, unknown> | undefined;
      const msg = payload.message as Record<string, unknown> | undefined;
      const container = payload.container as Record<string, unknown> | undefined;
      const blockAction: BlockAction = {
        type: "block_actions",
        channelId: ((ch?.id || payload.channel_id || "") as string),
        userId: ((usr?.id || payload.user_id || "") as string),
        actionValue: (action.value as string) || "",
        actionId: (action.action_id as string) || "",
        messageTs: ((msg?.ts || container?.message_ts || "") as string),
        profileId: "default",
      };
      try {
        await onBlockAction(blockAction);
      } catch (err) {
        console.error(
          "[chorusgate-mcp] block_action handler error:",
          (err as Error).message,
        );
      }
    }
  });

  await _legacySocket.start();
}

/** Stop the legacy Socket Mode connection (MCP server backward compat). */
export async function stopSocketMode(): Promise<void> {
  if (_legacySocket) {
    await _legacySocket.disconnect();
    _legacySocket = null;
  }
}
