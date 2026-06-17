// ============================================================
// Shared .env loading — project root + cwd + global, with MCP placeholder fixup
//
// Load order (later overrides earlier):
//   1. ~/.gateway/.env          — global defaults (user home)
//   2. <project-root>/.env      — project-installed (always found via import.meta.url)
//   3. ./.env (cwd)             — working-directory overrides
//   4. Shell environment        — already in process.env, never overwritten
//
// Also handles MCP config placeholders: if process.env has a literal
// "${SLACK_BOT_TOKEN}" (injected by MCP config), the parsed .env value
// replaces it.
// ============================================================

import { parse as parseDotEnv } from "dotenv";
import { dirname, resolve, join, parse as parsePath } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// NOTE: __dirname is compile-time and points to the installed package
// location (e.g. AppData/Roaming/npm/node_modules/chorusgate/src). For a CLI
// invoked from a project directory, project root MUST be the actual project
// root (found via package.json/.git), not the npm install dir.
const projectRoot = findProjectRoot(process.cwd());

/** Path to the global .env under the user's home .gateway directory. */
export const GLOBAL_ENV_PATH = resolve(homedir(), ".gateway", ".env");
/** Path to the project-installed .env (resolved relative to cwd). */
export const PROJECT_ENV_PATH = resolve(projectRoot, ".env");
/** Path to the local .env in the current working directory's .gateway/ folder.
 *  Using .gateway/.env instead of ./.env avoids conflicts with other apps
 *  that may also look for a root-level .env. */
export const CWD_ENV_PATH = resolve(process.cwd(), ".gateway", ".env");

/**
 * Load .env from three tiers:
 *   1. ~/.gateway/.env            — global defaults (lowest)
 *   2. <project-root>/.env        — project-installed
 *   3. ./.gateway/.env (cwd)      — working-directory overrides (highest file)
 *
 * Shell environment always wins over all files.
 *
 * Returns the merged parsed result so callers can still do placeholder fixup.
 */
export function loadEnv(): Record<string, string> {
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
      // file is optional
    }
  };

  // Priority: global < project < cwd < shell
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
  keys: readonly string[]
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
