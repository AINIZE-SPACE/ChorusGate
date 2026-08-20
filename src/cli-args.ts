// ============================================================
// CLI Args — parse --agent and --env-file from process.argv
//
// Issue #134: Agent Profile Config
//   chorusgate run --agent <agent-id>     → load ~/.chorusgate/<id>/.env
//   chorusgate run --env-file <path>      → load explicit .env path
//   chorusgate run                        → legacy (project .env)
//
// Validation happens here so invalid args fail early before any
// side effects (network, file writes, etc.).
//
// --agent and --env-file are mutually exclusive per spec §4.1.
// --env-file must be an absolute path per spec §4.2.
// ============================================================

import { isAbsolute } from "node:path";

/** Regex for valid agent-id: lowercase alphanumeric + dash/underscore, 1-64 chars.
 *  Blocks path traversal and shell injection characters. */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Characters blocked in agent-id for path traversal protection. */
const PATH_TRAVERSAL_CHARS = /[\/\\]/;

export interface CliArgs {
  /** Agent profile id, e.g. "claude" | "codex" | "hermes" | "openclaw".
   *  When set, loads ~/.chorusgate/<agentId>/.env instead of project .env. */
  agentId: string | undefined;
  /** Explicit .env file path (absolute only).
   *  When set, loads this file directly. Mutually exclusive with --agent. */
  envFile: string | undefined;
  /** Initialize a missing agent profile before running. */
  initialize: boolean;
}

/**
 * Validate an agent-id string.
 * Throws with a descriptive message on invalid input.
 */
export function validateAgentId(id: string): void {
  if (!id || id.trim().length === 0) {
    throw new Error(
      `Invalid --agent value: empty string is not allowed. ` +
      `Use a valid agent-id (e.g. "claude", "codex") or omit --agent for legacy mode.`,
    );
  }

  if (PATH_TRAVERSAL_CHARS.test(id)) {
    throw new Error(
      `Invalid --agent value: "${id}" contains path traversal characters (/ or \\). ` +
      `Agent IDs must be simple names like "claude" or "codex".`,
    );
  }

  if (id.includes("..")) {
    throw new Error(
      `Invalid --agent value: "${id}" contains ".." which is not allowed. ` +
      `Agent IDs must be simple names like "claude" or "codex".`,
    );
  }

  if (!AGENT_ID_RE.test(id)) {
    throw new Error(
      `Invalid --agent value: "${id}". ` +
      `Agent IDs must be 1-64 lowercase alphanumeric characters, dashes, or underscores, ` +
      `starting with a letter or digit. Examples: "claude", "codex", "my-agent".`,
    );
  }
}

/**
 * Validate an --env-file path.
 * Must be an absolute path. Relative paths are rejected per spec §4.2.
 */
export function validateEnvFilePath(filePath: string): void {
  if (!isAbsolute(filePath)) {
    throw new Error(
      `Invalid --env-file value: "${filePath}" is a relative path. ` +
      `--env-file requires an absolute path (e.g. "/home/user/.env" or "C:\\secure\\.env"). ` +
      `Use --agent <id> instead to load from ~/.chorusgate/<id>/.env.`,
    );
  }
}

/**
 * Parse --agent and --env-file from process.argv.
 *
 * Handles both forms:
 *   --agent claude
 *   --agent=claude
 *   --env-file /absolute/path/.env
 *   --env-file=/absolute/path/.env
 *
 * Rules (spec §4.1-4.2):
 * - agent-id must match ^[a-z0-9][a-z0-9_-]{0,63}$, no path traversal
 * - --env-file must be an absolute path
 * - --agent and --env-file are mutually exclusive
 *
 * Throws on invalid input. Caller should catch and exit(1).
 */
export function parseCliArgs(argv: string[] = process.argv): CliArgs {
  let agentId: string | undefined;
  let envFile: string | undefined;
  let initialize = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    // --agent <value> or --agent=<value>
    if (arg === "--agent" && i + 1 < argv.length) {
      agentId = argv[++i];
    } else if (arg.startsWith("--agent=")) {
      agentId = arg.slice("--agent=".length);
    }
    // --env-file <value> or --env-file=<value>
    else if (arg === "--env-file" && i + 1 < argv.length) {
      envFile = argv[++i];
    } else if (arg.startsWith("--env-file=")) {
      envFile = arg.slice("--env-file=".length);
    } else if (arg === "--init") {
      initialize = true;
    }
  }

  // ---- Mutual exclusion (spec §4.1) ---------------------------------------
  if (agentId !== undefined && envFile !== undefined) {
    throw new Error(
      `--agent and --env-file are mutually exclusive. ` +
      `Use one or the other, not both.\n` +
      `  --agent: load from ~/.chorusgate/<id>/.env\n` +
      `  --env-file: load from an explicit absolute path`,
    );
  }

  // ---- Validation ---------------------------------------------------------
  if (agentId !== undefined) {
    validateAgentId(agentId);
  }

  if (envFile !== undefined) {
    validateEnvFilePath(envFile);
  }

  return { agentId, envFile, initialize };
}
