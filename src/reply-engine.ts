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
  /**
   * Called as the agent works, with a short human-friendly progress label
   * derived from tool-use events (e.g. "📖 读取频道消息中…"). Lets the gateway
   * show live progress so a long reply doesn't look frozen.
   */
  onProgress?: (label: string) => void;
}

export interface ReplyResult {
  ok: boolean;
  text: string;
  error?: string;
}

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// Headless `claude -p` has no interactive approval UI. If a tool call needs
// permission and the mode isn't permissive, it stalls/fails — so Slack tools
// (channel history, etc.) wouldn't work. Default to bypassing approvals;
// override with CLAUDE_PERMISSION_MODE if you want stricter behavior.
const PERMISSION_MODE =
  process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Generate a sender-only Slack MCP config for the spawned claude. We write a
// FILE and pass its path (not inline JSON): on Windows with shell:true, inline
// JSON has its quotes stripped by cmd. The config launches our MCP server via
// `node bin/slack-socket-mcp.mjs` (absolute path — robust on Windows) with
// MCP_SENDER_ONLY=1 so it exposes Slack tools without opening Socket Mode.
//
// Tokens are injected into env explicitly (not left to the MCP server to find
// .env on disk) so the config is self-contained and works regardless of cwd.
function ensureSenderMCPConfig(): string {
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
              env: {
                MCP_SENDER_ONLY: "1",
                SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "",
                SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN || "",
              },
            },
          },
        },
        null,
        2
      ),
    );
  } catch (err) {
    console.error(
      "[reply-engine] WARNING: could not write sender MCP config:",
      (err as Error).message,
    );
  }
  return SENDER_MCP_CONFIG;
}

let _senderMCPConfig: string | null = null;
function getSenderMCPConfig(): string {
  if (_senderMCPConfig === null) _senderMCPConfig = ensureSenderMCPConfig();
  return _senderMCPConfig;
}

/** Map a tool name (incl. mcp__slack__* and built-ins) to a progress label. */
function toolLabel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("channel_history") || n.includes("thread_replies"))
    return "📖 读取频道消息中…";
  if (n.includes("send_message") || n.endsWith("slack_reply"))
    return "✍️ 发送消息中…";
  if (n.includes("search")) return "🔍 搜索 Slack 中…";
  if (n.includes("list_channels") || n.includes("get_user"))
    return "📇 查询信息中…";
  if (n.includes("add_reaction")) return "👍 添加反应中…";
  if (n === "read" || n === "grep" || n === "glob")
    return "📂 查阅资料中…";
  if (n === "bash") return "⚙️ 执行命令中…";
  if (n === "websearch" || n === "webfetch") return "🌐 联网检索中…";
  if (n === "write" || n === "edit") return "📝 整理内容中…";
  // Strip mcp prefix for a cleaner fallback label.
  const short = name.replace(/^mcp__[^_]+__/, "");
  return `🛠️ 处理中（${short}）…`;
}

/**
 * Generate a reply for the given prompt by invoking `claude -p`.
 * Resolves with the trimmed reply text, or an error description.
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
      "stream-json",
      "--verbose", // required for -p to emit intermediate events
      "--permission-mode",
      PERMISSION_MODE,
      "--strict-mcp-config",
      "--mcp-config",
      getSenderMCPConfig(),
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
    //
    // On Windows, shell:true is required for .cmd shims on PATH. But passing
    // an args array with shell:true triggers DEP0190 (Node warns args aren't
    // escaped). Work around that by concatenating the command ourselves — we
    // control all args so injection isn't a concern here.
    const win = process.platform === "win32";
    const cmd = win
      ? `"${CLAUDE_BIN}" ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`
      : CLAUDE_BIN;
    const spawnArgs = win ? [] : args;
    const child = spawn(cmd, spawnArgs, {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      shell: win,
      windowsHide: true,
    });

    // Write the prompt to stdin and close it so claude starts processing.
    child.stdin.write(prompt);
    child.stdin.end();

    let stdoutBuf = ""; // holds the partial trailing line between chunks
    let stderr = "";
    let settled = false;
    let resultText = ""; // final text from the `result` event
    let assistantText = ""; // accumulated assistant text (fallback)

    /** Parse one NDJSON line from the stream-json output. */
    const handleLine = (line: string): void => {
      const t = line.trim();
      if (!t || t[0] !== "{") return;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(t);
      } catch {
        return; // not JSON — ignore defensively
      }
      const type = evt.type as string | undefined;

      if (type === "assistant") {
        const msg = evt.message as Record<string, unknown> | undefined;
        const content = (msg?.content as unknown[]) || [];
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_use" && typeof b.name === "string") {
            opts.onProgress?.(toolLabel(b.name));
          } else if (b.type === "text" && typeof b.text === "string") {
            assistantText += b.text;
          }
        }
      } else if (type === "result") {
        // Final result event carries the reply text in `result`.
        if (typeof evt.result === "string") resultText = evt.result;
      }
    };

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
      stdoutBuf += chunk.toString();
      // Split into lines. Windows may emit \r\n; strip \r first so JSON.parse
      // never sees a trailing carriage return.
      const lines = stdoutBuf.replace(/\r/g, "").split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
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

      // Flush any trailing buffered line.
      if (stdoutBuf) handleLine(stdoutBuf);

      // Prefer the result event's text; fall back to accumulated assistant text.
      const text = (resultText || assistantText).trim();
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
          text,
          error: `claude -p exited ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });
  });
}
