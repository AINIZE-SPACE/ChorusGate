import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateConfig } from "../src/config-migrate.js";

describe("config migrate cwd preservation", () => {
  it("adds an explicit cwd when migrating a project-local config", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorusgate-migrate-"));
    try {
      const source = join(dir, ".env");
      writeFileSync(
        source,
        "SLACK_BOT_TOKEN=xoxb-test\nSLACK_APP_TOKEN=xapp-test\n",
        "utf8",
      );

      const result = migrateConfig({
        agentId: "claude",
        from: source,
        cwd: dir,
      });

      assert.equal(result.mode, "dry-run");
      assert.ok(result.chorusgateKeys.includes("GATEWAY_CLAUDE_CWD"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a missing cwd before writing", () => {
    const dir = mkdtempSync(join(tmpdir(), "chorusgate-migrate-"));
    try {
      const source = join(dir, ".env");
      writeFileSync(source, "SLACK_BOT_TOKEN=xoxb-test\n", "utf8");

      assert.throws(
        () => migrateConfig({
          agentId: "codex",
          from: source,
          cwd: join(dir, "missing"),
        }),
        /Working directory not found or not a directory/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
