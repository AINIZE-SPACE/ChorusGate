// ============================================================
// Config Migrate — migrate project .env to ~/.chorusgate/<id>/.env
//
// Issue #134: Agent Profile Config, Story C
//
// Usage:
//   chorusgate config migrate --agent claude --from E:\project\.env
//   chorusgate config migrate --agent claude --from E:\project\.env --apply
//   chorusgate config migrate --agent claude --from E:\project\.env --apply --force
//   chorusgate config migrate --from E:\project\.env          (auto-detect agent)
//
// Default: dry-run (preview only).  --apply writes the file.
// --force overwrites existing target (with backup).
// Never deletes the source file.
// ============================================================

import { parse as parseDotEnv } from "dotenv";
import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { CHORUSGATE_HOME, agentProfileEnvPath } from "./load-env.js";
import { validateAgentId } from "./cli-args.js";

// ---- ChorusGate config key set ------------------------------------------------

/**
 * ChorusGate config keys — these are the keys that belong in
 * ~/.chorusgate/<agent-id>/.env, per .env.example.
 *
 * Everything else (platform API keys, MCP config, platform-specific vars)
 * stays in the source .env or the agent platform's own config.
 */
const CHORUSGATE_KEY_PREFIXES = [
  "SLACK_",          // SLACK_BOT_TOKEN, SLACK_APP_TOKEN
  "GATEWAY_",        // all gateway daemon settings
  "CLAUDE_BIN",      // Claude/Codex binary paths (ChorusGate controls these)
  "CODEX_BIN",
  "CLAUDE_PERMISSION_MODE",
  "CLAUDE_STREAM_PARTIAL",
  "GATEWAY_CLAUDE_MODE",
  "TRELLO_",         // optional Trello MCP
];

/** Auto-detect agent-id from env content. */
function detectAgentId(env: Record<string, string>): string | null {
  // Check for explicit provider
  const provider = env["GATEWAY_PROVIDER"]?.toLowerCase();
  if (provider === "claude" || provider === "claude-stream") return "claude";
  if (provider === "codex") return "codex";

  // Check for binary paths
  if (env["CLAUDE_BIN"]) return "claude";
  if (env["CODEX_BIN"]) return "codex";

  // Check for Claude-specific env vars
  if (env["CLAUDE_PERMISSION_MODE"] || env["CLAUDE_STREAM_PARTIAL"]) return "claude";

  return null;
}

export interface MigrateOptions {
  /** Target agent id, e.g. "claude". Auto-detected if not specified. */
  agentId?: string;
  /** Source .env file path (required). */
  from: string;
  /** Working directory to pin in the migrated agent profile. */
  cwd?: string;
  /** Test/embedding override; defaults to ~/.chorusgate. */
  profileRoot?: string;
  /** Write the target file (default: dry-run preview only). */
  apply?: boolean;
  /** Overwrite existing target file (with backup). */
  force?: boolean;
}

export interface MigrateResult {
  /** Dry-run or applied. */
  mode: "dry-run" | "applied";
  /** Target agent id. */
  agentId: string;
  /** Target file path. */
  targetPath: string;
  /** Keys that would be migrated to ChorusGate config. */
  chorusgateKeys: string[];
  /** Keys that stay in the platform/project. */
  keptKeys: string[];
  /** Backup path if --force was used. */
  backupPath?: string;
}

/**
 * Check if a key belongs to ChorusGate config.
 */
function isChorusGateKey(key: string): boolean {
  return CHORUSGATE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Run the migration.
 *
 * Steps:
 * 1. Read source .env
 * 2. Detect or validate agent-id
 * 3. Classify keys: chorusgate vs kept
 * 4. Dry-run: print preview
 * 5. Apply: write to ~/.chorusgate/<agent-id>/.env
 * 6. --force: backup existing target before overwrite
 */
export function migrateConfig(opts: MigrateOptions): MigrateResult {
  const sourcePath = resolve(opts.from);

  // 1. Read source .env
  let sourceContent: string;
  try {
    sourceContent = readFileSync(sourcePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Source file not found: ${sourcePath}`);
    }
    throw new Error(`Cannot read source file: ${sourcePath}\n  ${(err as Error).message}`);
  }

  const parsed = parseDotEnv(sourceContent);

  // 2. Determine agent-id
  let agentId = opts.agentId;
  if (!agentId) {
    const detected = detectAgentId(parsed);
    if (detected) {
      agentId = detected;
      console.error(`[migrate] Auto-detected agent: ${agentId}`);
    } else {
      // No provider marker found → fall back to the "default" agent profile.
      // This covers plain single-app .env files that predate multi-agent
      // profiles.  Explicitly pass --agent <id> to override.
      agentId = "default";
      console.error(
        `[migrate] No provider marker found — defaulting to agent "default". ` +
        `Pass --agent <id> to override (e.g. --agent claude, --agent codex).`,
      );
    }
  }

  validateAgentId(agentId);

  // 3. Classify keys
  const chorusgateKeys: string[] = [];
  const keptKeys: string[] = [];

  for (const key of Object.keys(parsed)) {
    if (isChorusGateKey(key)) {
      chorusgateKeys.push(key);
    } else {
      keptKeys.push(key);
    }
  }

  // A legacy project-local .env implicitly used that project's directory as
  // the spawned agent cwd. Once the config moves into ~/.chorusgate, that
  // relationship must be explicit or startup behavior changes with the
  // caller's current directory.
  if (opts.cwd) {
    const cwd = resolve(opts.cwd);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      throw new Error(`Working directory not found or not a directory: ${cwd}`);
    }
    parsed["GATEWAY_CLAUDE_CWD"] = cwd;
    if (!chorusgateKeys.includes("GATEWAY_CLAUDE_CWD")) {
      chorusgateKeys.push("GATEWAY_CLAUDE_CWD");
    }
  }

  // 4. Build target path
  const targetDir = resolve(opts.profileRoot ?? CHORUSGATE_HOME, agentId);
  const targetPath = opts.profileRoot
    ? resolve(targetDir, ".env")
    : agentProfileEnvPath(agentId);

  // 5. Dry-run
  if (!opts.apply) {
    return {
      mode: "dry-run",
      agentId,
      targetPath,
      chorusgateKeys,
      keptKeys,
    };
  }

  // 6. Apply — check if target exists
  if (existsSync(targetPath) && !opts.force) {
    throw new Error(
      `Target config already exists: ${targetPath}\n` +
      `Use --force to overwrite (a timestamped backup will be created first).`,
    );
  }

  // 7. Backup if --force
  let backupPath: string | undefined;
  if (existsSync(targetPath) && opts.force) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = targetPath + `.backup-${ts}`;
    copyFileSync(targetPath, backupPath);
    console.error(`[migrate] Backup created: ${backupPath}`);
  }

  // 8. Write target
  mkdirSync(targetDir, { recursive: true });
  const targetContent = chorusgateKeys
    .map((key) => `${key}=${parsed[key]}`)
    .join("\n") + "\n";
  writeFileSync(targetPath, targetContent, "utf-8");

  console.error(`[migrate] Written: ${targetPath} (${chorusgateKeys.length} keys)`);

  return {
    mode: "applied",
    agentId,
    targetPath,
    chorusgateKeys,
    keptKeys,
    backupPath,
  };
}

/**
 * Format a migration result for display.
 */
export function formatMigrateResult(result: MigrateResult): string {
  const lines: string[] = [];

  if (result.mode === "dry-run") {
    lines.push("");
    lines.push("=== DRY-RUN (no changes made) ===");
    lines.push("");
    lines.push(`Agent:     ${result.agentId}`);
    lines.push(`Target:    ${result.targetPath}`);
    lines.push("");
    lines.push(`📋 Migrating to ChorusGate (${result.chorusgateKeys.length} keys):`);
    if (result.chorusgateKeys.length > 0) {
      for (const key of result.chorusgateKeys) {
        lines.push(`  → ${key}`);
      }
    } else {
      lines.push(`  (none — no ChorusGate config keys found)`);
    }
    lines.push("");
    lines.push(`📌 Staying in platform/project (${result.keptKeys.length} keys):`);
    if (result.keptKeys.length > 0) {
      for (const key of result.keptKeys) {
        lines.push(`  · ${key}`);
      }
    }
    lines.push("");
    lines.push("To apply: add --apply");
    lines.push(`To overwrite existing: add --apply --force`);
    lines.push("");
    lines.push("After migration, verify:");
    lines.push(`  chorusgate run --agent ${result.agentId}`);
    lines.push("");
  } else {
    lines.push("");
    lines.push("=== MIGRATION APPLIED ===");
    lines.push("");
    lines.push(`Agent:     ${result.agentId}`);
    lines.push(`Target:    ${result.targetPath}`);
    if (result.backupPath) {
      lines.push(`Backup:    ${result.backupPath}`);
    }
    lines.push(`Migrated:  ${result.chorusgateKeys.length} keys`);
    lines.push("");
    lines.push("Next steps:");
    lines.push(`  1. Verify: chorusgate run --agent ${result.agentId}`);
    lines.push(`  2. Remove ChorusGate keys from source .env (optional, manual)`);
    lines.push(`  3. Source .env was NOT modified`);
    lines.push("");
  }

  return lines.join("\n");
}
