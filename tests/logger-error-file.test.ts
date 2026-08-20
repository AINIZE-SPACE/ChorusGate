// ============================================================
// logger-error-file.test — #148 独立异常日志 + 全局异常捕捉
//
// Covers: error 级额外写 error.log（AC2）、非 error 不污染 error.log、
// error.log 独立轮转、installGlobalErrorHandlers 的 unhandledRejection
// 记录后继续运行（不崩进程）。
//
// 注：uncaughtException 路径会 process.exit(1)（交 watchdog），无法在
// 测试 worker 内直接触发，已由代码审查覆盖；此处只测不会退出进程的
// unhandledRejection 路径。
// ============================================================

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createLogger,
  installGlobalErrorHandlers,
} from "../src/logger.js";

let dir: string;
let logFile: string;
let errorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cg-errlog-"));
  logFile = join(dir, "gateway.log");
  errorFile = join(dir, "error.log");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("error.log — 独立异常日志 (AC2)", () => {
  it("writes error-level lines to both gateway.log and error.log", async () => {
    const logger = createLogger({ logFile, errorFile, level: "debug" });
    logger.info("m", "info line");
    logger.error("m", "boom", new Error("kaboom"));
    logger.warn("m", "warn line");
    logger.flush();

    const err = readFileSync(errorFile, "utf8");
    const main = readFileSync(logFile, "utf8");
    assert.match(err, /\[ERROR\] \[m\] boom/);
    assert.match(err, /kaboom/); // Error 序列化为 stack
    assert.match(main, /\[ERROR\] \[m\] boom/);
    assert.doesNotMatch(err, /info line/);
    assert.doesNotMatch(err, /warn line/);
    // error 行在两条文件里都在；info/warn 只在主日志。
    assert.match(main, /info line/);
    assert.match(main, /warn line/);
  });

  it("does not create error.log when no errors occur", async () => {
    const logger = createLogger({ logFile, errorFile });
    logger.info("m", "only info");
    logger.flush();
    assert.ok(existsSync(logFile));
    assert.ok(!existsSync(errorFile), "error.log should not exist without errors");
  });

  it("rotates error.log independently by size", async () => {
    // 小 maxSize 触发轮转
    const logger = createLogger({ logFile, errorFile, maxSize: 512 });
    for (let i = 0; i < 200; i++) {
      logger.error("m", `error line ${i} with padding ....................`);
    }
    logger.flush();
    const olds = readdirSync(dir).filter((f) => f.startsWith("error.log.") && f.endsWith(".old"));
    assert.ok(olds.length > 0, "error.log should have rotated old files");
    assert.ok(statSync(errorFile).size <= 512, "error.log capped by maxSize");
  });

  it("installs global handlers and survives an unhandledRejection", () => {
    // 在子进程中验证：node:test 自己的 runner 会把进程内 unhandledRejection
    // 判为测试失败，无法在测试 worker 内直接触发；子进程更接近真实 daemon
    // （无测试 runner 干扰）。子进程安装 handler → 制造 rejection → 等待 →
    // 打印 SURVIVED 并退出 0；父进程断言 error.log 记录了兜底日志。
    const loggerSrc = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../src/logger.js")).href;
    const childSrc = [
      `import { createLogger, installGlobalErrorHandlers } from ${JSON.stringify(loggerSrc)};`,
      `const logger = createLogger({ logFile: ${JSON.stringify(logFile)}, errorFile: ${JSON.stringify(errorFile)} });`,
      `installGlobalErrorHandlers(logger);`,
      // 无人处理 → 全局兜底捕获，记录后继续运行，进程不退出。
      `Promise.reject(new Error("boom-unhandled-rejection"));`,
      `setTimeout(async () => {`,
      `  await new Promise((r) => setTimeout(r, 50));`,
      `  logger.flush();`,
      `  process.stdout.write("SURVIVED");`,
      `  process.exit(0);`,
      `}, 200);`,
    ].join("\n");
    const childFile = join(dir, "child-unhandled-rejection.mjs");
    writeFileSync(childFile, childSrc);

    const res = spawnSync(process.execPath, ["--import", "tsx", childFile], {
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(res.status, 0, `child should survive: ${res.stderr}`);
    assert.match(res.stdout, /SURVIVED/);
    const err = readFileSync(errorFile, "utf8");
    assert.match(err, /UNHANDLED_REJECTION/);
    assert.match(err, /boom-unhandled-rejection/);
  });
});
