// ============================================================
// Test: verify reply-engine timeout mechanism (corrected)
//
// Uses `node -e "setTimeout(...)"` to simulate a long-running
// claude -p, avoiding Windows cmd.exe timeout syntax quirks.
// ============================================================

import { spawn } from "node:child_process";

function spawnWithTimeout(command, args, timeoutMs, shell, input) {
  return new Promise((resolve) => {
    const opts = {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    };
    // Only set shell when needed
    if (shell) opts.shell = true;

    const child = spawn(command, args, opts);
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }

    let stdout = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        text: "",
        error: `timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, text: "", error: `spawn failed: ${err.message}` });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = stdout.trim();
      if (code === 0 && text) {
        resolve({ ok: true, text });
      } else if (signal) {
        resolve({
          ok: false,
          text,
          error: `killed by signal ${signal}`,
        });
      } else {
        resolve({
          ok: false,
          text,
          error: `exited ${code}: ${text.slice(0, 100)}`,
        });
      }
    });
  });
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.error(`  ✅ ${label}`);
    passed += 1;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed += 1;
  }
}

// ============================================================

console.error("=== Test 1: Timeout kills long-running node process ===");
{
  const start = Date.now();
  const result = await spawnWithTimeout(
    process.execPath,
    ["-e", "setTimeout(() => {}, 60000)"],
    2000,
    false,   // no shell — direct process spawn
    null
  );
  const elapsed = Date.now() - start;

  assert(result.ok === false, "result is not ok");
  assert(
    result.error.includes("timed out") || result.error.includes("killed"),
    `error indicates termination: "${result.error}"`
  );
  assert(elapsed >= 1800, `elapsed >= 1.8s (actual: ${elapsed}ms)`);
  assert(elapsed < 5000, `elapsed < 5s — didn't wait 60s (actual: ${elapsed}ms)`);
}

console.error("\n=== Test 2: Fast process completes before timeout ===");
{
  const start = Date.now();
  const result = await spawnWithTimeout(
    process.execPath,
    ["-e", "console.log('hello-from-node')"],
    10000,
    false,
    null
  );
  const elapsed = Date.now() - start;

  assert(result.ok === true, "result is ok");
  assert(result.text.includes("hello-from-node"), `text correct: "${result.text}"`);
  assert(elapsed < 3000, `elapsed < 3s (actual: ${elapsed}ms)`);
}

console.error("\n=== Test 3: Timeout with stdin input (claude -p pattern) ===");
{
  // This tests the EXACT pattern used in reply-engine.ts:
  // child.stdin.write(prompt); child.stdin.end();
  const start = Date.now();
  const result = await spawnWithTimeout(
    process.execPath,
    ["-e", "process.stdin.on('data', () => {}); setTimeout(() => {}, 60000)"],
    2000,
    false,
    "some prompt text"
  );
  const elapsed = Date.now() - start;

  assert(result.ok === false, "result is not ok (timeout fired)");
  assert(
    result.error.includes("timed out") || result.error.includes("killed"),
    `error indicates termination: "${result.error}"`
  );
  assert(elapsed >= 1800, `elapsed >= 1.8s (actual: ${elapsed}ms)`);
  assert(elapsed < 5000, `elapsed < 5s (actual: ${elapsed}ms)`);
}

console.error("\n=== Test 4: Timeout fires exactly once (settled flag) ===");
{
  // Spawn 5 processes in parallel, each with a short timeout. If settled
  // flag doesn't work, we'd see unhandled rejections.
  const starts = [];
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push((async () => {
      const s = Date.now();
      const r = await spawnWithTimeout(
        process.execPath,
        ["-e", "setTimeout(() => {}, 60000)"],
        1500,
        false,
        null
      );
      starts.push(Date.now() - s);
      return r;
    })());
  }
  const results = await Promise.all(promises);

  let allTimedOut = true;
  let allFast = true;
  for (let i = 0; i < results.length; i++) {
    if (results[i].ok !== false) allTimedOut = false;
    if (starts[i] > 4000) allFast = false;
  }
  assert(allTimedOut, `all ${results.length} results timed out`);
  assert(allFast, `all ${results.length} resolved within 4s`);
}

console.error("\n=== Test 5: Timeout on shell:true Windows (claude -p real pattern) ===");
{
  // Replicate the exact spawn pattern from reply-engine.ts on Windows:
  // spawn("claude ...args", [], { shell: true, windowsHide: true })
  const args = ["-e", "setTimeout(() => {}, 60000)"];
  const isWin = process.platform === "win32";
  // Build command string like reply-engine does on Windows
  const cmd = isWin
    ? `"${process.execPath}" ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`
    : process.execPath;
  const spawnArgs = isWin ? [] : args;

  const start = Date.now();
  const result = await spawnWithTimeout(
    cmd,
    spawnArgs,
    3000,
    isWin,
    null
  );
  const elapsed = Date.now() - start;

  assert(result.ok === false, "result is not ok");
  assert(
    result.error.includes("timed out") || result.error.includes("killed"),
    `error indicates termination: "${result.error}"`
  );
  assert(elapsed >= 2500, `elapsed >= 2.5s (actual: ${elapsed}ms)`);
  assert(elapsed < 8000, `elapsed < 8s (actual: ${elapsed}ms)`);
}

console.error(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
process.exit(failed > 0 ? 1 : 0);
