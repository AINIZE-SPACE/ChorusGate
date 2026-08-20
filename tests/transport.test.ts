// ============================================================
// transport.test — #147 传输模式配置（transport 解析 + spawn env 构造）
//
// Covers（对齐小马 SIT D1 测试域 + L1 "transport 配置解析"）：
//   1) parseTransportMode：默认回退 / 三态合法 / 非法抛错
//   2) slackTransportConfig：默认 direct；proxy 模式解析 CHORUSGATE_PROXY_URL
//   3) agentTransportConfig：默认 inherit；GATEWAY_AGENT_PROXY 兼容 → proxy
//   4) buildAgentSpawnEnv：direct 剥离 / proxy 注入 / inherit 保留
//   5) buildSpawnEnv 向后兼容：默认 inherit = process.env 拷贝 + token
//   6) **不修改全局 process.env**（spec §1 + 小马 D1-5 断言）
//   7) buildSlackAgent：direct/inherit → undefined；proxy → HttpsProxyAgent
// ============================================================

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseTransportMode,
  slackTransportConfig,
  agentTransportConfig,
  buildAgentSpawnEnv,
  buildSlackAgent,
  resolveProxyUrl,
} from "../src/transport.js";
import { buildSpawnEnv } from "../src/providers/_spawn-helpers.js";

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
  saved.CHORUSGATE_SLACK_TRANSPORT = process.env.CHORUSGATE_SLACK_TRANSPORT;
  saved.CHORUSGATE_AGENT_PROXY = process.env.CHORUSGATE_AGENT_PROXY;
  saved.CHORUSGATE_PROXY_URL = process.env.CHORUSGATE_PROXY_URL;
  saved.GATEWAY_AGENT_PROXY = process.env.GATEWAY_AGENT_PROXY;
}

function restoreEnv(): void {
  for (const k of Object.keys(saved)) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  saveEnv();
  // 清掉 shell 继承的代理，保证断言确定。
  for (const k of PROXY_KEYS) delete process.env[k];
  delete process.env.CHORUSGATE_SLACK_TRANSPORT;
  delete process.env.CHORUSGATE_AGENT_PROXY;
  delete process.env.CHORUSGATE_PROXY_URL;
  delete process.env.GATEWAY_AGENT_PROXY;
});

afterEach(() => {
  restoreEnv();
});

describe("parseTransportMode — 模式枚举", () => {
  it("empty/undefined falls back to the default", () => {
    assert.equal(parseTransportMode("T", undefined, "direct"), "direct");
    assert.equal(parseTransportMode("T", "  ", "inherit"), "inherit");
  });

  it("accepts direct|proxy|inherit (case-insensitive)", () => {
    assert.equal(parseTransportMode("T", "direct", "inherit"), "direct");
    assert.equal(parseTransportMode("T", "PROXY", "direct"), "proxy");
    assert.equal(parseTransportMode("T", "Inherit", "proxy"), "inherit");
  });

  it("throws on invalid values (fail-fast)", () => {
    assert.throws(() => parseTransportMode("T", "banana", "direct"), /Invalid T/);
    assert.throws(() => parseTransportMode("T", "direct,proxy", "direct"), /Invalid T/);
  });
});

describe("slackTransportConfig — CHORUSGATE_SLACK_TRANSPORT", () => {
  it("defaults to direct with no proxy URL", () => {
    const cfg = slackTransportConfig();
    assert.equal(cfg.mode, "direct");
    assert.equal(cfg.proxyUrl, undefined);
  });

  it("proxy mode resolves CHORUSGATE_PROXY_URL", () => {
    process.env.CHORUSGATE_SLACK_TRANSPORT = "proxy";
    process.env.CHORUSGATE_PROXY_URL = "http://127.0.0.1:7890";
    const cfg = slackTransportConfig();
    assert.equal(cfg.mode, "proxy");
    assert.equal(cfg.proxyUrl, "http://127.0.0.1:7890");
  });

  it("direct mode ignores CHORUSGATE_PROXY_URL (no proxy URL carried)", () => {
    process.env.CHORUSGATE_PROXY_URL = "http://127.0.0.1:7890";
    const cfg = slackTransportConfig();
    assert.equal(cfg.mode, "direct");
    assert.equal(cfg.proxyUrl, undefined);
  });
});

describe("agentTransportConfig — CHORUSGATE_AGENT_PROXY", () => {
  it("defaults to inherit (backward compat)", () => {
    const cfg = agentTransportConfig();
    assert.equal(cfg.mode, "inherit");
  });

  it("legacy GATEWAY_AGENT_PROXY=<url> → proxy mode with that URL", () => {
    process.env.GATEWAY_AGENT_PROXY = "http://127.0.0.1:7890";
    const cfg = agentTransportConfig();
    assert.equal(cfg.mode, "proxy");
    assert.equal(cfg.proxyUrl, "http://127.0.0.1:7890");
  });

  it("CHORUSGATE_AGENT_PROXY=direct overrides legacy GATEWAY_AGENT_PROXY", () => {
    process.env.CHORUSGATE_AGENT_PROXY = "direct";
    process.env.GATEWAY_AGENT_PROXY = "http://127.0.0.1:7890";
    const cfg = agentTransportConfig();
    assert.equal(cfg.mode, "direct");
  });

  it("proxy mode with CHORUSGATE_PROXY_URL", () => {
    process.env.CHORUSGATE_AGENT_PROXY = "proxy";
    process.env.CHORUSGATE_PROXY_URL = "http://proxy.corp:8080";
    const cfg = agentTransportConfig();
    assert.equal(cfg.mode, "proxy");
    assert.equal(cfg.proxyUrl, "http://proxy.corp:8080");
  });
});

describe("buildAgentSpawnEnv — 子进程 env 按模式构造", () => {
  it("direct strips all proxy vars from the child env", () => {
    const base: Record<string, string | undefined> = {
      http_proxy: "http://inherit:1",
      HTTPS_PROXY: "http://inherit:2",
      PATH: "C:\\bin",
    };
    const env = buildAgentSpawnEnv({ mode: "direct" }, base);
    assert.equal(env.PATH, "C:\\bin");
    for (const k of PROXY_KEYS) {
      assert.equal(env[k], undefined, `${k} should be stripped in direct mode`);
    }
  });

  it("proxy injects the proxy URL into all proxy vars", () => {
    const env = buildAgentSpawnEnv(
      { mode: "proxy", proxyUrl: "http://127.0.0.1:7890" },
      { http_proxy: "http://old:1" },
    );
    for (const k of PROXY_KEYS) {
      assert.equal(env[k], "http://127.0.0.1:7890", `${k} injected`);
    }
  });

  it("inherit keeps the base env unchanged (backward compat)", () => {
    const base: Record<string, string | undefined> = {
      http_proxy: "http://inherit:1",
      HTTPS_PROXY: "http://inherit:2",
    };
    const env = buildAgentSpawnEnv({ mode: "inherit" }, base);
    assert.equal(env.http_proxy, "http://inherit:1");
    assert.equal(env.HTTPS_PROXY, "http://inherit:2");
  });
});

describe("buildSpawnEnv — 向后兼容 + 不改全局 env", () => {
  it("default (inherit): returns a process.env copy with tokens, proxy kept", () => {
    process.env.http_proxy = "http://inherit:1";
    const env = buildSpawnEnv({ botToken: "xoxb-mybot", appToken: "xapp-myapp" });
    assert.equal(env.SLACK_BOT_TOKEN, "xoxb-mybot");
    assert.equal(env.SLACK_APP_TOKEN, "xapp-myapp");
    assert.equal(env.http_proxy, "http://inherit:1", "inherit keeps inherited proxy");
  });

  it("CHORUSGATE_AGENT_PROXY=direct: child env has no proxy, tokens present", () => {
    process.env.http_proxy = "http://inherit:1";
    process.env.CHORUSGATE_AGENT_PROXY = "direct";
    const env = buildSpawnEnv({ botToken: "xoxb" });
    assert.equal(env.SLACK_BOT_TOKEN, "xoxb");
    assert.equal(env.http_proxy, undefined, "direct strips proxy from child env");
  });

  it("NEVER mutates the global process.env (spec §1 / D1-5)", () => {
    process.env.http_proxy = "http://inherit:1";
    process.env.CHORUSGATE_AGENT_PROXY = "direct";
    // Windows env 大小写不敏感：属性访问会跨大小写解析，但枚举只出一次。
    // 用 JSON 快照（枚举口径一致）比较 before/after，避免大小写别名误判。
    const before = JSON.stringify(process.env);
    const childEnv = buildSpawnEnv({ botToken: "xoxb" });
    buildAgentSpawnEnv({ mode: "proxy", proxyUrl: "http://p:1" }, process.env);
    const after = JSON.stringify(process.env);
    assert.equal(after, before, "process.env unchanged (JSON snapshot)");
    // 子进程 env 按 direct 剥离 —— 只作用于返回值，全局 env 不受影响。
    assert.equal(childEnv.SLACK_BOT_TOKEN, "xoxb");
    assert.equal(childEnv.http_proxy, undefined, "child env stripped in direct mode");
    assert.equal(process.env.http_proxy, "http://inherit:1", "daemon env untouched");
  });
});

describe("buildSlackAgent — Slack proxy agent", () => {
  it("direct / inherit → undefined (直连)", () => {
    assert.equal(buildSlackAgent({ mode: "direct" }), undefined);
    assert.equal(buildSlackAgent({ mode: "inherit" }), undefined);
  });

  it("proxy without URL → undefined (回退直连)", () => {
    assert.equal(buildSlackAgent({ mode: "proxy" }), undefined);
  });

  it("proxy with URL → HttpsProxyAgent instance", () => {
    const agent = buildSlackAgent({ mode: "proxy", proxyUrl: "http://127.0.0.1:7890" });
    assert.ok(agent, "should build an agent in proxy mode");
    assert.match(agent.constructor.name, /ProxyAgent/i);
  });
});

describe("resolveProxyUrl — 优先级", () => {
  it("CHORUSGATE_PROXY_URL > GATEWAY_AGENT_PROXY > inherited env", () => {
    process.env.CHORUSGATE_PROXY_URL = "http://new:1";
    process.env.GATEWAY_AGENT_PROXY = "http://legacy:1";
    process.env.https_proxy = "http://inherit:1";
    assert.equal(resolveProxyUrl(), "http://new:1");
    delete process.env.CHORUSGATE_PROXY_URL;
    assert.equal(resolveProxyUrl(), "http://legacy:1");
    delete process.env.GATEWAY_AGENT_PROXY;
    assert.equal(resolveProxyUrl(), "http://inherit:1");
  });
});
