// ============================================================
// CodexProvider — spawn `codex exec --json`, parse JSONL
//
// 基于 M0 实测 + CLI --help（Codex CLI v0.139.0+）:
//   - codex exec --json --cd <dir> ... -  (prompt via stdin)
//   - codex exec resume --json --cd <dir> ... <tid> -  (resume + stdin prompt)
//   - thread_id 是 UUID 格式顶层字段
//   - --ask-for-approval 在 headless 用 --dangerously-bypass-approvals-and-sandbox
//
// Prompt 通过 stdin 传入，避免 Windows shell 转义问题。
//
// 跟踪: [#23](https://github.com/AINIZE-SPACE/chorusgate/issues/23)
// ============================================================

import { spawn } from "node:child_process";
import { CodexEventParser } from "./codex-parser.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
} from "./types.js";

const CODEX_BIN = process.env.CODEX_BIN || "codex";

/** Shared flags for headless, non-interactive Codex execution. */
const HEADLESS_FLAGS = [
  "--json",
  "--skip-git-repo-check",
  "--dangerously-bypass-approvals-and-sandbox",
];

/** Max iterations to prevent infinite loops (configurable via env). */
const MAX_ITERATIONS = process.env.CODEX_MAX_ITERATIONS || "10";

// ---- spawn helper ------------------------------------------------------------

function spawnCodex(
  positionalArgs: string[],
  prompt: string,
  cwd: string,
  timeoutMs: number,
  parser: CodexEventParser,
): Promise<SessionOutput> {
  return new Promise<SessionOutput>((resolve) => {
    // Flags before positional args: exec <flags> [positional...]
    const flags = [
      "--cd", cwd,
      "--ephemeral",
      "-c", `max_iterations=${MAX_ITERATIONS}`,
      ...HEADLESS_FLAGS,
    ];
    const allArgs = [...flags, ...positionalArgs];

    const win = process.platform === "win32";
    const cmd = win
      ? `"${CODEX_BIN}" ${allArgs.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`
      : CODEX_BIN;
    const spawnArgs = win ? [] : allArgs;

    const child = spawn(cmd, spawnArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: win,
      windowsHide: true,
    });

    // Prompt via stdin (avoids shell quoting issues with CJK/quotes)
    child.stdin!.write(prompt);
    child.stdin!.end();

    let stdoutBuf = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        text: "",
        sessionId: "",
        error: `codex exec timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout!.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) parser.feed(line);
    });

    child.stderr!.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false, text: "", sessionId: "",
        error: `failed to spawn codex: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (stdoutBuf) parser.feed(stdoutBuf);

      const text = parser.getResultText();
      if (code === 0 && text) {
        resolve({ ok: true, text, sessionId: "" });
      } else if (code === 0 && !text) {
        resolve({
          ok: false, text: "", sessionId: "",
          error: "codex exec exited 0 but produced no output",
        });
      } else {
        resolve({
          ok: false, text, sessionId: "",
          error: `codex exec exited ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });
  });
}

// ---- Provider ----------------------------------------------------------------

export const codexProvider: AgentProvider = {
  id: "codex",
  bin: CODEX_BIN,

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    let resolvedSessionId = "";
    const args = ["exec"]; // prompt via stdin

    const parser = new CodexEventParser();
    parser.onProgress = opts.onProgress;
    parser.onSessionId = (tid) => {
      resolvedSessionId = tid;
      opts.onSessionId?.(tid);
    };

    const result = await spawnCodex(args, prompt, opts.cwd, opts.timeoutMs, parser);
    return { ...result, sessionId: resolvedSessionId };
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const args = ["exec", "resume", sessionId]; // prompt via stdin

    const parser = new CodexEventParser();
    parser.onProgress = opts.onProgress;

    return spawnCodex(args, prompt, opts.cwd, opts.timeoutMs, parser).then((r) => ({
      ...r,
      sessionId,
    }));
  },
};
