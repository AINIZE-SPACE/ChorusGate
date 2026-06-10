// ============================================================
// Gateway control-plane file paths
//
// Shared between the daemon (gateway.ts) and the control CLI
// (gateway-control.ts). Resolved from this file's own location so they
// don't depend on the process cwd. The daemon writes PID + status here;
// the control commands read them.
// ============================================================

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

/** Control-plane directory (gitignored). */
export const GATEWAY_DIR = resolve(projectRoot, ".gateway");
/** PID of the running daemon. */
export const PID_FILE = resolve(GATEWAY_DIR, "gateway.pid");
/** Daemon stdout/stderr when started in the background. */
export const LOG_FILE = resolve(GATEWAY_DIR, "gateway.log");
/** Periodic runtime snapshot the daemon writes for status/list. */
export const STATUS_FILE = resolve(GATEWAY_DIR, "status.json");
/** Absolute path to the bin dispatcher (for detached spawn). */
export const BIN_FILE = resolve(projectRoot, "bin", "slack-gateway.mjs");

/** Ensure the control-plane directory exists. */
export function ensureGatewayDir(): void {
  mkdirSync(GATEWAY_DIR, { recursive: true });
}

/** Shape of status.json written by the daemon. */
export interface GatewayStatus {
  pid: number;
  startedAt: number;
  updatedAt: number;
  activeSlots: number;
  maxConcurrent: number;
  sessions: Array<{
    key: string;
    sessionId: string;
    started: boolean;
    lastUsed: number;
  }>;
}
