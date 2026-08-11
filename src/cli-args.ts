// ============================================================
// CLI Args — parse --agent and --env-file from process.argv
//
// Issue #134: Agent Profile Config
//   chorusgate run --agent <agent-id>     → load ~/.chorusgate/<id>/.env
//   chorusgate run --env-file <path>      → load explicit .env path
//   chorusgate run                        → legacy (project .env)
//
// These args are parsed here and passed through to bootstrap.
// ============================================================

export interface CliArgs {
  /** Agent profile id, e.g. "claude" | "codex" | "hermes" | "openclaw".
   *  When set, loads ~/.chorusgate/<agentId>/.env instead of project .env. */
  agentId: string | undefined;
  /** Explicit .env file path (absolute or relative).
   *  When set, loads this file directly. Takes precedence over --agent. */
  envFile: string | undefined;
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
 * Stops at the first positional argument (e.g. "run", "start", "stop").
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

  return { agentId, envFile };
}
