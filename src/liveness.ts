// ============================================================
// Liveness monitor — suspend detection + zombie-socket detection
//
// Issue: 休眠唤醒后 Gateway 进程不恢复（心跳 + 挂起检测 + 自愈）
// Spec: docs/specs/issue-liveness-suspend-recovery.md §2.1
//
// Three layers, escalating only when the previous one fails:
//   Layer 1 — suspend detection (clock jump): the statusTimer cadence
//             is 5s; if a tick arrives > suspendJumpMs after the previous
//             one, the machine was frozen (hibernated). The first tick
//             after resume is by definition a late tick — zero cost.
//   Layer 2 — zombie detection (liveness probe): every probeIntervalMs,
//             ask the connection probe (SocketManager.isActive). N
//             consecutive failures = the socket is half-open / fake-alive;
//             force a reconnect. A half-open TCP cannot self-heal by
//             waiting — it must be actively torn down.
//   Layer 3 — unrecoverable: the gateway decides (reconnect still failing
//             after forcing) and calls process.exit(1); the watchdog then
//             restarts us. This module only reports; it never exits.
//
// Zero noise (spec AC4): normal ticks and passing probes log nothing.
// Only anomalies (suspend, zombie, reconnect) produce log lines.
//
// Testability: the Monitor exposes tick(now)/probe(now) so tests drive
// the logic with fake clocks; start() only installs real (unref'd)
// intervals for the daemon. Config is injected, never read from env
// here — gateway.ts owns env parsing.
// ============================================================

/** Log sink signature — structural match for logger.ts Logger. */
export type LivenessLogFn = (
  level: "debug" | "info" | "warn" | "error",
  module: string,
  msg: string,
  ...args: unknown[]
) => void;

export interface LivenessConfig {
  /** Cadence of the heartbeat tick (mirrors the statusTimer; default 5000). */
  tickIntervalMs?: number;
  /** Layer 1: a tick arriving this late (ms) means a suspend happened. */
  suspendJumpMs?: number;
  /** Layer 2: how often to probe the socket (default 60000). */
  probeIntervalMs?: number;
  /** Layer 2: consecutive probe failures before forcing a reconnect. */
  failureLimit?: number;
}

export interface LivenessHooks {
  /** Layer 2 probe source — true if the socket is believed active. */
  isConnected: () => boolean;
  log: LivenessLogFn;
  /** Layer 1 fired with the detected jump in seconds (rounded). */
  onSuspendDetected?: (jumpSeconds: number) => void;
  /** Layer 2 fired when failureLimit consecutive probes failed. */
  onZombieDetected?: () => void;
  /** Layer 3 fired when recovery is judged hopeless (gateway exits). */
  onUnrecoverable?: () => void;
}

export class LivenessMonitor {
  private readonly cfg: Required<LivenessConfig>;
  private readonly hooks: LivenessHooks;
  private lastTickAt: number | null = null;
  private consecutiveFailures = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(config: LivenessConfig, hooks: LivenessHooks) {
    this.cfg = {
      tickIntervalMs: config.tickIntervalMs ?? 5000,
      suspendJumpMs: config.suspendJumpMs ?? 60_000,
      probeIntervalMs: config.probeIntervalMs ?? 60_000,
      failureLimit: config.failureLimit ?? 3,
    };
    this.hooks = hooks;
  }

  // ---- Layer 1: suspend detection (clock jump) ------------------------------

  /** Run one heartbeat tick. `now` is injectable for tests. */
  tick(now: number = Date.now()): void {
    if (this.stopped) return;
    if (this.lastTickAt === null) {
      // First tick anchors the baseline; nothing to compare yet.
      this.lastTickAt = now;
      return;
    }
    const jump = now - this.lastTickAt;
    this.lastTickAt = now;
    if (jump > this.cfg.suspendJumpMs) {
      const seconds = Math.round(jump / 1000);
      this.hooks.log(
        "warn",
        "liveness",
        `suspend detected: ${seconds}s jump (previous tick ${jump}ms ago)`,
      );
      this.hooks.onSuspendDetected?.(seconds);
    }
  }

  // ---- Layer 2: zombie-socket detection (liveness probe) --------------------

  /** Run one connection probe. `now` kept for API symmetry with tick. */
  probe(now: number = Date.now()): void {
    void now;
    if (this.stopped) return;
    let ok = false;
    try {
      ok = this.hooks.isConnected();
    } catch {
      ok = false;
    }
    if (ok) {
      if (this.consecutiveFailures > 0) {
        this.hooks.log(
          "info",
          "liveness",
          `socket healthy again after ${this.consecutiveFailures} failed probe(s)`,
        );
      }
      this.consecutiveFailures = 0;
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.cfg.failureLimit) {
      this.hooks.log(
        "warn",
        "liveness",
        `zombie socket detected: ${this.consecutiveFailures} consecutive probe failures — forcing reconnect`,
      );
      this.consecutiveFailures = 0; // reset so a failed reconnect re-escalates
      try {
        this.hooks.onZombieDetected?.();
      } catch {
        this.hooks.log(
          "error",
          "liveness",
          "forced reconnect threw — declaring unrecoverable",
        );
        this.hooks.onUnrecoverable?.();
      }
    }
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Install the real (unref'd) intervals. Safe to call once; restarts after stop(). */
  start(): void {
    if (this.tickTimer) return; // already running
    this.stopped = false;
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this.tick(), this.cfg.tickIntervalMs);
    this.tickTimer.unref?.();
    this.probeTimer = setInterval(() => this.probe(), this.cfg.probeIntervalMs);
    this.probeTimer.unref?.();
  }

  /** Tear down intervals and disable tick/probe until the next start(). */
  stop(): void {
    this.stopped = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.tickTimer = null;
    this.probeTimer = null;
    this.lastTickAt = null;
    this.consecutiveFailures = 0;
  }
}

/** Convenience wrapper: construct, start, return a stop function. */
export function startLivenessMonitor(
  config: LivenessConfig,
  hooks: LivenessHooks,
): () => void {
  const mon = new LivenessMonitor(config, hooks);
  mon.start();
  return () => mon.stop();
}
