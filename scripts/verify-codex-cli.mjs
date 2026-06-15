// ============================================================
// verify-codex-cli.mjs — 验证 Codex CLI 调用参数是否正确
//
// 用法: node scripts/verify-codex-cli.mjs [workdir]
//
// 测试: codex exec + codex exec resume 实际 CLI 调用
// 模拟 gateway 的参数组合，确认不会报 "unexpected argument"
// ============================================================

import { spawn } from "node:child_process";

const CODEX = process.env.CODEX_BIN || "codex";
const CWD = process.argv[2] || process.cwd();
const TIMEOUT = 90_000; // 90s timeout

function run(args, prompt, label) {
  return new Promise((resolve) => {
    console.log(`\n=== ${label} ===`);
    console.log(`CMD: codex ${args.join(" ")}`);
    console.log(`STDIN: ${prompt.slice(0, 80)}...`);

    const win = process.platform === "win32";
    const cmd = win
      ? `"${CODEX}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`
      : CODEX;
    const child = spawn(cmd, win ? [] : args, {
      cwd: CWD,
      stdio: ["pipe", "pipe", "pipe"],
      shell: win,
      windowsHide: true,
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = "", stderr = "";
    let lineCount = 0;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      console.log(`❌ TIMEOUT after ${TIMEOUT / 1000}s`);
      resolve(false);
    }, TIMEOUT);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          lineCount++;
          if (lineCount <= 5) console.log(`  OUT: ${line.slice(0, 120)}`);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length < 500) console.log(`  ERR: ${chunk.toString().trim()}`);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdout.trim()) {
        lineCount++;
        console.log(`  OUT: ${stdout.trim().slice(0, 120)}`);
      }
      const ok = code === 0 && lineCount > 0;
      console.log(`  Exit: ${code}, Lines: ${lineCount}, Result: ${ok ? "✅ PASS" : "❌ FAIL"}`);
      if (!ok && stderr) console.log(`  Stderr tail: ${stderr.trim().slice(0, 300)}`);
      resolve(ok);
    });
  });
}

async function main() {
  console.log(`Codex CLI: ${CODEX}`);
  console.log(`Workdir:  ${CWD}`);
  console.log(`Timeout:  ${TIMEOUT / 1000}s`);

  // Test 1: New session with simple prompt
  const t1 = await run(
    ["exec", "--cd", CWD, "-c", "max_iterations=3", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"],
    "回复 'pong' 不要别的文字",
    "Test 1: codex exec (new session)"
  );

  // Test 2: New session with Chinese prompt (simulates real gateway call)
  const t2 = await run(
    ["exec", "--cd", CWD, "-c", "max_iterations=3", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"],
    "(channel C0) 乐老板 wrote: 你是谁？简单回复",
    "Test 2: codex exec (Chinese prompt with quotes)"
  );

  // Test 3: Resume (requires thread_id from test 1 — skip if not available)
  // This tests that resume args don't error
  const t3 = await run(
    ["exec", "resume", "--last", "-c", "max_iterations=3", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"],
    "继续说",
    "Test 3: codex exec resume --last"
  );

  console.log("\n=== Summary ===");
  console.log(`Test 1 (new session):    ${t1 ? "✅" : "❌"}`);
  console.log(`Test 2 (Chinese prompt): ${t2 ? "✅" : "❌"}`);
  console.log(`Test 3 (resume --last):  ${t3 ? "✅" : "❌"}`);

  const allPass = t1 && t2 && t3;
  console.log(`\nOverall: ${allPass ? "ALL PASS ✅" : "FAILURES ❌"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
