// ============================================================
// logger.test — Issue #141 rotating logger
//
// Covers: timestamp format (AC1), size-based rotation (AC2),
// cross-day rotation (AC2), prune of stale .old files (AC3),
// and level filtering. Uses a temp dir per test; the logger owns
// its file, so no stdio fd is involved.
// ============================================================

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  utimesSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, redirectConsoleToLogger } from "../src/logger.js";

let dir: string;
let logFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-log-"));
  logFile = join(dir, "gateway.log");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("logger format (AC1)", () => {
  it("writes [ts YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] [module] msg lines", async () => {
    const logger = createLogger({ logFile, level: "debug" });
    logger.error("gateway", "boom", new Error("x"));
    logger.info("socket-manager", "connected", { retries: 2 });
    await logger.flush();
    await logger.close();

    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    assert.match(
      lines[0],
      /^\[ts \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[ERROR\] \[gateway\] boom Error: x/,
    );
    // Error stack is collapsed onto the same line (one entry = one line).
    assert.equal(lines[0].split("\n").length, 1);
    assert.match(lines[1], /^\[ts \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[socket-manager\] connected \{"retries":2\}$/);
  });
});

describe("logger level filtering", () => {
  it("drops lines below the configured level", async () => {
    const logger = createLogger({ logFile, level: "warn" });
    logger.debug("gateway", "noise");
    logger.info("gateway", "noise too");
    logger.warn("gateway", "keep me");
    await logger.flush();
    await logger.close();

    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\] \[gateway\] keep me$/);
  });
});

describe("logger rotation", () => {
  it("rotates when the file exceeds maxSize, writing into a fresh file (AC2)", async () => {
    const logger = createLogger({ logFile, maxSize: 200 });
    // Two long lines exceed 200 bytes; the 3rd write must trigger rotation.
    logger.error("gateway", "A".repeat(120));
    await logger.flush();
    logger.error("gateway", "B".repeat(120));
    await logger.flush();
    assert.equal(existsSync(logFile), true);

    logger.error("gateway", "fresh after roll");
    await logger.flush();
    await logger.close();

    const olds = readdirSync(dir).filter((f) => f.endsWith(".old"));
    assert.equal(olds.length, 1, "expected exactly one rotated .old file");
    assert.match(olds[0], /^gateway\.log\.\d{8}\.old$/);

    const fresh = readFileSync(logFile, "utf8");
    assert.match(fresh, /fresh after roll/, "new writes go to the new gateway.log");
    assert.doesNotMatch(fresh, /AAAAAAAA/, "old bytes must NOT remain in the new file");
  });

  it("rotates on a day boundary (file mtime backdated) (AC2)", async () => {
    const logger = createLogger({ logFile, maxSize: 1024 * 1024 });
    logger.error("gateway", "before day roll");
    await logger.flush();

    // Backdate mtime to yesterday to simulate crossing midnight.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(logFile, yesterday, yesterday);

    logger.error("gateway", "after day roll");
    await logger.flush();
    await logger.close();

    const olds = readdirSync(dir).filter((f) => f.endsWith(".old"));
    assert.equal(olds.length, 1, "cross-day boundary must rotate once");
    const fresh = readFileSync(logFile, "utf8");
    assert.match(fresh, /after day roll/);
    assert.doesNotMatch(fresh, /before day roll/);
  });

  it("prunes .old files older than keepDays (AC3)", async () => {
    // Seed a stale .old file (8 days old) and a fresh one (1 day old).
    const stale = join(dir, "gateway.log.20260701000000.old");
    const freshOld = join(dir, "gateway.log.20260810000000.old");
    writeFileSync(stale, "old");
    writeFileSync(freshOld, "fresh");
    const oldTs = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, oldTs, oldTs);

    const logger = createLogger({ logFile, maxSize: 50, keepDays: 7 });
    // Force a rotation (size) so prune runs.
    logger.error("gateway", "X".repeat(100));
    await logger.flush();
    logger.error("gateway", "Y");
    await logger.flush();
    await logger.close();

    assert.equal(existsSync(stale), false, "stale .old must be pruned");
    assert.equal(existsSync(freshOld), true, "fresh .old must be kept");
  });
});

describe("logger missing-file tolerance", () => {
  it("creates parent dirs and starts cleanly", async () => {
    const nested = join(dir, "nested", "deep", "gateway.log");
    const logger = createLogger({ logFile: nested });
    logger.error("gateway", "deep write");
    await logger.flush();
    await logger.close();
    assert.match(readFileSync(nested, "utf8"), /deep write/);
  });
});

describe("console redirect (daemon call site)", () => {
  it("routes console.log/warn/error through the logger as module daemon", async () => {
    const logger = createLogger({ logFile, level: "debug" });
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const restore = redirectConsoleToLogger(logger);
    try {
      console.log("hello", 42);
      console.warn("careful");
      console.error("boom", new Error("x"));
    } finally {
      restore();
    }
    // console.* must be put back exactly as they were.
    assert.equal(console.log, origLog);
    assert.equal(console.warn, origWarn);
    assert.equal(console.error, origError);

    await logger.flush();
    await logger.close();

    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 3);
    assert.match(lines[0], /\[INFO\] \[daemon\] hello 42$/);
    assert.match(lines[1], /\[WARN\] \[daemon\] careful$/);
    assert.match(lines[2], /\[ERROR\] \[daemon\] boom Error: x/);
    // One console call = one log line (Error stack stays on a single line).
    assert.equal(lines[2].split("\n").length, 1);
  });

  it("collapses multiline console output onto one log line", async () => {
    const logger = createLogger({ logFile });
    const restore = redirectConsoleToLogger(logger);
    try {
      console.log("line1\nline2\nline3");
    } finally {
      restore();
    }
    await logger.flush();
    await logger.close();

    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /line1 \\n line2 \\n line3$/);
  });
});

describe("logger arg formatting (call-site args)", () => {
  it("serializes primitives inline", async () => {
    const logger = createLogger({ logFile });
    logger.info("gateway", "count", 42, true, null, undefined);
    await logger.flush();
    await logger.close();
    const line = readFileSync(logFile, "utf8").split("\n").filter(Boolean)[0];
    assert.match(line, /\[INFO\] \[gateway\] count 42 true null undefined$/);
  });

  it("falls back to the message when an Error has no stack", async () => {
    const logger = createLogger({ logFile });
    const e = new Error("no-stack") as Error & { stack?: string };
    delete e.stack;
    logger.error("gateway", "err", e);
    await logger.flush();
    await logger.close();
    const line = readFileSync(logFile, "utf8").split("\n").filter(Boolean)[0];
    assert.match(line, /\[ERROR\] \[gateway\] err no-stack$/);
  });

  it("collapses a multiline message onto one line", async () => {
    const logger = createLogger({ logFile });
    logger.warn("gateway", "a\nb");
    await logger.flush();
    await logger.close();
    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /a \\n b$/);
  });

  it("survives circular objects (JSON.stringify fallback)", async () => {
    const logger = createLogger({ logFile });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.info("gateway", "circ", circular);
    await logger.flush();
    await logger.close();
    const line = readFileSync(logFile, "utf8").split("\n").filter(Boolean)[0];
    assert.match(line, /\[INFO\] \[gateway\] circ \[object Object\]$/);
  });

  it("accepts a string level via log() (unknown levels fall back to info priority)", async () => {
    const logger = createLogger({ logFile });
    logger.log("trace", "gateway", "verbose detail");
    await logger.flush();
    await logger.close();
    const line = readFileSync(logFile, "utf8").split("\n").filter(Boolean)[0];
    assert.match(line, /\[TRACE\] \[gateway\] verbose detail$/);
  });
});

describe("logger fail-closed behavior", () => {
  it("falls back to stderr when the log file cannot be written", async () => {
    // Point the logger at a directory → appendFileSync fails (EISDIR).
    const asDir = join(dir, "is-a-dir");
    mkdirSync(asDir);
    const logger = createLogger({ logFile: asDir });

    const chunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;
    try {
      logger.info("gateway", "to stderr");
    } finally {
      process.stderr.write = origWrite;
    }
    await logger.flush();
    await logger.close();

    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /\[INFO\] \[gateway\] to stderr/);
  });
});
