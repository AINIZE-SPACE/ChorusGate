import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adminRequirementMessage,
  requireWindowsAdmin,
} from "../src/require-admin.js";

describe("Windows admin requirement", () => {
  it("passes through when the elevation check succeeds", () => {
    assert.equal(requireWindowsAdmin({ check: () => true }), true);
  });

  it("exits with code 1 when the elevation check fails", () => {
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit stubbed");
    }) as typeof process.exit;
    try {
      assert.throws(() => requireWindowsAdmin({ check: () => false }));
    } finally {
      process.exit = origExit;
    }
    assert.equal(exitCode, 1);
  });

  it("includes guidance and the command hint in the message", () => {
    const msg = adminRequirementMessage("Command: chorusgate run");
    assert.match(msg, /administrator privileges/);
    assert.match(msg, /Run as administrator/);
    assert.match(msg, /Command: chorusgate run/);
  });

  it("omits the hint line when none is given", () => {
    const msg = adminRequirementMessage();
    assert.match(msg, /administrator privileges/);
    assert.ok(!msg.includes("[chorusgate] undefined"));
  });
});