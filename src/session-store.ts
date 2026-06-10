// ============================================================
// Session Store — maps a Slack thread to a persistent Claude session
//
// Each Slack thread (channel + thread_ts) is bound to one Claude session
// UUID. The first turn creates the session (`claude -p --session-id <uuid>`);
// subsequent turns resume it (`claude -p --resume <uuid>`), so the model
// retains the thread's conversation context across messages — instead of
// spawning a fresh, context-less `claude -p` every time.
//
// The mapping itself is in-memory. The actual conversation history lives on
// disk in Claude's own session storage (keyed by the UUID), so even if this
// map is lost on restart, the worst case is a brand-new session for that
// thread — never corruption. (Optional future enhancement: persist the map.)
// ============================================================

import { randomUUID } from "node:crypto";

export interface ThreadSession {
  /** Stable Claude session UUID for this thread. */
  sessionId: string;
  /** Whether the first turn has run (decides --session-id vs --resume). */
  started: boolean;
  /** Epoch ms of last use, for idle eviction. */
  lastUsed: number;
}

class SessionStore {
  private sessions = new Map<string, ThreadSession>();

  /** Build a stable key for a Slack thread. */
  threadKey(channel: string, threadTs: string): string {
    return `${channel}:${threadTs}`;
  }

  /**
   * Get the session for a thread, creating a fresh UUID mapping if absent.
   * Touches lastUsed.
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
    return session;
  }

  /** Mark a thread's session as started (first turn succeeded). */
  markStarted(key: string): void {
    const session = this.sessions.get(key);
    if (session) {
      session.started = true;
      session.lastUsed = Date.now();
    }
  }

  /**
   * Reset a thread's session so the next turn starts fresh (e.g. on a
   * resume failure). Drops the mapping; getOrCreate will mint a new UUID.
   */
  reset(key: string): void {
    this.sessions.delete(key);
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
}

/** Singleton session store. */
export const sessionStore = new SessionStore();
