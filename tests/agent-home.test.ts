// ============================================================
// Agent-home resolution — official vs custom agent homes
//
// Spec: resolution order is
//   1. --agent-home CLI flag (blank/whitespace -> ignored, falls through)
//   2. AGENT_HOME env var    (checked ONLY on Windows)
//   3. Default official home %USERPROFILE%\.ainize\.config
// Relative --agent-home / AGENT_HOME resolve against %USERPROFILE%.
// CLI overrides env. The official home has NO fallback layered on top.
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  resolveAgentHome,
  resolveConfigPathInHome,
  windowsHomeDir,
  DEFAULT_AGENT_HOME_REL,
} from "../src/agent-home.js";

// Deterministic fixtures — every call passes an explicit home/platform so
// the suite never depends on the real process env or OS.
const WIN_HOME = "C:\\Users\\tester";
const POSIX_HOME = "/home/tester";
const DEFAULT_WIN = resolve(WIN_HOME, ...DEFAULT_AGENT_HOME_REL);
const DEFAULT_POSIX = resolve(POSIX_HOME, ...DEFAULT_AGENT_HOME_REL);

describe("agent-home: resolution order", () => {
  it("CLI --agent-home (absolute) wins over env + default", () => {
    const r = resolveAgentHome({
      cliAgentHome: "C:\\custom\\agent",
      envAgentHome: "C:\\env\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, "C:\\custom\\agent");
  });

  it("CLI --agent-home (relative) wins and resolves against %USERPROFILE%", () => {
    const r = resolveAgentHome({
      cliAgentHome: "my-agents\\work",
      envAgentHome: "C:\\env\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, resolve(WIN_HOME, "my-agents", "work"));
  });

  it("env AGENT_HOME (absolute) used when no CLI flag, on Windows", () => {
    const r = resolveAgentHome({
      envAgentHome: "D:\\env\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, "D:\\env\\agent");
  });

  it("env AGENT_HOME (relative) resolves against %USERPROFILE% on Windows", () => {
    const r = resolveAgentHome({
      envAgentHome: "agents\\claude",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, resolve(WIN_HOME, "agents", "claude"));
  });

  it("falls to the default official home when neither flag nor env is set", () => {
    const r = resolveAgentHome({ platform: "win32", userProfile: WIN_HOME });
    assert.equal(r, DEFAULT_WIN);
  });
});

describe("agent-home: CLI overrides env", () => {
  it("non-blank --agent-home beats a set AGENT_HOME", () => {
    const r = resolveAgentHome({
      cliAgentHome: "C:\\cli\\agent",
      envAgentHome: "C:\\env\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, "C:\\cli\\agent");
  });

  it("blank --agent-home falls through to AGENT_HOME", () => {
    const r = resolveAgentHome({
      cliAgentHome: "   ",
      envAgentHome: "C:\\env\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, "C:\\env\\agent");
  });
});

describe("agent-home: blank/whitespace guard", () => {
  for (const blank of [undefined, "", "   ", "\t", "\n"]) {
    it(`treats --agent-home ${JSON.stringify(blank)} as not provided`, () => {
      const r = resolveAgentHome({
        cliAgentHome: blank,
        envAgentHome: "C:\\env\\agent",
        platform: "win32",
        userProfile: WIN_HOME,
      });
      assert.equal(r, "C:\\env\\agent");
    });
  }

  it("blank AGENT_HOME on Windows falls through to the default", () => {
    const r = resolveAgentHome({
      envAgentHome: "  ",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, DEFAULT_WIN);
  });
});

describe("agent-home: AGENT_HOME is checked only on Windows", () => {
  it("ignores AGENT_HOME on darwin", () => {
    const r = resolveAgentHome({
      envAgentHome: "/opt/env/agent",
      platform: "darwin",
      userProfile: POSIX_HOME,
    });
    assert.equal(r, DEFAULT_POSIX);
  });

  it("ignores AGENT_HOME on linux", () => {
    const r = resolveAgentHome({
      envAgentHome: "/opt/env/agent",
      platform: "linux",
      userProfile: POSIX_HOME,
    });
    assert.equal(r, DEFAULT_POSIX);
  });

  it("honors AGENT_HOME on win32", () => {
    const r = resolveAgentHome({
      envAgentHome: "C:\\env\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, "C:\\env\\agent");
  });
});

describe("agent-home: home-dir (relative path) resolution", () => {
  it("resolves a relative --agent-home against %USERPROFILE%", () => {
    const r = resolveAgentHome({
      cliAgentHome: "rel\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, resolve(WIN_HOME, "rel", "agent"));
  });

  it("resolves a relative AGENT_HOME against %USERPROFILE%", () => {
    const r = resolveAgentHome({
      envAgentHome: "rel\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, resolve(WIN_HOME, "rel", "agent"));
  });

  it("keeps an absolute --agent-home verbatim (no rebasing under home)", () => {
    const r = resolveAgentHome({
      cliAgentHome: "C:\\abs\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, "C:\\abs\\agent");
    assert.ok(!r.startsWith(resolve(WIN_HOME)));
  });

  it("keeps an absolute AGENT_HOME verbatim (no rebasing under home)", () => {
    const r = resolveAgentHome({
      envAgentHome: "C:\\abs\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.equal(r, "C:\\abs\\agent");
    assert.ok(!r.startsWith(resolve(WIN_HOME)));
  });
});

describe("agent-home: defaults (official home, no fallback)", () => {
  it("default is exactly %USERPROFILE%\\.ainize\\.config", () => {
    assert.equal(
      resolveAgentHome({ platform: "win32", userProfile: WIN_HOME }),
      resolve(WIN_HOME, ".ainize", ".config"),
    );
    assert.equal(
      resolveAgentHome({ platform: "linux", userProfile: POSIX_HOME }),
      resolve(POSIX_HOME, ".ainize", ".config"),
    );
  });

  it("default does not equal a custom agent home", () => {
    const custom = resolveAgentHome({
      cliAgentHome: "C:\\custom\\agent",
      platform: "win32",
      userProfile: WIN_HOME,
    });
    assert.notEqual(DEFAULT_WIN, custom);
  });

  it("windowsHomeDir() is %USERPROFILE% when set", () => {
    const prev = process.env.USERPROFILE;
    try {
      process.env.USERPROFILE = "C:\\Users\\whoami";
      assert.equal(windowsHomeDir(), "C:\\Users\\whoami");
    } finally {
      if (prev === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prev;
    }
  });
});

describe("agent-home: config-path hardening guard", () => {
  it("passes through an absolute config file path", () => {
    const r = resolveConfigPathInHome("C:\\agent\\home", "C:\\cfg\\a.env", {
      source: "cli",
    });
    assert.equal(r, "C:\\cfg\\a.env");
  });

  it("joins a relative config file under an absolute agent home", () => {
    const r = resolveConfigPathInHome("C:\\agent\\home", "profiles\\a.env", {
      source: "cli",
    });
    assert.equal(r, resolve("C:\\agent\\home", "profiles", "a.env"));
  });

  it("throws for CLI when both config path and agent home are relative", () => {
    assert.throws(
      () =>
        resolveConfigPathInHome("rel\\home", "profiles\\a.env", {
          source: "cli",
        }),
      /must be absolute/,
    );
  });

  it("resolves relative agent home against %USERPROFILE% for env", () => {
    const r = resolveConfigPathInHome("rel\\home", "profiles\\a.env", {
      source: "env",
      userProfile: WIN_HOME,
    });
    assert.equal(r, resolve(WIN_HOME, "rel", "home", "profiles", "a.env"));
  });
});
