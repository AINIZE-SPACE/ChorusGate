// ============================================================
// Session Store — maps a Slack scope to a persistent Claude session
//
// Each Slack scope (channel or thread) is bound to one Claude session
// UUID. The first turn creates the session (`claude -p --session-id <uuid>`);
// subsequent turns resume it (`claude -p --resume <uuid>`), so the model
// retains conversation context across messages.
//
// Persistence is a human-readable MARKDOWN TABLE at `memory/sessions.md`
// (git-tracked), NOT a database. This file holds ONLY routing metadata —
// the Slack scope → session UUID mapping. The actual conversation/memory
// lives in the Claude agent's own session storage (keyed by the UUID) and
// its memory md files; the gateway is a stateless meta router and never
// stores conversation content here.
//
// Cross-machine note: session UUIDs are local to the machine where Claude
// persisted them. If this map syncs to another machine via git, a `--resume`
// there won't find the UUID and gracefully starts a fresh session. That's
// fine — the map's value is versioning/audit/restart-durability on the host.
// ============================================================

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const MEMORY_DIR = resolve(projectRoot, "memory");
const SESSIONS_MD = resolve(MEMORY_DIR, "sessions.md");

const MD_HEADER = `# Slack Scope → Claude Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Claude session UUID。
gateway 用 \`claude -p --resume <uuid>\` 续接，使同一 scope 跨消息保留上下文。
本文件只存路由 meta —— 真正的对话/记忆在 Claude agent 自己的 session
存储和它的 memory md 里，不在这里。由 gateway 自动维护；可由 git 追踪。

| Scope Key | Session UUID | Started | Last Used |
|------------|--------------|---------|-----------|
`;

export interface ThreadSession {
  /** Stable Claude session UUID for this scope. */
  sessionId: string;
  /** Whether the first turn has run (decides --session-id vs --resume). */
  started: boolean;
  /** Epoch ms of last use, for idle eviction. */
  lastUsed: number;
}

export interface SessionStoreOptions {
  sessionsFile?: string;
  persistDebounceMs?: number;
}

export class SessionStore {
  private sessions = new Map<string, ThreadSession>();
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly sessionsFile: string;
  private readonly memoryDir: string;
  private readonly persistDebounceMs: number;

  constructor(options: SessionStoreOptions = {}) {
    this.sessionsFile = options.sessionsFile ?? SESSIONS_MD;
    this.memoryDir = dirname(this.sessionsFile);
    this.persistDebounceMs = options.persistDebounceMs ?? 1000;
    this.load();
  }

  /** Build a stable key for a Slack thread. */
  threadKey(channel: string, threadTs: string): string {
    return `${channel}:${threadTs}`;
  }

  /** Build a scope key for channel-level sessions (one session per channel/DM). */
  channelKey(channel: string): string {
    return `channel:${channel}`;
  }

  /**
   * Get the session for a scope, creating a fresh UUID mapping if absent.
   * Touches lastUsed and schedules a persist.
   */
  getOrCreate(key: string): ThreadSession {
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        sessionId: randomUUID(),
        started: false,
        lastUsed: Date.now(),
      };
      this.sessions.set(key, session);
    } else {
      session.lastUsed = Date.now();
    }
    this.schedulePersist();
    return session;
  }

  /** Mark a scope's session as started (first turn succeeded). */
  markStarted(key: string): void {
    const session = this.sessions.get(key);
    if (session) {
      session.started = true;
      session.lastUsed = Date.now();
      this.schedulePersist();
    }
  }

  /**
   * Reset a scope's session so the next turn starts fresh (e.g. on a
   * resume failure). Drops the mapping; getOrCreate will mint a new UUID.
   */
  reset(key: string): void {
    if (this.sessions.delete(key)) {
      this.schedulePersist();
    }
  }

  /**
   * Explicitly bind a scope to an existing Claude session UUID (e.g. via the
   * `/resume N` command). Marks it started so the next turn uses `--resume`.
   * Caller is responsible for verifying the sessionId exists on disk.
   */
  setSession(key: string, sessionId: string): void {
    this.sessions.set(key, {
      sessionId,
      started: true,
      lastUsed: Date.now(),
    });
    this.schedulePersist();
  }

  /** Evict mappings idle longer than maxAgeMs. Returns count removed. */
  evictIdle(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (session.lastUsed < cutoff) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) this.schedulePersist();
    return removed;
  }

  /** Number of tracked thread sessions. */
  size(): number {
    return this.sessions.size;
  }

  /** Snapshot of all tracked thread sessions (for status/list). */
  entries(): Array<{
    key: string;
    sessionId: string;
    started: boolean;
    lastUsed: number;
  }> {
    return Array.from(this.sessions.entries()).map(([key, s]) => ({
      key,
      sessionId: s.sessionId,
      started: s.started,
      lastUsed: s.lastUsed,
    }));
  }

  // ---- persistence (markdown) ---------------------------------------------

  /** Load the mapping from memory/sessions.md (best effort). */
  load(): void {
    let text: string;
    try {
      text = readFileSync(this.sessionsFile, "utf8");
    } catch {
      return; // no file yet — start empty
    }
    try {
      for (const line of text.split("\n")) {
        const t = line.trim();
        // Table data rows start with "|" and aren't the header/separator.
        if (!t.startsWith("|")) continue;
        if (t.includes("Thread Key") || t.includes("Scope Key") || t.includes("---")) continue;
        const cells = t
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (cells.length < 4) continue;
        const [key, sessionId, startedRaw, lastUsedRaw] = cells;
        if (!key || !sessionId) continue;
        const lastUsedMs = Date.parse(lastUsedRaw);
        this.sessions.set(key, {
          sessionId,
          started: startedRaw.toLowerCase() === "yes",
          lastUsed: Number.isNaN(lastUsedMs) ? Date.now() : lastUsedMs,
        });
      }
    } catch (err) {
      console.error(
        "[session-store] WARNING: failed to parse memory/sessions.md, " +
          "starting with empty map:",
        (err as Error).message
      );
      this.sessions.clear();
    }
  }

  /** Debounced persist — coalesces bursts of mutations into one write. */
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, this.persistDebounceMs);
    this.persistTimer.unref?.();
  }

  /** Render the in-memory map to memory/sessions.md as a markdown table. */
  persist(): void {
    try {
      mkdirSync(this.memoryDir, { recursive: true });
      const rows = Array.from(this.sessions.entries())
        .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
        .map(([key, s]) => {
          const started = s.started ? "yes" : "no";
          const lastUsed = new Date(s.lastUsed).toISOString();
          return `| ${key} | ${s.sessionId} | ${started} | ${lastUsed} |`;
        });
      writeFileSync(this.sessionsFile, MD_HEADER + rows.join("\n") + "\n");
    } catch (err) {
      console.error(
        "[session-store] WARNING: failed to write memory/sessions.md:",
        (err as Error).message
      );
    }
  }
}

/** Singleton session store. */
export const sessionStore = new SessionStore();
