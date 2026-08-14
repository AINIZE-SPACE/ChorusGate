// ============================================================
// Gateway control-plane paths — per-agent isolation
//
// Verifies that process-level files (pid/status/log) resolve under
// ~/.chorusgate/<agent>/ and are independent per agent, per the
// architect ruling: agents are cross-project; `--agent` omitted
// == "default". The project-local .gateway/ is NOT the daemon home.
// ============================================================

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// Redirect HOME/USERPROFILE before loading so CHORUSGATE_HOME is
// deterministic and demonstrably home-based, not cwd-based. tsx strips
// import query strings, so we import exactly once and assert pure path
// semantics instead of reloading the module per test.
const tempHome = mkdtempSync(join(tmpdir(), "cg-paths-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const gp = await import("../src/gateway-paths.js");

after(() => {
  if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true });
});

describe("gateway-paths: per-agent home resolution", () => {
  it('resolves (--agent omitted) to ~/.chorusgate/default', () => {
    const expected = resolve(tempHome, ".chorusgate", "default");
    assert.equal(gp.getAgentHome(), expected);
    assert.equal(gp.getGatewayDir(), expected);
    assert.equal(gp.getAgentHome(), gp.getAgentHome("default"));
  });

  it("resolves each agent to its own isolated home", () => {
    assert.equal(
      gp.getAgentHome("codex"),
      resolve(tempHome, ".chorusgate", "codex"),
    );
    assert.equal(
      gp.getAgentHome("claude"),
      resolve(tempHome, ".chorusgate", "claude"),
    );
    assert.notEqual(gp.getAgentHome("codex"), gp.getAgentHome("claude"));
  });

  it("scopes pid/status/log per agent (no shared snapshot)", () => {
    for (const agent of ["default", "codex", "claude"]) {
      const home = resolve(tempHome, ".chorusgate", agent);
      assert.equal(gp.getPidFile(agent), resolve(home, "gateway.pid"));
      assert.equal(gp.getStatusFile(agent), resolve(home, "status.json"));
      assert.equal(gp.getLogFile(agent), resolve(home, "gateway.log"));
    }
    assert.notEqual(gp.getPidFile("codex"), gp.getPidFile("claude"));
    assert.notEqual(gp.getStatusFile("codex"), gp.getStatusFile("claude"));
    assert.notEqual(gp.getLogFile("codex"), gp.getLogFile("claude"));
  });

  it("never places the daemon home under cwd (cross-project)", () => {
    const cwd = process.cwd();
    assert.ok(!gp.getGatewayDir("codex").startsWith(cwd));
    assert.ok(!gp.getPidFile("codex").startsWith(cwd));
    assert.ok(gp.getGatewayDir("codex").split(sep).includes(".chorusgate"));
  });

  it("ensureGatewayDir creates the agent home", () => {
    const dir = gp.getGatewayDir("codex");
    assert.equal(existsSync(dir), false);
    gp.ensureGatewayDir("codex");
    assert.equal(existsSync(dir), true);
  });
});