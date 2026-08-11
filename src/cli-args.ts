// ============================================================
// CLI Args — parse --agent and --env-file from process.argv
//
// Issue #134: Agent Profile Config
//   chorusgate run --agent <agent-id>     → load ~/.chorusgate/<id>/.env
//   chorusgate run --env-file <path>      → load explicit .env path
//   chorusgate run                        → legacy (project .env)
//
// These args are parsed here and passed through to bootstrap.
// Validation happens here so invalid args fail early before any
// side effects (network, file writes, etc.).
// ============================================================

/** Regex for valid agent-id: lowercase alphanumeric + dash/underscore, 1-64 chars.
 *  Blocks path traversal and shell injection characters. */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Characters blocked in agent-id for path traversal protection. */
const PATH_TRAVERSAL_CHARS = /[\/\\]/;

export interface CliArgs {
  /** Agent profile id, e.g. "claude" | "codex" | "hermes" | "openclaw".
   *  When set, loads ~/.chorusgate/<agentId>/.env instead of project .env. */
  agentId: string | undefined;
  /** Explicit .env file path (absolute or relative).
   *  When set, loads this file directly. Takes precedence over --agent. */
  envFile: string | undefined;
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
 * Parse --agent and --env-file from process.argv.
 *
 * Handles both forms:
 *   --agent claude
 *   --agent=claude
 *   --env-file /path/to/.env
 *   --env-file=/path/to/.env
 *
 * Validates agent-id format. Throws on invalid input.
 * Stops at the first positional argument (e.g. "run", "start", "stop").
 *
 * Call process.exit(1) on error from the caller.
 */
export function parseCliArgs(argv: string[] = process.argv): CliArgs {
  let agentId: string | undefined;
  let envFile: string | undefined;

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
    }
  }

  // Validate agent-id if provided (fail early, before any side effects)
  if (agentId !== undefined) {
    validateAgentId(agentId);
  }

  return { agentId, envFile };
}
