// ============================================================
// Reply Engine — generate a reply by spawning `claude -p` (headless)
//
// The gateway calls this for each incoming Slack message that warrants
// a reply. We shell out to the Claude Code CLI in print/headless mode so
// the bot has the same model + tool capabilities as an interactive session
// (this matches the Hermes-style "agent with tools" behavior the user wants).
//
// MCP wiring: we pass --strict-mcp-config + a generated SENDER-ONLY Slack MCP
// config. This gives the spawned claude the Slack tools (read channel history,
// send messages, etc. — all Web API) so it can actually answer questions like
// "summarize #aifitness". The MCP server runs with MCP_SENDER_ONLY=1, so it
// does NOT open a second Socket Mode connection (which would steal events from
// the gateway — a bug we hit during development). --strict-mcp-config also
// stops it from loading the project's .mcp.json (which WOULD open Socket Mode).
// ============================================================

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ReplyEngineOptions {
  /** Milliseconds before the spawned process is killed. Default 180000. */
  timeoutMs?: number;
  /** Working directory for the claude process. Default: process.cwd(). */
  cwd?: string;
  /** Claude session UUID to bind this turn to (thread continuity). */
  sessionId?: string;
  /**
   * If true, resume an existing session (`--resume`); otherwise create it
   * (`--session-id`). Only meaningful when sessionId is set.
   */
  resume?: boolean;
}

export interface ReplyResult {
  ok: boolean;
  text: string;
  error?: string;
}

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Generate a sender-only Slack MCP config for the spawned claude. We write a
// FILE and pass its path (not inline JSON): on Windows with shell:true, inline
// JSON has its quotes stripped by cmd. The config launches our MCP server via
// `node bin/slack-socket-mcp.mjs` (absolute path — robust on Windows) with
// MCP_SENDER_ONLY=1 so it exposes Slack tools without opening Socket Mode.
const SENDER_MCP_CONFIG = resolve(projectRoot, "config", "sender-mcp.generated.json");
const SENDER_BIN = resolve(projectRoot, "bin", "slack-socket-mcp.mjs");
try {
  writeFileSync(
    SENDER_MCP_CONFIG,
    JSON.stringify(
      {
        mcpServers: {
          slack: {
            command: "node",
            args: [SENDER_BIN],
            env: { MCP_SENDER_ONLY: "1" },
          },
        },
      },
      null,
      2
    )
  );
} catch (err) {
  console.error(
    "[reply-engine] WARNING: could not write sender MCP config:",
    (err as Error).message
  );
}

/**
 * Generate a reply for the given prompt by invoking `claude -p`.
 * Resolves with the trimmed stdout text, or an error description.
 */
export function generateReply(
  prompt: string,
  opts: ReplyEngineOptions = {}
): Promise<ReplyResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return new Promise<ReplyResult>((resolve) => {
    const args = [
      "-p",
      "--output-format",
      "text",
      "--strict-mcp-config",
      "--mcp-config",
      SENDER_MCP_CONFIG,
    ];

    // Bind to a Claude session for thread continuity:
    //  - first turn  → --session-id <uuid>  (creates the session)
    //  - later turns → --resume <uuid>      (resumes with full context)
    if (opts.sessionId) {
      if (opts.resume) {
        args.push("--resume", opts.sessionId);
      } else {
        args.push("--session-id", opts.sessionId);
      }
    }

    // Pass the prompt via STDIN, not as an argv element. On Windows with
    // shell:true, a multi-line / non-ASCII prompt in argv gets mangled by cmd
    // (newlines truncate it, CJK chars corrupt) — claude then sees an empty
    // prompt and emits its default "Ready to help..." greeting. stdin is safe
    // for any content. `claude -p` with no prompt arg reads it from stdin.
    const child = spawn(CLAUDE_BIN, args, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      // shell:true lets Windows resolve the `claude` / `claude.cmd` shim on PATH
      shell: process.platform === "win32",
    });

    // Write the prompt to stdin and close it so claude starts processing.
    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        text: "",
        error: `claude -p timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        text: "",
        error: `failed to spawn ${CLAUDE_BIN}: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const text = stdout.trim();
      if (code === 0 && text) {
        resolve({ ok: true, text });
      } else if (code === 0 && !text) {
        resolve({
          ok: false,
          text: "",
          error: "claude -p exited 0 but produced no output",
        });
      } else {
        resolve({
          ok: false,
          text: text,
          error: `claude -p exited ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });
  });
}
