import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse as parseDotEnv } from "dotenv";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { agentProfileEnvPath, listAgentProfiles } from "./load-env.js";
import { parseCliArgs, validateAgentId } from "./cli-args.js";
import { migrateConfig } from "./config-migrate.js";

export interface InitAgentOptions {
  agentId: string;
  from?: string;
  cwd?: string;
  force?: boolean;
  /** Test/embedding override; defaults to ~/.chorusgate. */
  profileRoot?: string;
}

export interface InitAgentResult {
  targetPath: string;
  sourcePath?: string;
  ready: boolean;
}

function defaultProvider(agentId: string): string {
  return agentId === "codex" ? "codex" : "claude";
}

export function formatAvailableAgents(agents: string[]): string {
  return agents.length > 0 ? agents.join(", ") : "(none)";
}

export function missingProfileKeys(targetPath: string): string[] {
  const parsed = parseDotEnv(readFileSync(targetPath, "utf8"));
  const ids = parsed.GATEWAY_PROFILES
    ?.split(",")
    .map((id) => id.trim().toUpperCase())
    .filter(Boolean);
  const required = ids && ids.length > 0
    ? ids.flatMap((id) => [`SLACK_BOT_TOKEN_${id}`, `SLACK_APP_TOKEN_${id}`])
    : ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"];
  return required.filter((key) => !(process.env[key] || parsed[key])?.trim());
}

export function initializeAgentProfile(opts: InitAgentOptions): InitAgentResult {
  validateAgentId(opts.agentId);
  const cwd = resolve(opts.cwd ?? process.cwd());
  const sourcePath = resolve(opts.from ?? resolve(cwd, ".env"));
  const targetPath = opts.profileRoot
    ? resolve(opts.profileRoot, opts.agentId, ".env")
    : agentProfileEnvPath(opts.agentId);

  if (existsSync(sourcePath)) {
    migrateConfig({
      agentId: opts.agentId,
      from: sourcePath,
      cwd,
      profileRoot: opts.profileRoot,
      apply: true,
      force: opts.force,
    });
    return { targetPath, sourcePath, ready: true };
  }

  if (existsSync(targetPath) && !opts.force) {
    return { targetPath, ready: missingProfileKeys(targetPath).length === 0 };
  }

  mkdirSync(resolve(targetPath, ".."), { recursive: true });
  const content = [
    `# ChorusGate agent profile: ${opts.agentId}`,
    "# Fill both Slack tokens before running the gateway.",
    "SLACK_BOT_TOKEN=",
    "SLACK_APP_TOKEN=",
    `GATEWAY_PROVIDER=${defaultProvider(opts.agentId)}`,
    `GATEWAY_CLAUDE_CWD=${cwd}`,
    "",
  ].join("\n");
  writeFileSync(targetPath, content, { encoding: "utf8", flag: opts.force ? "w" : "wx" });
  return { targetPath, ready: false };
}

async function confirmInitialization(agentId: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `Initialize agent profile "${agentId}" from the current project? [Y/n] `,
    );
    return answer.trim() === "" || /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function prepareRunConfig(argv: string[] = process.argv): Promise<boolean> {
  const args = parseCliArgs(argv);
  if (!args.agentId || args.envFile) return true;

  const targetPath = agentProfileEnvPath(args.agentId);
  if (existsSync(targetPath)) {
    const missing = missingProfileKeys(targetPath);
    if (missing.length === 0) return true;
    console.error(`[chorusgate] Agent profile "${args.agentId}" is incomplete: ${targetPath}`);
    console.error(`[chorusgate] Add: ${missing.join(", ")}`);
    return false;
  }

  const available = listAgentProfiles();
  console.error(`[chorusgate] Agent profile "${args.agentId}" is not initialized.`);
  console.error(`[chorusgate] Existing agents: ${formatAvailableAgents(available)}`);
  console.error(`[chorusgate] Check the spelling of --agent ${args.agentId}.`);

  let shouldInitialize = args.initialize;
  if (!shouldInitialize && stdin.isTTY && stdout.isTTY) {
    shouldInitialize = await confirmInitialization(args.agentId);
  }

  if (!shouldInitialize) {
    console.error(
      `[chorusgate] To initialize automatically: chorusgate run --agent ${args.agentId} --init`,
    );
    return false;
  }

  const result = initializeAgentProfile({ agentId: args.agentId });
  if (result.sourcePath) {
    console.error(`[chorusgate] Initialized "${args.agentId}" from ${result.sourcePath}.`);
  } else {
    console.error(`[chorusgate] Created starter config: ${result.targetPath}`);
    console.error("[chorusgate] Add SLACK_BOT_TOKEN and SLACK_APP_TOKEN, then run again.");
  }
  return result.ready;
}

export async function runInit(argv: string[] = process.argv): Promise<void> {
  const args = parseCliArgs(argv);
  if (!args.agentId) {
    console.error("Usage: chorusgate config init --agent <id> [--from <project.env>] [--cwd <project>] [--force]");
    process.exitCode = 2;
    return;
  }

  let from: string | undefined;
  let cwd: string | undefined;
  let force = false;
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from" && i + 1 < argv.length) from = argv[++i];
    else if (arg.startsWith("--from=")) from = arg.slice("--from=".length);
    else if (arg === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else if (arg === "--force") force = true;
  }

  const result = initializeAgentProfile({ agentId: args.agentId, from, cwd, force });
  console.error(`[chorusgate] Agent "${args.agentId}" initialized at ${result.targetPath}.`);
  if (!result.ready) {
    console.error("[chorusgate] Add SLACK_BOT_TOKEN and SLACK_APP_TOKEN before starting.");
  }
}
