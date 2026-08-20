// ============================================================
// config-cli unit tests — Issue #134: Agent Profile Config
//
// Exercises the real `config migrate` CLI wrapper in src/config-cli.ts:
//   - parseMigrateArgs flag parsing (space + equals forms, defaults)
//   - runMigrate exit-code behavior (0 success / 1 error)
//   - end-to-end dry-run and apply against an isolated CHORUSGATE_HOME
//
// CHORUSGATE_HOME is set to a temp dir before importing config-cli.js so
// an --apply run writes into the temp home, never the real ~/.chorusgate.
// ============================================================

import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ---- Isolated config home (must be set before importing config-cli) ----
const tempHome = mkdtempSync(join(tmpdir(), "cg-cli-"));
process.env.CHORUSGATE_HOME = tempHome;

const { parseMigrateArgs, runMigrate } = await import("../src/config-cli.js");

const SAVED_ENV = { ...process.env };
const SAVED_ARGV = process.argv;
const SAVED_EXIT_CODE = process.exitCode;

function restoreState(): void {
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED_ENV)) delete process.env[k];
  }
  Object.assign(process.env, SAVED_ENV);
  process.argv = SAVED_ARGV;
  process.exitCode = SAVED_EXIT_CODE;
}

beforeEach(() => {
  if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true });
  mkdirSync(tempHome, { recursive: true });
  process.exitCode = SAVED_EXIT_CODE;
});

afterEach(() => {
  restoreState();
});

after(() => {
  restoreState();
  rmSync(tempHome, { recursive: true, force: true });
});

function migrateArgv(flags: string[]): string[] {
  return ["node", "chorusgate", "config", "migrate", ...flags];
}

// ============================================================
// parseMigrateArgs — flag parsing
// ============================================================

describe("parseMigrateArgs", () => {
  it("parses all flags in space-separated form", () => {
    const args = parseMigrateArgs(
      migrateArgv([
        "--agent", "claude",
        "--from", "/tmp/source.env",
        "--cwd", "/tmp/project",
        "--apply",
        "--force",
      ]),
    );
    assert.deepEqual(args, {
      agentId: "claude",
      from: "/tmp/source.env",
      cwd: "/tmp/project",
      apply: true,
      force: true,
    });
  });

  it("parses flags in equals form", () => {
    const args = parseMigrateArgs(
      migrateArgv(["--agent=codex", "--from=/abs/source.env", "--cwd=/abs/proj"]),
    );
    assert.deepEqual(args, {
      agentId: "codex",
      from: "/abs/source.env",
      cwd: "/abs/proj",
      apply: false,
      force: false,
    });
  });

  it("defaults to dry-run when --apply is absent", () => {
    const args = parseMigrateArgs(migrateArgv(["--from", "/tmp/source.env"]));
    assert.equal(args.apply, false);
    assert.equal(args.force, false);
    assert.equal(args.agentId, undefined);
  });

  it("ignores unknown flags and command tokens", () => {
    const args = parseMigrateArgs(
      migrateArgv(["--from", "/tmp/source.env", "--verbose", "extra"]),
    );
    assert.equal(args.from, "/tmp/source.env");
    assert.equal(args.agentId, undefined);
  });

  it("throws a usage error when --from is missing", () => {
    assert.throws(
      () => parseMigrateArgs(migrateArgv(["--agent", "claude", "--apply"])),
      /--from <path> is required/,
    );
  });
});

// ============================================================
// runMigrate — exit codes and side effects
// ============================================================

describe("runMigrate", () => {
  it("succeeds with a dry-run preview (exitCode 0, no file written)", () => {
    const source = join(tempHome, "legacy.env");
    writeFileSync(source, "SLACK_BOT_TOKEN=xoxb-test\nMY_VAR=keep\n", "utf8");
    process.argv = migrateArgv(["--agent", "claude", "--from", source]);

    return runMigrate().then(() => {
      assert.equal(process.exitCode, 0);
      assert.ok(!existsSync(join(tempHome, "claude", ".env")));
    });
  });

  it("exits 1 with a clear message when --from is missing", () => {
    process.argv = migrateArgv(["--agent", "claude"]);

    return runMigrate().then(() => {
      assert.equal(process.exitCode, 1);
    });
  });

  it("exits 1 when the source file does not exist", () => {
    process.argv = migrateArgv([
      "--agent", "claude",
      "--from", join(tempHome, "missing.env"),
    ]);

    return runMigrate().then(() => {
      assert.equal(process.exitCode, 1);
    });
  });

  it("--apply writes ChorusGate keys to the isolated home, keeping platform keys out", () => {
    const source = join(tempHome, "legacy.env");
    writeFileSync(
      source,
      "SLACK_BOT_TOKEN=xoxb-test\nANTHROPIC_API_KEY=sk-test\n",
      "utf8",
    );
    process.argv = migrateArgv([
      "--agent", "codex",
      "--from", source,
      "--apply",
    ]);

    return runMigrate().then(() => {
      assert.equal(process.exitCode, 0);
      const target = join(tempHome, "codex", ".env");
      assert.ok(existsSync(target));
      const content = readFileSync(target, "utf8");
      assert.ok(content.includes("SLACK_BOT_TOKEN=xoxb-test"));
      assert.ok(!content.includes("ANTHROPIC_API_KEY"));
      // Source file must be preserved.
      assert.ok(readFileSync(source, "utf8").includes("ANTHROPIC_API_KEY=sk-test"));
    });
  });
});
