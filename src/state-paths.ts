import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Runtime persistence root. Production keeps the historical repository-local
 * memory directory; tests can set CHORUSGATE_STATE_DIR before module import so
 * singleton stores never mutate live session/event routing data.
 */
export function getStateDir(): string {
  return resolve(process.env.CHORUSGATE_STATE_DIR || resolve(projectRoot, "memory"));
}
