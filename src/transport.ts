// ============================================================
// transport — Slack 直连 / agent 代理 传输模式配置 (#147/#148)
//
// #147 spec §1：Slack Web API + Socket Mode 支持显式 transport 模式
//   direct | proxy | inherit（默认 direct）；agent CLI 子进程按
//   CHORUSGATE_AGENT_PROXY=direct|proxy|inherit 构造 env（默认 inherit
//   保持向后兼容）。CHORUSGATE_PROXY_URL 提供代理 URL。
//
// 关键约束（spec §1 + 小马 SIT D1-5）：**不得通过全局修改 process.env
// 实现隔离**，避免 Slack transport 与 provider 子进程互相污染。
// 本模块不修改 process.env —— direct 依赖 @slack SDK 本身不走代理
// （@slack/web-api v7 proxy:false；socket-mode 未配 proxy agent，
// ws 不读 HTTP_PROXY），子进程 env 由 buildAgentSpawnEnv 显式构造。
//
// 兼容性：旧配置 GATEWAY_AGENT_PROXY=<URL> 视为 agent proxy 模式
// （该值即代理 URL），go.ps1 部署零改动迁移。
// ============================================================

import { createRequire } from "node:module";
import type http from "node:http";

export type TransportMode = "direct" | "proxy" | "inherit";

export interface TransportConfig {
  mode: TransportMode;
  /** 代理 URL（mode=proxy 且有可用 URL 时）。 */
  proxyUrl?: string;
}

const PROXY_VARS = [
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
] as const;

/**
 * 解析 transport 模式枚举。空值回退默认；非法值抛错（fail-fast，避免
 * 配置拼写错误导致静默走错网络路径）。
 */
export function parseTransportMode(
  name: string,
  raw: string | undefined,
  fallback: TransportMode,
): TransportMode {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "direct" || v === "proxy" || v === "inherit") return v;
  throw new Error(
    `Invalid ${name}: "${raw}" — expected direct|proxy|inherit`,
  );
}

/** 解析代理 URL：CHORUSGATE_PROXY_URL > GATEWAY_AGENT_PROXY（旧配置）> 继承的代理 env。 */
export function resolveProxyUrl(): string | undefined {
  if (process.env.CHORUSGATE_PROXY_URL) return process.env.CHORUSGATE_PROXY_URL;
  if (process.env.GATEWAY_AGENT_PROXY) return process.env.GATEWAY_AGENT_PROXY;
  for (const k of PROXY_VARS) {
    if (process.env[k]) return process.env[k];
  }
  return undefined;
}

/**
 * Slack transport 配置：CHORUSGATE_SLACK_TRANSPORT，默认 direct。
 * direct = Slack 直连（@slack SDK 天然不走代理，无需改 process.env）；
 * proxy = 经 CHORUSGATE_PROXY_URL 代理（buildSlackAgent 构造 agent）；
 * inherit = 不干预（SDK 行为与 direct 一致，保留显式选项语义）。
 */
export function slackTransportConfig(): TransportConfig {
  const mode = parseTransportMode(
    "CHORUSGATE_SLACK_TRANSPORT",
    process.env.CHORUSGATE_SLACK_TRANSPORT,
    "direct",
  );
  return { mode, proxyUrl: mode === "proxy" ? resolveProxyUrl() : undefined };
}

/**
 * agent CLI 子进程代理配置：CHORUSGATE_AGENT_PROXY，默认 inherit。
 * - inherit（默认）：子进程继承宿主代理 env（向后兼容，go.ps1 现状）。
 * - direct：子进程 env 剥离全部代理变量（直连 Anthropic/GitHub）。
 * - proxy：子进程 env 注入 CHORUSGATE_PROXY_URL 代理。
 * 旧配置 GATEWAY_AGENT_PROXY=<URL> 存在 → 视为 proxy 模式。
 */
export function agentTransportConfig(): TransportConfig {
  const raw = process.env.CHORUSGATE_AGENT_PROXY;
  if (raw === undefined || raw.trim() === "") {
    if (process.env.GATEWAY_AGENT_PROXY) {
      return { mode: "proxy", proxyUrl: process.env.GATEWAY_AGENT_PROXY };
    }
    return { mode: "inherit", proxyUrl: resolveProxyUrl() };
  }
  const mode = parseTransportMode("CHORUSGATE_AGENT_PROXY", raw, "inherit");
  return { mode, proxyUrl: mode === "proxy" ? resolveProxyUrl() : undefined };
}

/**
 * 构造 Slack transport 的 http.Agent（proxy 模式）。direct/inherit 或无
 * URL 时返回 undefined（直连）。HttpsProxyAgent 同时覆盖 wss 与 https。
 * https-proxy-agent 为 CJS 包，用 createRequire 惰性加载；缺失时返回
 * undefined（调用方应记录回退，不硬失败）。
 */
export function buildSlackAgent(cfg: TransportConfig): http.Agent | undefined {
  if (cfg.mode !== "proxy" || !cfg.proxyUrl) return undefined;
  try {
    const { HttpsProxyAgent } = createRequire(import.meta.url)(
      "https-proxy-agent",
    ) as typeof import("https-proxy-agent");
    return new HttpsProxyAgent(cfg.proxyUrl) as unknown as http.Agent;
  } catch {
    return undefined;
  }
}

/**
 * 按 agent transport 配置构造 spawn 子进程 env。
 * 只作用于返回值（子进程 env），不改 process.env。
 */
export function buildAgentSpawnEnv(
  cfg: TransportConfig,
  base: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const env = { ...base };
  if (cfg.mode === "direct") {
    for (const k of PROXY_VARS) delete env[k];
  } else if (cfg.mode === "proxy" && cfg.proxyUrl) {
    for (const k of PROXY_VARS) env[k] = cfg.proxyUrl;
  }
  // inherit: 保持 base 原样（含继承的代理变量）。
  return env;
}

/** 日志安全的传输配置描述（只露 mode + 代理 URL 的 host，不露认证信息）。 */
export function describeTransport(
  role: "slack" | "agent",
  cfg: TransportConfig,
): string {
  const url = cfg.proxyUrl
    ? safeUrl(cfg.proxyUrl)
    : "(无 URL，直连)";
  return `${role}=${cfg.mode}${cfg.mode === "proxy" ? " " + url : ""}`;
}

/** 提取 URL 的 host 部分（屏蔽 userinfo/query/token）。 */
function safeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    return parsed.host || u;
  } catch {
    return "(无法解析)";
  }
}
