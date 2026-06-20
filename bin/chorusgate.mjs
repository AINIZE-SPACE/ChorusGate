#!/usr/bin/env node
// ============================================================
// chorusgate - CLI dispatcher for the auto-reply daemon
//
// Usage: chorusgate <run|start|stop|restart|status|list>
//   run                  -> run the gateway in the foreground (this process)
//   start/stop/restart   -> manage a background daemon
//   status/list          -> inspect the running daemon
//
// Loads TypeScript via tsx's public ESM API, resolving paths relative to
// THIS file (not cwd) to avoid Windows absolute-path issues.
// ============================================================

import { tsImport } from "tsx/esm/api";

const cmd = (process.argv[2] || "run").toLowerCase();

if (cmd === "run") {
  await tsImport("../src/gateway.ts", import.meta.url);
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
