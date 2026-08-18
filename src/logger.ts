// ============================================================
// Logger — timestamped, self-rotating log writer
//
// Issue #141: daemon 日志无日期/无轮转。
//
// Key design: the logger OWNS its file and writes synchronously via
// appendFileSync — there is NO persistent fd, so external rename-based
// rotation can never strand writes in a renamed file (the classic
// logrotate trap; no dup2 equivalent on Windows). Rotation is
// stat-before-write → rename → next write recreates a fresh file.
//
// Zero dependencies (no pino/winston): runtime deps stay thin.
// Format: [ts YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [module] msg
//
// Note: the earlier iteration used createWriteStream; we moved to
// appendFileSync because (a) the daemon's volume is a handful of lines
// per Slack event, (b) it removes the async flush/ordering surface
// entirely (deterministic, testable), and (c) it eliminates the fd-hold
// concern more thoroughly than a self-managed stream does.
// ============================================================

import {
  statSync,
  renameSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { resolve, basename, dirname } from "node:path";

export interface LoggerOptions {
  /** Absolute path of the log file (e.g. ~/.chorusgate/<agent>/gateway.log). */
  logFile: string;
  /** Single-file size cap in bytes before rotation (default 5MB). */
  maxSize?: number;
  /** Daily-rotation files kept before pruning (default 7). */
  keepDays?: number;
  /** Minimum level to emit. */
  level?: "debug" | "info" | "warn" | "error";
}

export interface Logger {
  log(level: string, module: string, msg: string, ...args: unknown[]): void;
  debug(module: string, msg: string, ...args: unknown[]): void;
  info(module: string, msg: string, ...args: unknown[]): void;
  warn(module: string, msg: string, ...args: unknown[]): void;
  error(module: string, msg: string, ...args: unknown[]): void;
  /** Wait until all writes have reached the file (no-op: writes are sync). */
  flush(): Promise<void>;
  /** Close the logger (no-op: no held stream; retained for API stability). */
  close(): Promise<void>;
}

const LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Zero-pad a number to `width` digits. */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Local-time timestamp, ISO-ish: 2026-08-18 17:30:05.123 */
function fmtTs(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.` +
    `${pad(d.getMilliseconds(), 3)}`
  );
}

/** Serialize extra args (objects → JSON, else String()), collapsed to one line. */
function fmtArg(a: unknown): string {
  let s: string;
  if (typeof a === "string") s = a;
  else if (a instanceof Error) s = a.stack || a.message;
  else if (a && typeof a === "object") {
    try {
      s = JSON.stringify(a);
    } catch {
      s = String(a);
    }
  } else s = String(a);
  // One log entry = one line: collapse embedded newlines.
  return s.replace(/\r?\n/g, " \\n ");
}

/**
 * Create a self-rotating logger.
 *
 * Rotation happens before each write: if the current file size exceeds
 * maxSize, or the file's mtime crossed a day boundary since last check,
 * rename the file to `<file>.<YYYYMMDD>.old` (the next append recreates
 * a fresh file), and prune `.old` files older than keepDays.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const logFile = resolve(opts.logFile);
  const maxSize = opts.maxSize ?? 5 * 1024 * 1024;
  const keepDays = opts.keepDays ?? 7;
  const minLevel = LEVEL_ORDER[opts.level ?? "info"] ?? 1;

  const dir = dirname(logFile);

  /** Today as YYYYMMDD (local time). */
  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  /** YYYYMMDD of the file's mtime (falls back to today). */
  function dayOf(file: string): string {
    try {
      const m = statSync(file).mtime;
      return `${m.getFullYear()}${pad(m.getMonth() + 1)}${pad(m.getDate())}`;
    } catch {
      return todayStr();
    }
  }

  /** Prune gateway.log.*.old files older than keepDays. */
  function prune(): void {
    try {
      const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
      const prefix = basename(logFile) + ".";
      for (const entry of readdirSync(dir)) {
        if (!entry.startsWith(prefix) || !entry.endsWith(".old")) continue;
        const full = resolve(dir, entry);
        try {
          if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
        } catch {
          // ignore (concurrent prune / permission)
        }
      }
    } catch {
      // directory unreadable — skip pruning this round
    }
  }

  function write(level: string, module: string, msg: string, ...args: unknown[]): void {
    if ((LEVEL_ORDER[level] ?? 1) < minLevel) return;
    const line =
      `[ts ${fmtTs(new Date())}] [${level.toUpperCase()}] [${module}] ` +
      msg.replace(/\r?\n/g, " \\n ") +
      (args.length > 0 ? " " + args.map(fmtArg).join(" ") : "") +
      "\n";
    try {
      // Rotate before writing (best-effort; never let logging break the daemon).
      // Condition: file over size cap, OR its mtime-day is not today (covers
      // natural midnight crossing and a stale file carried over from a
      // previous day). No fd is held open, so rename is safe even on Windows.
      try {
        const st = statSync(logFile);
        const fileDay = dayOf(logFile);
        if (st.size >= maxSize || fileDay !== todayStr()) {
          const target = `${logFile}.${fileDay}.old`;
          const finalTarget = existsSync(target) ? `${target}.${Date.now()}` : target;
          renameSync(logFile, finalTarget);
          prune();
        }
      } catch {
        // stat failed (file missing) — nothing to rotate; append recreates it.
      }
      // Ensure the parent dir exists (logger inits before ensureGatewayDir).
      mkdirSync(dir, { recursive: true });
      appendFileSync(logFile, line, "utf8");
    } catch {
      // Logging must never crash the daemon — fall back to stderr.
      process.stderr.write(line);
    }
  }

  return {
    log: write,
    debug: (m, msg, ...a) => write("debug", m, msg, ...a),
    info: (m, msg, ...a) => write("info", m, msg, ...a),
    warn: (m, msg, ...a) => write("warn", m, msg, ...a),
    error: (m, msg, ...a) => write("error", m, msg, ...a),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

/**
 * Route console.log/warn/error through a logger so every line written by any
 * module in the daemon process lands in the rotating log with module "daemon".
 * Returns a restore function (tests use it to put the original console back).
 *
 * Each console call becomes one log line: args are String()-serialized (Errors
 * use their stack), joined with spaces, and embedded newlines are collapsed.
 */
export function redirectConsoleToLogger(logger: Logger): () => void {
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const fmt = (a: unknown[]): string =>
    a
      .map((x) => (x instanceof Error ? (x.stack ?? x.message) : String(x)))
      .join(" ")
      .replace(/\r?\n/g, " \\n ");
  console.log = (...a: unknown[]) => logger.info("daemon", fmt(a));
  console.warn = (...a: unknown[]) => logger.warn("daemon", fmt(a));
  console.error = (...a: unknown[]) => logger.error("daemon", fmt(a));
  return () => {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  };
}
