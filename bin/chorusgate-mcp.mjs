#!/usr/bin/env node
// ============================================================
// chorusgate-mcp - executable entry point
//
// Locates the project root from this file's own location (not cwd),
// then loads the TypeScript entry (src/index.ts) through tsx's public
// ESM API. This keeps the MCP launcher config free of absolute paths,
// cwd assumptions, and tsx-internal module paths.
// ============================================================

import { tsImport } from "tsx/esm/api";

await tsImport("../src/index.ts", import.meta.url);
