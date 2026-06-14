// ============================================================
// link_names:true regression test — verify ALL chat.postMessage
// call sites include link_names: true (P0 #60, P2 #61)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";

const srcDir = resolve(import.meta.dirname ?? __dirname, "..", "src");

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = resolve(dir, e.name);
    if (e.isDirectory() && e.name !== "tools") continue; // tools tested separately
    if (e.isFile() && (extname(e.name) === ".ts")) files.push(full);
  }
  // Include tools/ directory files
  const toolsDir = resolve(dir, "tools");
  try {
    for (const e of readdirSync(toolsDir, { withFileTypes: true })) {
      if (e.isFile() && extname(e.name) === ".ts") files.push(resolve(toolsDir, e.name));
    }
  } catch { /* no tools dir */ }
  return files;
}

test("all chat.postMessage call sites include link_names:true (P0 #60 regression)", () => {
  const files = collectTsFiles(srcDir);
  const callSites: Array<{ file: string; line: number }> = [];
  const missingLinkNames: Array<{ file: string; line: number; content: string }> = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");

    let inPostMessage = false;
    let foundLinkNames = false;
    let callStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes("chat.postMessage(") || line.includes("chat.postMessage (")) {
        inPostMessage = true;
        foundLinkNames = false;
        callStart = i + 1;
        callSites.push({ file, line: i + 1 });
      }

      if (inPostMessage) {
        if (line.includes("link_names")) {
          foundLinkNames = true;
        }
        // Call ends when we see a line with just "}" or "});" or "})"
        if (/^\s*\}[\s;,)]*$/.test(line) || /^\s*\}\)[\s;,)]*$/.test(line)) {
          if (!foundLinkNames) {
            // Get context: the file path relative to project
            const relFile = file.replace(/\\/g, "/").split("/src/").pop() || file;
            missingLinkNames.push({
              file: `src/${relFile}`,
              line: callStart,
              content: lines.slice(callStart - 1, i + 1).join("\n").slice(0, 200),
            });
          }
          inPostMessage = false;
        }
      }
    }
  }

  assert.ok(callSites.length >= 8, `expected at least 8 chat.postMessage call sites, found ${callSites.length}`);

  if (missingLinkNames.length > 0) {
    const details = missingLinkNames
      .map((m) => `  ${m.file}:${m.line}\n    ${m.content.split("\n")[0]}`)
      .join("\n");
    assert.fail(
      `${missingLinkNames.length} chat.postMessage call site(s) missing link_names:true:\n${details}`,
    );
  }

  // Verify all known call sites
  const knownFiles = [
    "src/gateway.ts",
    "src/interrupt.ts",
    "src/session-commands.ts",
    "src/tools/reply.ts",
    "src/tools/send-message.ts",
  ];
  for (const kf of knownFiles) {
    const found = callSites.some((cs) => cs.file.replace(/\\/g, "/").endsWith(kf));
    assert.ok(found, `expected chat.postMessage in ${kf}`);
  }
});
