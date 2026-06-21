// ============================================================
// CodexProvider — spawn `codex exec --json`, parse JSONL
//
// 基于 M0 实测 + CLI --help（Codex CLI v0.139.0+）:
//   - codex exec --json --cd <dir> ... -  (prompt via stdin)
//   - codex exec --json resume ... <tid> -  (resume + stdin prompt)
//   - --json 是 exec 子命令的 flag，不是全局 flag，必须放在 exec 之后
//   - thread_id 是 UUID 格式顶层字段
//   - --ask-for-approval 在 headless 用 --dangerously-bypass-approvals-and-sandbox
//
// Prompt 通过 stdin 传入，避免 Windows shell 转义问题。
//
// 跟踪: [#23](https://github.com/AINIZE-SPACE/chorusgate/issues/23)
// ============================================================

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CodexEventParser } from "./codex-parser.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
} from "./types.js";

/**
 * Shared flags for headless, non-interactive Codex execution.
 *
 * VERIFIED against codex 0.139.0 via scripts/verify-codex-cli.mjs.
 * Add new flags ONLY after testing with: node scripts/verify-codex-cli.mjs
 *
 * Approval: always use bypass for headless pipe mode.
 * --ask-for-approval=on-request requires interactive terminal.
 * Gateway INTERACTIVE_PERMISSIONS is for Claude stream-json only — Codex
 * doesn't support stdin/stdout interactive approval (see #84 for v4 plan).
 */
/**
 * Shared flags for headless, non-interactive Codex execution.
 *
 * VERIFIED against codex 0.139.0 via scripts/verify-codex-cli.mjs.
 * Add new flags ONLY after testing with: node scripts/verify-codex-cli.mjs
 *
 * Approval: Codex CLI does NOT support interactive approval (Spike #99).
 * --ask-for-approval does not exist in v0.139.0+.
 * We use sandbox mode (-s workspace-write) as a safety baseline.
 * Set GATEWAY_CODEX_APPROVAL_MODE=bypass for the legacy dangerous behavior.
 */
function buildHeadlessFlags(): string[] {
  const flags = ["--skip-git-repo-check"];
  const mode = process.env.GATEWAY_CODEX_APPROVAL_MODE || "sandbox";
  if (mode === "bypass") {
    flags.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    // "sandbox" (default): safer — limits filesystem access to workspace
    flags.push("-s", "workspace-write");
  }
  return flags;
}

// ---- spawn helper ------------------------------------------------------------

function spawnCodex(
  positionalArgs: string[],
  prompt: string,
  cwd: string,
  timeoutMs: number,
  parser: CodexEventParser,
  onSpawn?: (child: import("node:child_process").ChildProcess) => void,
  onStreamUpdate?: (update: import("./types.js").StreamUpdate) => void,
  model?: string,
): Promise<SessionOutput> {
  return new Promise<SessionOutput>((resolve) => {
    const codexBin = process.env.CODEX_BIN || "codex";
    const maxIterations = process.env.CODEX_MAX_ITERATIONS || "10";

    // Pre-check binary existence — avoids shell-mode ambiguity on Windows
    // (shell:true spawns cmd.exe which always succeeds, even when the
    //  wrapped binary doesn't exist, causing a misleading timeout error)
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const whichCheck = spawnSync(whichCmd, [codexBin], {
      timeout: 3000, stdio: "ignore", windowsHide: true,
    });
    if (whichCheck.status !== 0) {
      resolve({
        ok: false, text: "", sessionId: "",
        error: `failed to spawn codex: ENOENT — ${codexBin} not found`,
      });
      return;
    }

    // Exec flags (--cd only for new sessions, not resume)
    const execFlags = [
      "-c", `max_iterations=${maxIterations}`,
      ...buildHeadlessFlags(),
    ];
    // #86: model selection — env override takes precedence over opts.model
    const effectiveModel = process.env.CODEX_MODEL || model;
    if (effectiveModel) {
      execFlags.push("-m", effectiveModel);
    }
    const allArgs = [...positionalArgs, ...execFlags];

    const win = process.platform === "win32";
    const cmd = win
      ? `"${codexBin}" ${allArgs.map((a) => {
          if (a.includes(" ") || a.includes(`"`)) {
            return `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
          }
          return a;
        }).join(" ")}`
      : codexBin;
    const spawnArgs = win ? [] : allArgs;

    const child = spawn(cmd, spawnArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: win,
      windowsHide: true,
    });

    // #86: bind StreamUpdate callback to parser
    if (onStreamUpdate) parser.onStreamUpdate = onStreamUpdate;

    child.on("spawn", () => {
      onSpawn?.(child);
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

      // Flush trailing buffer first — may contain turn.completed with metrics
      if (stdoutBuf) parser.feed(stdoutBuf);

      const text = parser.getResultText();

      // #86: emit stream done AFTER all data is flushed
      // (metrics from turn.completed must arrive before done)
      onStreamUpdate?.({ kind: "done", payload: null, providerId: "codex" });
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
  get bin() { return process.env.CODEX_BIN || "codex"; },

  /** Generate a TOML MCP config for Codex (STORY-7). */
  generateMCPConfig(botToken?: string, appToken?: string): string {
    const effectiveBot = botToken || process.env.SLACK_BOT_TOKEN || "";
    const effectiveApp = appToken || process.env.SLACK_APP_TOKEN || "";
    const cacheKey = effectiveBot.slice(0, 8);
    const configPath = resolve(
      process.cwd(), "config", `codex-mcp-${cacheKey}.generated.toml`,
    );
    const senderBin = resolve(process.cwd(), "bin", "chorusgate-mcp.mjs");
    const toml = [
      "# Codex MCP config — auto-generated by ChorusGate",
      `# Generated at: ${new Date().toISOString()}`,
      "",
      "[mcp_servers.slack]",
      'command = "node"',
      `args = ["${senderBin.replace(/\\/g, "\\\\")}"]`,
      "",
      "[mcp_servers.slack.env]",
      `SLACK_BOT_TOKEN = "${effectiveBot}"`,
      `SLACK_APP_TOKEN = "${effectiveApp}"`,
      "",
      'default_tools_approval_mode = "approve"',
      "",
    ].join("\n");
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, toml);
    } catch { /* ignore */ }
    return configPath;
  },

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    let resolvedSessionId = "";
    const args = ["exec", "--json", "--cd", opts.cwd]; // prompt via stdin; --cd sets workspace

    const parser = new CodexEventParser();
    parser.onProgress = opts.onProgress;
    parser.onSessionId = (tid) => {
      resolvedSessionId = tid;
      opts.onSessionId?.(tid);
    };

    const result = await spawnCodex(
      args,
      prompt,
      opts.cwd,
      opts.timeoutMs,
      parser,
      opts.onSpawn,
      opts.onStreamUpdate, // #86: unified streaming
      opts.model,          // #86: model selection
    );
    return { ...result, sessionId: resolvedSessionId };
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const args = ["exec", "--json", "resume", sessionId, "-"]; // `-` tells codex to read prompt from stdin (required for resume)

    const parser = new CodexEventParser();
    parser.onProgress = opts.onProgress;
    // #86 suggestion #9: bind onSessionId so the callback fires on resume too
    parser.onSessionId = opts.onSessionId;

    return spawnCodex(
      args,
      prompt,
      opts.cwd,
      opts.timeoutMs,
      parser,
      opts.onSpawn,
      opts.onStreamUpdate, // #86: unified streaming
      opts.model,          // #86: model selection
    ).then((r) => ({
      ...r,
      sessionId,
    }));
  },
};
