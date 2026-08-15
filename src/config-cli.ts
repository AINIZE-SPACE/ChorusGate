// ============================================================
// Config CLI — parse `config migrate` args and run migration
// ============================================================

import { migrateConfig, formatMigrateResult, type MigrateOptions } from "./config-migrate.js";

/** Parse migrate-specific flags from process.argv. */
export function parseMigrateArgs(argv: string[] = process.argv): MigrateOptions {
  let agentId: string | undefined;
  let from: string | undefined;
  let cwd: string | undefined;
  let apply = false;
  let force = false;

  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agent" && i + 1 < argv.length) {
      agentId = argv[++i];
    } else if (arg.startsWith("--agent=")) {
      agentId = arg.slice("--agent=".length);
    } else if (arg === "--from" && i + 1 < argv.length) {
      from = argv[++i];
    } else if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
    } else if (arg === "--cwd" && i + 1 < argv.length) {
      cwd = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--force") {
      force = true;
    }
  }

  if (!from) {
    throw new Error(
      `--from <path> is required. Usage: chorusgate config migrate --from <source.env> [--agent <id>] [--cwd <project>] [--apply] [--force]`,
    );
  }

  if (!agentId) {
    console.error(
      `[migrate] No --agent given — auto-detecting from source .env (claude / codex / hermes / openclaw). ` +
      `Ambiguous or absent markers fail closed and require an explicit --agent.`,
    );
  }

  return { agentId, from, cwd, apply, force };
}

/** Run the migrate command. Prints result, exits with code. */
export async function runMigrate(): Promise<void> {
  try {
    const opts = parseMigrateArgs();
    const result = migrateConfig(opts);
    console.error(formatMigrateResult(result));
    process.exitCode = 0;
  } catch (err) {
    console.error(`[migrate] ERROR: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
