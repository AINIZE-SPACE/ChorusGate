// ============================================================
// Agent-home resolution — official vs custom agent homes
//
// Resolves the base directory that holds agent config/profile files.
// Agent config is looked up both in the official agent home
// (%USERPROFILE%\.ainize\.config) and, when the user supplies one, in a
// custom agent home given via --agent-home / AGENT_HOME.
//
// Resolution order (highest wins):
//   1. --agent-home CLI flag           (blank/whitespace -> ignored)
//   2. AGENT_HOME env var              (checked ONLY on Windows)
//   3. Default official home: %USERPROFILE%\.ainize\.config
//
// Rules:
//   - CLI overrides env: a non-blank --agent-home wins even when
//     AGENT_HOME is set; a blank --agent-home falls through to env.
//   - Relative --agent-home / AGENT_HOME values are resolved against
//     %USERPROFILE% (the Windows home directory).
//   - The official home has NO fallback layered on top: it is exactly
//     %USERPROFILE%\.ainize\.config and nothing else.
// ============================================================

import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

/** Default official agent-home base, relative to the Windows home dir. */
export const DEFAULT_AGENT_HOME_REL = [".ainize", ".config"] as const;

/** The Windows "home directory" (%USERPROFILE% on Windows). */
export function windowsHomeDir(): string {
  return process.env.USERPROFILE || homedir();
}

/** A value that is nullish or only whitespace counts as "not provided". */
function isBlank(value: string | undefined | null): boolean {
  return value == null || value.trim() === "";
}

export interface AgentHomeOptions {
  /** Raw value of --agent-home from the CLI (may be undefined). */
  cliAgentHome?: string;
  /** Raw value of AGENT_HOME from the environment (may be undefined). */
  envAgentHome?: string;
  /** Platform override (tests). Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** %USERPROFILE% override (tests). Defaults to the real env/home. */
  userProfile?: string;
}

/**
 * Resolve which agent home to use for agent config/profile files.
 *
 * 1. A non-blank --agent-home (CLI) wins over everything; a relative
 *    value resolves against the Windows home directory.
 * 2. Otherwise, on Windows only, a non-blank AGENT_HOME is honored;
 *    a relative value likewise resolves against the Windows home dir.
 * 3. Otherwise the default official home `%USERPROFILE%\.ainize\.config`.
 *
 * No fallback is layered on top of the official home.
 */
export function resolveAgentHome(opts: AgentHomeOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const home = opts.userProfile ?? process.env.USERPROFILE ?? homedir();

  // 1. Explicit CLI flag wins over everything (even a set AGENT_HOME).
  if (!isBlank(opts.cliAgentHome)) {
    const value = opts.cliAgentHome!.trim();
    return isAbsolute(value) ? value : resolve(home, value);
  }

  // 2. AGENT_HOME is honored only on Windows.
  if (platform === "win32" && !isBlank(opts.envAgentHome)) {
    const value = opts.envAgentHome!.trim();
    return isAbsolute(value) ? value : resolve(home, value);
  }

  // 3. Default official home — nothing layered on top.
  return resolve(home, ...DEFAULT_AGENT_HOME_REL);
}

export interface ConfigPathGuardOptions {
  /** Where the agent home came from. "cli" throws in dev when both the
   *  config-file path and the agent home are relative; "env" prefers to
   *  resolve the relative agent home against the Windows home dir. */
  source: "cli" | "env";
  /** %USERPROFILE% override (tests). */
  userProfile?: string;
}

/**
 * Resolve a config-file path inside an agent home, with the hardening
 * guard: the config file path must be absolute, or the agent home base
 * must be absolute. If neither is absolute:
 *   - "cli" (dev): throw — a relative config path in a relative home is
 *     ambiguous and must not silently resolve against the cwd.
 *   - "env": resolve the relative agent home against the Windows home dir.
 */
export function resolveConfigPathInHome(
  agentHome: string,
  configFile: string,
  opts: ConfigPathGuardOptions,
): string {
  if (isAbsolute(configFile)) return configFile;
  if (isAbsolute(agentHome)) return resolve(agentHome, configFile);
  if (opts.source === "cli") {
    throw new Error(
      `[agent-home] config file path must be absolute, or the agent home ` +
        `must be absolute (got configFile="${configFile}", agentHome="${agentHome}")`,
    );
  }
  const home = opts.userProfile ?? process.env.USERPROFILE ?? homedir();
  return resolve(home, agentHome, configFile);
}
