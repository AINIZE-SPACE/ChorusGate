import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executableExists,
  platformRequirement,
  validateAgentPlatforms,
} from "../src/agent-platform.js";
import type { ProfileConfig } from "../src/profile-config.js";

function profile(providerId: string): ProfileConfig {
  return {
    id: "test",
    botToken: "xoxb-test",
    appToken: "xapp-test",
    providerId,
  };
}

describe("agent platform preflight", () => {
  it("maps claude-stream and codex to their platform requirements", () => {
    assert.equal(platformRequirement(profile("claude-stream"))?.platform, "claude");
    assert.equal(platformRequirement(profile("codex"))?.platform, "codex");
    assert.equal(platformRequirement(profile("custom")), null);
  });

  it("recognizes the current Node executable by absolute path", () => {
    assert.equal(executableExists(process.execPath), true);
  });

  it("reports a missing platform with an actionable hint", () => {
    const old = process.env.CODEX_BIN;
    process.env.CODEX_BIN = "definitely-missing-chorusgate-codex";
    try {
      assert.throws(
        () => validateAgentPlatforms([profile("codex")]),
        /Install codex.*codex --version.*CODEX_BIN/s,
      );
    } finally {
      if (old === undefined) delete process.env.CODEX_BIN;
      else process.env.CODEX_BIN = old;
    }
  });
});
