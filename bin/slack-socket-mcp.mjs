#!/usr/bin/env node
// ============================================================
// slack-socket-mcp — executable entry point
//
// Locates the project root from this file's own location (not cwd),
// then loads the TypeScript entry (src/index.ts) through tsx's public
// ESM API. This keeps the MCP launcher config free of absolute paths,
// cwd assumptions, and tsx-internal module paths.
// ============================================================

import { tsImport } from "tsx/esm/api";

// Resolve the TS entry relative to THIS file (not cwd). A relative
// specifier sidesteps the Windows "absolute path must be a file:// URL"
// ESM constraint that a resolved drive path (E:\...) would trip.
await tsImport("../src/index.ts", import.meta.url);
