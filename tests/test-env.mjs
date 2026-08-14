import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This preload runs in each Node test worker before application modules load.
// Give every worker an isolated persistence root so singleton stores cannot
// alter repository-local runtime session/event files.
process.env.CHORUSGATE_STATE_DIR = mkdtempSync(
  join(tmpdir(), `chorusgate-test-state-${process.pid}-`),
);
