import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import type { ProfileConfig } from "./profile-config.js";

export interface PlatformRequirement {
  platform: "claude" | "codex";
  binary: string;
  envVar: "CLAUDE_BIN" | "CODEX_BIN";
}

export function platformRequirement(profile: ProfileConfig): PlatformRequirement | null {
  if (profile.providerId === "codex") {
    return { platform: "codex", binary: process.env.CODEX_BIN || "codex", envVar: "CODEX_BIN" };
  }
  if (profile.providerId === "claude" || profile.providerId === "claude-stream") {
    return { platform: "claude", binary: process.env.CLAUDE_BIN || "claude", envVar: "CLAUDE_BIN" };
  }
  return null;
}

export function executableExists(binary: string): boolean {
  if (isAbsolute(binary)) return existsSync(binary);
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [binary], { stdio: "ignore", windowsHide: true });
  return result.status === 0;
}

export function validateAgentPlatforms(profiles: ProfileConfig[]): void {
  const missing = profiles
    .map(platformRequirement)
    .filter((item): item is PlatformRequirement => item !== null)
    .filter((item, index, all) =>
      all.findIndex((candidate) => candidate.platform === item.platform && candidate.binary === item.binary) === index,
    )
    .filter((item) => !executableExists(item.binary));

  if (missing.length === 0) return;
  const details = missing.map((item) =>
    `${item.platform} CLI was not found (expected "${item.binary}"). ` +
    `Install ${item.platform}, verify with "${item.platform} --version", ` +
    `or set ${item.envVar} to its executable path.`,
  );
  throw new Error(`Agent platform setup required:\n  - ${details.join("\n  - ")}`);
}
