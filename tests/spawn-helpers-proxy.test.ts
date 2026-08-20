// ============================================================
// spawn-helpers-proxy.test — #148 代理隔离（daemon 直连 + spawn 注入）
//
// Covers（AC1）：
//   1) daemonizeProxyEnv 未调用时 buildSpawnEnv 继承原 env（向后兼容）
//   2) daemonizeProxyEnv 捕获代理（GATEWAY_AGENT_PROXY 优先）并从
//      process.env 剥离全部代理变量 → daemon 自身直连
//   3) buildSpawnEnv 把捕获值显式注入子进程 env → spawn 的 agent 走代理
//   4) 幂等：重复调用不重复处理
//
// 注：daemonizeProxyEnv 是模块级单例（每个进程只剥离一次），本文件内按
// 声明顺序执行；restore env 仅恢复 process.env，capturedAgentProxy 保留。
// ============================================================

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  daemonizeProxyEnv,
  buildSpawnEnv,
  isDaemonProxyStripped,
  resetDaemonProxyEnvForTests,
} from "../src/providers/_spawn-helpers.js";

const PROXY_KEYS = [
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
] as const;

let saved: Record<string, string | undefined> = {};

function saveEnv(): void {
  saved = {};
  for (const k of PROXY_KEYS) saved[k] = process.env[k];
  saved.GATEWAY_AGENT_PROXY = process.env.GATEWAY_AGENT_PROXY;
}

function restoreEnv(): void {
  for (const k of PROXY_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (saved.GATEWAY_AGENT_PROXY === undefined) delete process.env.GATEWAY_AGENT_PROXY;
  else process.env.GATEWAY_AGENT_PROXY = saved.GATEWAY_AGENT_PROXY;
}

beforeEach(() => {
  saveEnv();
  // 清掉 shell 继承的代理，保证断言确定。
  for (const k of PROXY_KEYS) delete process.env[k];
  delete process.env.GATEWAY_AGENT_PROXY;
});

afterEach(() => {
  restoreEnv();
  resetDaemonProxyEnvForTests();
});

describe("spawn env — 代理注入 (AC1)", () => {
  it("before daemonizeProxyEnv: buildSpawnEnv inherits process.env (backward compat)", () => {
    assert.equal(isDaemonProxyStripped(), false);
    process.env.http_proxy = "http://inherit:1";
    const env = buildSpawnEnv({});
    assert.equal(env.http_proxy, "http://inherit:1");
  });

  it("daemonizeProxyEnv: GATEWAY_AGENT_PROXY 优先，并剥离 daemon 自身代理", () => {
    process.env.http_proxy = "http://inherit:1";
    process.env.all_proxy = "http://inherit-all:1";
    process.env.GATEWAY_AGENT_PROXY = "http://127.0.0.1:7890";
    const captured = daemonizeProxyEnv();
    assert.equal(captured, "http://127.0.0.1:7890");
    // daemon 自身 env 不再有任何代理变量 → 直连。
    for (const k of PROXY_KEYS) {
      assert.equal(process.env[k], undefined, `${k} should be stripped from daemon env`);
    }
    assert.equal(isDaemonProxyStripped(), true);
  });

  it("buildSpawnEnv injects the captured proxy into child env", () => {
    process.env.GATEWAY_AGENT_PROXY = "http://127.0.0.1:7890";
    daemonizeProxyEnv();
    const env = buildSpawnEnv({});
    for (const k of PROXY_KEYS) {
      assert.equal(env[k], "http://127.0.0.1:7890", `${k} injected into child env`);
    }
    // 子进程 env 是从 daemon env 快照 + 注入代理构成。
    assert.equal(env.http_proxy, "http://127.0.0.1:7890");
  });

  it("fallback: captures inherited proxy when GATEWAY_AGENT_PROXY unset", () => {
    process.env.https_proxy = "http://inherit:2";
    const captured = daemonizeProxyEnv();
    assert.equal(captured, "http://inherit:2");
    const env = buildSpawnEnv({});
    assert.equal(env.https_proxy, "http://inherit:2");
  });

  it("idempotent: second call returns the same captured value", () => {
    process.env.GATEWAY_AGENT_PROXY = "http://127.0.0.1:7890";
    const first = daemonizeProxyEnv();
    const second = daemonizeProxyEnv();
    assert.equal(second, first);
  });
});
