// ============================================================
// ReconnectPolicy — 指数退避 + 随机抖动 + 熔断
//
// #148 重连健壮性：2026-08-20 6am 事故中 @slack/socket-mode 内建重连为线性
// 退避（clientPingTimeoutMS * failures），无上限、无抖动、无熔断 → 网络中断
// 时 5–10s 硬重连风暴，最终崩掉 daemon。本模块为纯逻辑、无副作用，可用假时钟
// 单测（now/random 注入）。
//
// 语义：
//   - 每次失败调用 recordFailure()；连续失败达 circuitOpenAfter 次 → 熔断打开
//     circuitCooldownMs，期间不再发起连接（避免风暴）。
//   - nextDelayMs() 给出下一次尝试前的等待：min(max, base * multiplier^failures)
//     叠加 ±jitterRatio 随机抖动。
//   - 冷却结束后 half-open：允许一次尝试；成功 recordSuccess() 重置全部状态。
//   - 只记录状态与计时，不持有定时器 —— 由 socket-manager 驱动。
// ============================================================

export interface ReconnectPolicyConfig {
  /** 首次重连基础延迟（默认 1000ms）。 */
  baseDelayMs?: number;
  /** 退避上限（默认 60000ms）。 */
  maxDelayMs?: number;
  /** 退避倍率（默认 2）。 */
  multiplier?: number;
  /** 抖动比例 ±jitterRatio（默认 0.3）。 */
  jitterRatio?: number;
  /** 连续失败多少次打开熔断（默认 5）。 */
  circuitOpenAfter?: number;
  /** 熔断保持时长（默认 300000ms = 5min）。 */
  circuitCooldownMs?: number;
  /** 可注入时钟（测试用；默认 Date.now）。 */
  now?: () => number;
  /** 可注入随机源（测试用；默认 Math.random）。 */
  random?: () => number;
}

export class ReconnectPolicy {
  private baseDelayMs: number;
  private maxDelayMs: number;
  private multiplier: number;
  private jitterRatio: number;
  private circuitOpenAfter: number;
  private circuitCooldownMs: number;
  private now: () => number;
  private random: () => number;

  private failures = 0;
  private circuitOpenUntilMs = 0;
  private firstFailureAtMs = 0;

  constructor(cfg: ReconnectPolicyConfig = {}) {
    this.baseDelayMs = cfg.baseDelayMs ?? 1000;
    this.maxDelayMs = cfg.maxDelayMs ?? 60_000;
    this.multiplier = cfg.multiplier ?? 2;
    this.jitterRatio = cfg.jitterRatio ?? 0.3;
    this.circuitOpenAfter = cfg.circuitOpenAfter ?? 5;
    this.circuitCooldownMs = cfg.circuitCooldownMs ?? 300_000;
    this.now = cfg.now ?? (() => Date.now());
    this.random = cfg.random ?? (() => Math.random());
  }

  /** 连续失败次数（供日志/状态展示）。 */
  consecutiveFailures(): number {
    return this.failures;
  }

  /** 首次失败时间戳（供"持续宕机超时"判断）。 */
  firstFailureAt(): number {
    return this.firstFailureAtMs;
  }

  /** 记录一次失败。返回本次是否触发了熔断打开（含冷却时长）。 */
  recordFailure(): { opened: boolean; cooldownMs: number } {
    const nowMs = this.now();
    if (this.failures === 0) this.firstFailureAtMs = nowMs;
    this.failures += 1;
    if (this.failures >= this.circuitOpenAfter) {
      this.circuitOpenUntilMs = nowMs + this.circuitCooldownMs;
      return { opened: true, cooldownMs: this.circuitCooldownMs };
    }
    return { opened: false, cooldownMs: 0 };
  }

  /** 记录一次成功 — 复位全部状态。 */
  recordSuccess(): void {
    this.failures = 0;
    this.circuitOpenUntilMs = 0;
    this.firstFailureAtMs = 0;
  }

  /** 熔断当前是否打开（期间不应发起连接）。 */
  isCircuitOpen(): boolean {
    return this.now() < this.circuitOpenUntilMs;
  }

  /** 距熔断冷却结束还剩多少毫秒（>0）。 */
  circuitRemainingMs(): number {
    const remaining = this.circuitOpenUntilMs - this.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * 下一次尝试前的等待毫秒数：指数退避 + 抖动。
   * 第 n 次失败后的等待 = min(max, base * 2^(n-1))（首次失败即 base）。
   */
  nextDelayMs(): number {
    const attempt = Math.max(0, this.failures - 1);
    const base = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * Math.pow(this.multiplier, attempt),
    );
    const jitter = base * this.jitterRatio * (this.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  /**
   * 熔断打开后，冷却期结束时的下一次尝试是否需要等待。
   * half-open：熔断打开时不可尝试；否则返回可立即尝试。
   */
  canAttempt(): boolean {
    return !this.isCircuitOpen();
  }
}
