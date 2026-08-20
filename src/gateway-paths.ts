// ============================================================
// Gateway control-plane file paths
//
// Shared between the daemon (gateway.ts) and the control CLI
// (gateway-control.ts).
//
// A ChorusGate agent is a cross-project process: all process-level
// files (pid, status, log) live under the agent's isolated home
// ~/.chorusgate/<agent-id>/, independent of the current working
// directory. Omitting --agent resolves to the "default" agent.
// The project-local .gateway/ is NOT the daemon home — it may only
// hold project-scoped state for the current project and its agent.
// ============================================================

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { CHORUSGATE_HOME } from "./load-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

/** Absolute path to the bin dispatcher (for detached spawn, always relative to
 *  the package root regardless of cwd). */
export const BIN_FILE = resolve(projectRoot, "bin", "chorusgate.mjs");

/** Agent used when --agent is omitted (`run` ≡ `run --agent default`). */
export const DEFAULT_AGENT = "default";

/** Isolated home of a cross-project agent's process-level state. */
export function getAgentHome(agentId = DEFAULT_AGENT): string {
  return resolve(CHORUSGATE_HOME, agentId);
}

/** Control-plane directory for an agent — its home, not the project. */
export function getGatewayDir(agentId = DEFAULT_AGENT): string {
  return getAgentHome(agentId);
}

/** PID of the running daemon for an agent. */
export function getPidFile(agentId = DEFAULT_AGENT): string {
  return resolve(getGatewayDir(agentId), "gateway.pid");
}

/** Daemon stdout/stderr when started in the background. */
export function getLogFile(agentId = DEFAULT_AGENT): string {
  return resolve(getGatewayDir(agentId), "gateway.log");
}

/** Periodic runtime snapshot the daemon writes for status/list. */
export function getStatusFile(agentId = DEFAULT_AGENT): string {
  return resolve(getGatewayDir(agentId), "status.json");
}

/** Ensure the control-plane directory exists. */
export function ensureGatewayDir(agentId = DEFAULT_AGENT): void {
  mkdirSync(getGatewayDir(agentId), { recursive: true });
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
