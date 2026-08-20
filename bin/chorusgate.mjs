#!/usr/bin/env node
// ============================================================
// chorusgate - CLI dispatcher for the auto-reply daemon
//
// Usage: chorusgate <command> [subcommand] [options]
//
// Commands:
//   run                  run the gateway in the foreground
//   start/stop/restart   manage a background daemon
//   status/list          inspect the running daemon
//   config migrate       migrate project .env → ~/.chorusgate/<id>/.env
//
// Loads TypeScript via tsx's public ESM API, resolving paths relative to
// THIS file (not cwd) to avoid Windows absolute-path issues.
// ============================================================

import { tsImport } from "tsx/esm/api";

// Windows: ChorusGate must run as administrator (elevated). Enforced for
// every CLI command up front so failures surface here instead of mid-run.
// The MCP entry (chorusgate-mcp) is exempt — Claude Code spawns it unelevated.
if (process.platform === "win32") {
  const { requireWindowsAdmin } = await tsImport("../src/require-admin.ts", import.meta.url);
  requireWindowsAdmin({
    hint: `Command: chorusgate ${process.argv.slice(2).join(" ") || "run"}`,
  });
}

const cmd = (process.argv[2] || "run").toLowerCase();

if (cmd === "run") {
  const { prepareRunConfig } = await tsImport("../src/config-init.ts", import.meta.url);
  if (await prepareRunConfig()) {
    await tsImport("../src/gateway.ts", import.meta.url);
  }
} else if (cmd === "config") {
  const sub = (process.argv[3] || "").toLowerCase();
  if (sub === "migrate") {
    const { runMigrate } = await tsImport("../src/config-cli.ts", import.meta.url);
    await runMigrate();
  } else if (sub === "init") {
    const { runInit } = await tsImport("../src/config-init.ts", import.meta.url);
    await runInit();
  } else {
    console.error("Usage: chorusgate config <migrate|init> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --agent <id>     target agent profile (auto-detected if omitted)");
    console.error("  --from <path>    source .env file (required)");
    console.error("  --cwd <path>     pin the migrated agent working directory");
    console.error("  --apply          write the target file (default: dry-run)");
    console.error("  --force          overwrite existing target (with backup)");
    process.exitCode = 2;
  }
} else {
  const ctl = await tsImport("../src/gateway-control.ts", import.meta.url);
  const fn = ctl[cmd];
  if (typeof fn === "function") {
    await fn();
  } else {
    ctl.help();
    process.exitCode = 2;
  }
}
