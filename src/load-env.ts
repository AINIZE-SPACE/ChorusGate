// ============================================================
// Shared .env loading — agent profile + project + global, with MCP placeholder fixup
//
// Issue #134: Agent Profile Config
//
// Load order when --agent <id> is specified (later overrides earlier):
//   1. ~/.chorusgate/<agent-id>/.env   — agent profile config
//   2. --env-file <path>               — explicit override (if specified)
//   3. Shell environment               — already in process.env, never overwritten
//
// Legacy load order (no --agent / --env-file):
//   1. ~/.gateway/.env                 — global defaults (user home)
//   2. <project-root>/.env             — project-installed
//   3. ./.gateway/.env (cwd)           — working-directory overrides
//   4. Shell environment               — already in process.env, never overwritten
//
// Also handles MCP config placeholders: if process.env has a literal
// "${SLACK_BOT_TOKEN}" (injected by MCP config), the parsed .env value
// replaces it.
// ============================================================

import { parse as parseDotEnv } from "dotenv";
import { dirname, resolve, join, parse as parsePath } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync, readdirSync } from "node:fs";

/**
 * Walk upward from `startDir` until we find a directory containing
 * `package.json` or `.git`, then return that directory as the project root.
 * Falls back to `startDir` if neither marker is found (e.g. running from
 * a temp directory).
 *
 * This prevents `loadEnv` from reading a `.env` belonging to an adjacent
 * project in a monorepo or a parent directory that happens to have one.
 */
function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  const root = parsePath(dir).root; // filesystem root (e.g. "C:\\" or "/")

  while (dir !== root) {
    if (existsSync(join(dir, "package.json")) || existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  // Fallback: use the original cwd
  return resolve(startDir);
}

const projectRoot = findProjectRoot(process.cwd());

/** Path to the global .env under the user's home .gateway directory. */
export const GLOBAL_ENV_PATH = resolve(homedir(), ".gateway", ".env");
/** Path to the project-installed .env (resolved relative to cwd). */
export const PROJECT_ENV_PATH = resolve(projectRoot, ".env");
/** Path to the local .env in the current working directory's .gateway/ folder. */
export const CWD_ENV_PATH = resolve(process.cwd(), ".gateway", ".env");

// ---- Agent Profile Paths (#134) -----------------------------------------------

/** Root directory for agent profile configs. */
export const CHORUSGATE_HOME = resolve(homedir(), ".chorusgate");

/**
 * Get the agent profile .env path.
 *   ~/.chorusgate/<agentId>/.env
 */
export function agentProfileEnvPath(agentId: string): string {
  return resolve(CHORUSGATE_HOME, agentId, ".env");
}

/**
 * Check if an agent profile directory exists.
 * Useful for validation before startup.
 */
export function agentProfileExists(agentId: string): boolean {
  return existsSync(agentProfileEnvPath(agentId));
}

/**
 * List available agent profiles by scanning ~/.chorusgate/ for
 * directories that contain a .env file.
 */
export function listAgentProfiles(): string[] {
  try {
    if (!existsSync(CHORUSGATE_HOME)) return [];
    return readdirSync(CHORUSGATE_HOME, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() && existsSync(join(CHORUSGATE_HOME, d.name, ".env")),
      )
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ==============================================================================

export interface LoadEnvOptions {
  /** Agent profile id, e.g. "claude" | "codex". When set, loads from
   *  ~/.chorusgate/<agentId>/.env instead of project .env. */
  agentId?: string;
  /** Explicit .env file path. Takes precedence over agent profile. */
  envFile?: string;
}

/**
 * Load .env from configured sources.
 *
 * Agent profile mode (agentId or envFile set):
 *   1. ~/.chorusgate/<agentId>/.env  — if agentId is set and file exists
 *   2. <envFile>                     — if envFile is set and file exists
 *   3. Shell environment             — always wins
 *
 * Legacy mode (neither agentId nor envFile):
 *   1. ~/.gateway/.env               — global defaults
 *   2. <project-root>/.env           — project-installed
 *   3. ./.gateway/.env (cwd)         — working-directory overrides
 *   4. Shell environment             — always wins
 *
 * Returns the merged parsed result so callers can still do placeholder fixup.
 */
export function loadEnv(opts: LoadEnvOptions = {}): Record<string, string> {
  const { agentId, envFile } = opts;
  const shellKeys = new Set(Object.keys(process.env));
  const merged: Record<string, string> = {};

  const loadFile = (path: string, label: string): void => {
    try {
      const content = readFileSync(path, "utf-8");
      const parsed = parseDotEnv(content);
      Object.assign(merged, parsed);
      for (const [key, value] of Object.entries(parsed)) {
        if (!shellKeys.has(key)) process.env[key] = value;
      }
      console.error(`[load-env] loaded ${label}: ${path}`);
    } catch {
      // file is optional in legacy mode
    }
  };

  /** Like loadFile but throws with a clear message when the file is missing.
   *  Used for explicitly-specified config paths (--agent / --env-file). */
  const loadRequired = (path: string, label: string): void => {
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(
          `Config file not found: ${path}\n` +
          `  Source: ${label}\n` +
          `  Create this file with your ChorusGate config, or check the --agent / --env-file value.`,
        );
      }
      throw new Error(
        `Cannot read config file: ${path}\n` +
        `  Source: ${label}\n` +
        `  Error: ${(err as Error).message}`,
      );
    }
    const parsed = parseDotEnv(content);
    Object.assign(merged, parsed);
    for (const [key, value] of Object.entries(parsed)) {
      if (!shellKeys.has(key)) process.env[key] = value;
    }
    console.error(`[load-env] loaded ${label}: ${path}`);
  };

  // ---- Agent profile mode (#134) -------------------------------------------
  if (agentId || envFile) {
    if (agentId) {
      const profilePath = agentProfileEnvPath(agentId);
      loadRequired(profilePath, `agent profile "${agentId}"`);
    }
    if (envFile) {
      const resolved = resolve(envFile);
      loadRequired(resolved, `explicit env-file`);
    }
    return merged;
  }

  // ---- Legacy mode (backward compatible) ------------------------------------
  loadFile(GLOBAL_ENV_PATH, "global");
  loadFile(PROJECT_ENV_PATH, "project");
  loadFile(CWD_ENV_PATH, "cwd");

  return merged;
}

/**
 * Fix up MCP config placeholders.  When an MCP config passes literal
 * "${SLACK_BOT_TOKEN}" as the env-var value, we replace it with the
 * actual value from the merged .env files.
 */
export function fixMcpPlaceholders(
  parsed: Record<string, string>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    if (
      process.env[key] &&
      process.env[key]!.startsWith("${") &&
      parsed[key]
    ) {
      process.env[key] = parsed[key];
    }
  }
}
