// ============================================================
// Shared .env loading — global + cwd, with MCP placeholder fixup
//
// Load order (later overrides earlier):
//   1. ~/.gateway/.env   — global defaults (user home)
//   2. ./.env             — project-specific (cwd)
//   3. Shell environment  — already in process.env, never overwritten
//
// Also handles MCP config placeholders: if process.env has a literal
// "${SLACK_BOT_TOKEN}" (injected by MCP config), the parsed .env value
// replaces it.
// ============================================================

import { parse as parseDotEnv } from "dotenv";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

/** Path to the global .env under the user's home .gateway directory. */
export const GLOBAL_ENV_PATH = resolve(homedir(), ".gateway", ".env");
/** Path to the local .env in the current working directory. */
export const CWD_ENV_PATH = resolve(process.cwd(), ".env");

/**
 * Load .env from the global user directory (~/.gateway/.env) and the current
 * working directory (./.env).
 *
 * Priority (highest wins):
 *   1. Shell environment    — already in process.env at startup
 *   2. ./.env (cwd)         — project-specific overrides
 *   3. ~/.gateway/.env      — global defaults (user home)
 *
 * Returns the merged parsed result so callers can still do placeholder fixup.
 */
export function loadEnv(): Record<string, string> {
  // Snapshot shell-origin keys BEFORE we touch process.env so we never
  // overwrite a value the user explicitly set in their shell.
  const shellKeys = new Set(Object.keys(process.env));

  const merged: Record<string, string> = {};

  // 1. Global defaults (lowest priority)
  try {
    const globalContent = readFileSync(GLOBAL_ENV_PATH, "utf-8");
    const globalParsed = parseDotEnv(globalContent);
    Object.assign(merged, globalParsed);
    for (const [key, value] of Object.entries(globalParsed)) {
      if (!shellKeys.has(key)) {
        process.env[key] = value;
      }
    }
    console.error(`[load-env] loaded global: ${GLOBAL_ENV_PATH}`);
  } catch {
    // global .env is optional — missing file is not an error
  }

  // 2. CWD overrides (higher priority than global, lower than shell)
  try {
    const cwdContent = readFileSync(CWD_ENV_PATH, "utf-8");
    const cwdParsed = parseDotEnv(cwdContent);
    Object.assign(merged, cwdParsed);
    for (const [key, value] of Object.entries(cwdParsed)) {
      if (!shellKeys.has(key)) {
        process.env[key] = value;
      }
    }
    console.error(`[load-env] loaded cwd: ${CWD_ENV_PATH}`);
  } catch {
    // cwd .env is also optional
  }

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
