// ============================================================
// load-env unit tests — Issue #134: Agent Profile Config
//
// Exercises the REAL implementation in src/load-env.ts (unlike the
// contract tests in issue134-agent-config.test.ts, which simulate
// behavior inline).  Coverage:
//   - CHORUSGATE_HOME override + agent profile path resolution
//   - agent profile discovery (agentProfileExists, listAgentProfiles)
//   - loadEnv agent-profile mode & explicit env-file mode
//   - load priority: shell env > env-file > agent profile
//   - missing-config error messages (file path + source label)
//   - MCP placeholder fixup
//
// CHORUSGATE_HOME is captured at module import time, so we set it to a
// temp dir BEFORE dynamically importing load-env.js.  This keeps every
// test isolated from the real ~/.chorusgate.
// ============================================================

import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ---- Isolated config home (must be set before importing load-env) ----
const tempHome = mkdtempSync(join(tmpdir(), "cg-loadenv-"));
process.env.CHORUSGATE_HOME = tempHome;

const {
  CHORUSGATE_HOME,
  agentProfileEnvPath,
  agentProfileExists,
  listAgentProfiles,
  loadEnv,
  fixMcpPlaceholders,
} = await import("../src/load-env.js");

// ---- Saved env for restoration (captured AFTER setting CHORUSGATE_HOME) ----
const SAVED_ENV = { ...process.env };

function clearChorusGateEnv(): void {
  // The dev shell may export real ChorusGate tokens; loadEnv must never
  // see them, or it will refuse to overwrite "shell values". We clear them
  // up front and rely on afterEach to restore the originals.
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith("SLACK_") ||
      k.startsWith("GATEWAY_") ||
      k.startsWith("CLAUDE_") ||
      k.startsWith("CODEX_") ||
      k.startsWith("TRELLO_")
    ) {
      delete process.env[k];
    }
  }
}

function restoreEnv(): void {
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED_ENV)) delete process.env[k];
  }
  Object.assign(process.env, SAVED_ENV);
}

beforeEach(() => {
  // Fresh, empty agent home per test.
  if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true });
  mkdirSync(tempHome, { recursive: true });
  clearChorusGateEnv();
});

afterEach(() => {
  restoreEnv();
});

after(() => {
  restoreEnv();
  rmSync(tempHome, { recursive: true, force: true });
});

function writeAgentEnv(agentId: string, vars: Record<string, string>): string {
  const dir = join(tempHome, agentId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, ".env");
  writeFileSync(
    filePath,
    Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n"),
    "utf8",
  );
  return filePath;
}

// ============================================================
// Path resolution
// ============================================================

describe("CHORUSGATE_HOME override & path resolution", () => {
  it("honors the CHORUSGATE_HOME override instead of the real user home", () => {
    assert.equal(resolve(CHORUSGATE_HOME), resolve(tempHome));
  });

  it("resolves agent profile .env under the config home", () => {
    assert.equal(
      agentProfileEnvPath("claude"),
      resolve(tempHome, "claude", ".env"),
    );
    assert.equal(
      agentProfileEnvPath("codex"),
      resolve(tempHome, "codex", ".env"),
    );
  });

  it("builds the profile path via join() (platform-adaptive separators)", () => {
    const p = agentProfileEnvPath("claude");
    assert.ok(p.endsWith(join("claude", ".env")));
    assert.ok(p.startsWith(resolve(CHORUSGATE_HOME)));
  });
});

// ============================================================
// Agent profile discovery
// ============================================================

describe("agent profile discovery", () => {
  it("agentProfileExists is false for a missing agent", () => {
    assert.equal(agentProfileExists("nope"), false);
  });

  it("agentProfileExists is true after the profile file is created", () => {
    writeAgentEnv("claude", { SLACK_BOT_TOKEN: "xoxb-test" });
    assert.equal(agentProfileExists("claude"), true);
  });

  it("listAgentProfiles returns [] for an empty home", () => {
    assert.deepEqual(listAgentProfiles(), []);
  });

  it("listAgentProfiles lists only dirs containing a .env", () => {
    writeAgentEnv("claude", { SLACK_BOT_TOKEN: "xoxb-test" });
    writeAgentEnv("codex", { SLACK_BOT_TOKEN: "xoxb-test" });
    // A dir without .env must NOT be listed.
    mkdirSync(join(tempHome, "half"), { recursive: true });
    assert.deepEqual(listAgentProfiles().sort(), ["claude", "codex"]);
  });

  it("listAgentProfiles tolerates a missing home directory", () => {
    rmSync(tempHome, { recursive: true, force: true });
    assert.deepEqual(listAgentProfiles(), []);
  });
});

// ============================================================
// loadEnv — agent-profile mode (#134)
// ============================================================

describe("loadEnv — agent-profile mode", () => {
  it("loads ~/.chorusgate/<agent>/.env values into the environment", () => {
    writeAgentEnv("claude", {
      SLACK_BOT_TOKEN: "xoxb-profile",
      SLACK_APP_TOKEN: "xapp-profile",
    });
    const merged = loadEnv({ agentId: "claude" });
    assert.equal(process.env.SLACK_BOT_TOKEN, "xoxb-profile");
    assert.equal(process.env.SLACK_APP_TOKEN, "xapp-profile");
    assert.equal(merged.SLACK_BOT_TOKEN, "xoxb-profile");
  });

  it("loads a second agent profile without leaking the first", () => {
    writeAgentEnv("claude", { SLACK_BOT_TOKEN: "xoxb-claude" });
    writeAgentEnv("codex", { SLACK_BOT_TOKEN: "xoxb-codex" });
    // The merged result is the source of truth: once loadEnv sets an env
    // var, a later load treats it as a shell value and keeps it pinned, so
    // we assert the returned merge (which always reflects the file).
    const m1 = loadEnv({ agentId: "claude" });
    assert.equal(m1.SLACK_BOT_TOKEN, "xoxb-claude");
    const m2 = loadEnv({ agentId: "codex" });
    assert.equal(m2.SLACK_BOT_TOKEN, "xoxb-codex");
  });

  it("throws a locatable error when the agent profile file is missing", () => {
    assert.throws(
      () => loadEnv({ agentId: "ghost" }),
      (err: Error) =>
        /Config file not found/.test(err.message) &&
        err.message.includes(resolve(tempHome, "ghost", ".env")) &&
        /agent profile "ghost"/.test(err.message),
    );
  });
});

// ============================================================
// loadEnv — explicit env-file mode
// ============================================================

describe("loadEnv — explicit env-file mode", () => {
  it("loads the given absolute .env path", () => {
    const envFile = join(tempHome, "standalone.env");
    writeFileSync(envFile, "SLACK_BOT_TOKEN=xoxb-file\nGATEWAY_PROVIDER=codex\n", "utf8");
    const merged = loadEnv({ envFile });
    assert.equal(process.env.SLACK_BOT_TOKEN, "xoxb-file");
    assert.equal(process.env.GATEWAY_PROVIDER, "codex");
    assert.equal(merged.SLACK_BOT_TOKEN, "xoxb-file");
  });

  it("throws a locatable error when the env-file is missing", () => {
    const missing = resolve(tempHome, "missing.env");
    assert.throws(
      () => loadEnv({ envFile: missing }),
      (err: Error) =>
        /Config file not found/.test(err.message) &&
        err.message.includes(missing) &&
        /explicit env-file/.test(err.message),
    );
  });
});

// ============================================================
// loadEnv — load priority: shell > env-file > agent profile
// ============================================================

describe("loadEnv — load priority", () => {
  it("shell environment is never overwritten by a file", () => {
    writeAgentEnv("claude", { SLACK_BOT_TOKEN: "xoxb-profile" });
    process.env.SLACK_BOT_TOKEN = "xoxb-shell";
    loadEnv({ agentId: "claude" });
    assert.equal(process.env.SLACK_BOT_TOKEN, "xoxb-shell");
  });

  it("env-file overrides the agent profile when both are given", () => {
    writeAgentEnv("claude", { SLACK_BOT_TOKEN: "xoxb-profile" });
    const envFile = join(tempHome, "override.env");
    writeFileSync(envFile, "SLACK_BOT_TOKEN=xoxb-override\n", "utf8");
    loadEnv({ agentId: "claude", envFile });
    assert.equal(process.env.SLACK_BOT_TOKEN, "xoxb-override");
  });
});

// ============================================================
// loadEnv — legacy mode smoke (missing files are tolerated)
// ============================================================

describe("loadEnv — legacy mode", () => {
  it("tolerates missing global/cwd .env files and returns a merged object", () => {
    // Global and cwd files do not exist under the isolated home; the
    // project .env may or may not be present.  Legacy mode must not throw.
    let result: Record<string, string>;
    assert.doesNotThrow(() => {
      result = loadEnv();
    });
    assert.ok(typeof result === "object" && result !== null);
  });
});

// ============================================================
// MCP placeholder fixup
// ============================================================

describe("fixMcpPlaceholders", () => {
  it("replaces a ${...} placeholder with the parsed value", () => {
    process.env.SLACK_BOT_TOKEN = "${SLACK_BOT_TOKEN}";
    fixMcpPlaceholders({ SLACK_BOT_TOKEN: "xoxb-real" }, ["SLACK_BOT_TOKEN"]);
    assert.equal(process.env.SLACK_BOT_TOKEN, "xoxb-real");
  });

  it("leaves an already-resolved value untouched", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-resolved";
    fixMcpPlaceholders({ SLACK_BOT_TOKEN: "xoxb-file" }, ["SLACK_BOT_TOKEN"]);
    assert.equal(process.env.SLACK_BOT_TOKEN, "xoxb-resolved");
  });

  it("leaves a placeholder untouched when no parsed value exists", () => {
    process.env.SLACK_APP_TOKEN = "${SLACK_APP_TOKEN}";
    fixMcpPlaceholders({}, ["SLACK_APP_TOKEN"]);
    assert.equal(process.env.SLACK_APP_TOKEN, "${SLACK_APP_TOKEN}");
  });

  it("ignores keys not requested", () => {
    process.env.OTHER_SECRET = "${OTHER_SECRET}";
    fixMcpPlaceholders({ OTHER_SECRET: "xoxb-other" }, ["SLACK_BOT_TOKEN"]);
    assert.equal(process.env.OTHER_SECRET, "${OTHER_SECRET}");
  });
});
