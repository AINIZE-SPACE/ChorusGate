// ============================================================
// Windows administrator requirement
//
// ChorusGate runs as a local daemon that spawns agent CLIs and
// manages control-plane state under the user's profile. On Windows
// these operations need an elevated (Run as administrator) process;
// we enforce that up front with a clear error instead of letting
// the daemon fail mid-flight with cryptic "Access denied" messages.
//
// The MCP server (src/index.ts) deliberately does NOT use this guard:
// Claude Code spawns it as a passive, unelevated tool.
// ============================================================

import { execFileSync } from "node:child_process";

export interface RequireAdminOptions {
  /** Override the elevation check (test/embedding hook). */
  check?: () => boolean;
  /** Extra guidance appended to the error message. */
  hint?: string;
}

/**
 * Detect whether the current process is elevated on Windows.
 *
 * Uses PowerShell's `WindowsPrincipal.IsInRole(Administrator)` — a pure
 * token-level check that never depends on services like the Windows Server
 * service (which `net session` probes and can falsely report when disabled).
 * Non-Windows platforms have no elevation model and always pass.
 */
export function isWindowsElevated(): boolean {
  if (process.platform !== "win32") return true;
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "([Security.Principal.WindowsPrincipal]" +
        "[Security.Principal.WindowsIdentity]::GetCurrent())." +
        "IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    return /^\s*true\s*$/i.test(String(out).trim());
  } catch {
    // Fail closed: if we cannot prove elevation, treat as not elevated.
    return false;
  }
}

/** Human-readable guidance shown when the process is not elevated. */
export function adminRequirementMessage(hint?: string): string {
  const lines = [
    "[chorusgate] ERROR: ChorusGate requires administrator privileges on Windows.",
    "[chorusgate] Re-run this command from an elevated terminal (right-click",
    '[chorusgate] your terminal and choose "Run as administrator").',
  ];
  if (hint) lines.push(`[chorusgate] ${hint}`);
  return lines.join("\n");
}

/**
 * Require an elevated process on Windows. Prints a clear message and
 * exits with code 1 when the requirement is not met; returns true
 * otherwise so callers can keep going.
 */
export function requireWindowsAdmin(opts: RequireAdminOptions = {}): boolean {
  const elevated = opts.check ? opts.check() : isWindowsElevated();
  if (elevated) return true;
  console.error(adminRequirementMessage(opts.hint));
  process.exit(1);
  return false;
}