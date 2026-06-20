// ============================================================
// Durable Event Store — markdown-backed persistence + retry
//
// Persists Slack event processing state to memory/events.md as a
// markdown table (git-tracked, human-readable). Survives gateway
// restarts — pending/stale events are replayed on startup.
//
// State machine: pending → processing → replied | failed
//
// Idempotency key: Slack event.ts (unique per event)
//
// Issue: [#1](https://github.com/AINIZE-SPACE/chorusgate/issues/1)
// ============================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const MEMORY_DIR = resolve(projectRoot, "memory");
const EVENTS_MD = resolve(MEMORY_DIR, "events.md");

// ---- Types ------------------------------------------------------------------

export type EventState = "pending" | "processing" | "replied" | "failed";

export interface DurableEvent {
  /** Slack event timestamp — idempotency key */
  ts: string;
  channel: string;
  user?: string;
  user_name?: string;
  type: string;
  text_snippet: string;
  state: EventState;
  received_at: number;
  updated_at: number;
  retries: number;
  error?: string;
}

// ---- Markdown table format --------------------------------------------------

const HEADER = "| ts | channel | user | type | state | received_at | updated_at | retries | error | text_snippet |";
const SEPARATOR = "|---|---|---|---|---|---|---|---|---|---|";

function escapeMd(v: string | undefined | null): string {
  if (!v) return "";
  // Escape pipe, newline, and backtick for markdown table cells
  return v.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/`/g, "'");
}

function serializeRow(e: DurableEvent): string {
  return `| ${e.ts} | ${e.channel} | ${escapeMd(e.user) || "-"} | ${e.type} | ${e.state} | ${e.received_at} | ${e.updated_at} | ${e.retries} | ${escapeMd(e.error) || "-"} | ${escapeMd(e.text_snippet.slice(0, 80))} |`;
}

function parseRow(line: string): DurableEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const cells = trimmed.slice(1, -1).split("|");
  if (cells.length < 10) return null;

  const ts = cells[0].trim();
  // Skip header/separator
  if (ts === "ts" || ts.startsWith("-")) return null;

  return {
    ts,
    channel: cells[1].trim(),
    user: cells[2].trim() !== "-" ? cells[2].trim() : undefined,
    type: cells[3].trim(),
    state: cells[4].trim() as EventState,
    received_at: parseInt(cells[5].trim(), 10) || 0,
    updated_at: parseInt(cells[6].trim(), 10) || 0,
    retries: parseInt(cells[7].trim(), 10) || 0,
    error: cells[8].trim() !== "-" ? cells[8].trim() : undefined,
    text_snippet: cells.slice(9).join("|").trim(),
  };
}

// ============================================================================

export class DurableEventStore {
  private events = new Map<string, DurableEvent>();
  private dirty = false;

  constructor() {
    this.load();
  }

  // ---- persistence ---------------------------------------------------------

  private load(): void {
    if (!existsSync(EVENTS_MD)) return;

    try {
      const lines = readFileSync(EVENTS_MD, "utf-8").split("\n");
      for (const line of lines) {
        const evt = parseRow(line);
        if (evt) this.events.set(evt.ts, evt);
      }
    } catch (err) {
      console.error(
        "[durable-event-store] failed to load events.md:",
        (err as Error).message,
      );
    }
  }

  private save(): void {
    const rows: string[] = [HEADER, SEPARATOR];
    for (const e of this.events.values()) {
      rows.push(serializeRow(e));
    }
    try {
      const { mkdirSync } = require("node:fs");
      mkdirSync(MEMORY_DIR, { recursive: true });
      writeFileSync(EVENTS_MD, rows.join("\n") + "\n");
      this.dirty = false;
    } catch (err) {
      console.error(
        "[durable-event-store] failed to write events.md:",
        (err as Error).message,
      );
    }
  }

  private markDirty(): void {
    if (!this.dirty) {
      this.dirty = true;
      // Debounced save — write on next tick to batch rapid updates
      setImmediate(() => {
        if (this.dirty) this.save();
      });
    }
  }

  // ---- state machine --------------------------------------------------------

  /** Check if an event.ts has already been processed (dedup). */
  isDedup(ts: string): boolean {
    const e = this.events.get(ts);
    if (!e) return false;
    return e.state === "replied" || e.state === "processing";
  }

  /** Record a new Slack event as pending. */
  markPending(evt: {
    ts: string;
    channel: string;
    user?: string;
    user_name?: string;
    type: string;
    text?: string;
  }): void {
    const existing = this.events.get(evt.ts);
    if (existing) {
      // If it was failed or processing (stale), reset to pending for retry
      if (existing.state === "failed" || existing.state === "processing") {
        existing.state = "pending";
        existing.updated_at = Date.now();
        existing.retries = (existing.retries || 0) + 1;
        this.markDirty();
      }
      // If already replied, ignore (dedup)
      return;
    }

    this.events.set(evt.ts, {
      ts: evt.ts,
      channel: evt.channel,
      user: evt.user,
      user_name: evt.user_name,
      type: evt.type,
      text_snippet: (evt.text || "").slice(0, 80),
      state: "pending",
      received_at: Date.now(),
      updated_at: Date.now(),
      retries: 0,
    });
    this.markDirty();
  }

  /** Mark an event as being actively processed. */
  markProcessing(ts: string): void {
    const e = this.events.get(ts);
    if (!e) return;
    e.state = "processing";
    e.updated_at = Date.now();
    this.markDirty();
  }

  /** Mark an event as successfully replied. */
  markReplied(ts: string): void {
    const e = this.events.get(ts);
    if (!e) return;
    e.state = "replied";
    e.updated_at = Date.now();
    this.markDirty();
  }

  /** Mark an event as failed with error. */
  markFailed(ts: string, error: string): void {
    const e = this.events.get(ts);
    if (!e) return;
    e.state = "failed";
    e.error = error.slice(0, 200);
    e.updated_at = Date.now();
    this.markDirty();
  }

  // ---- query ----------------------------------------------------------------

  /**
   * Get events that need replay on startup:
   * - pending: never attempted
   * - processing: stale (likely crashed mid-flight), replay after 5 min
   */
  getReplayable(): DurableEvent[] {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 min

    return [...this.events.values()]
      .filter((e) => {
        if (e.state === "pending") return true;
        if (e.state === "processing" && (now - e.updated_at) > staleThreshold)
          return true;
        return false;
      })
      .sort((a, b) => a.received_at - b.received_at); // oldest first
  }

  /** Get failed events for status display. */
  getFailed(): DurableEvent[] {
    return [...this.events.values()]
      .filter((e) => e.state === "failed")
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  /** Get by timestamp. */
  getByTs(ts: string): DurableEvent | undefined {
    return this.events.get(ts);
  }

  /** Total tracked events. */
  size(): number {
    return this.events.size;
  }

  /** Count by state. */
  countByState(): Record<EventState, number> {
    const counts: Record<EventState, number> = {
      pending: 0,
      processing: 0,
      replied: 0,
      failed: 0,
    };
    for (const e of this.events.values()) {
      counts[e.state]++;
    }
    return counts;
  }

  /** Evict old replied entries to bound file size (keep last N). */
  evictReplied(keepLast: number = 200): number {
    const replied = [...this.events.values()]
      .filter((e) => e.state === "replied")
      .sort((a, b) => b.updated_at - a.updated_at);

    let removed = 0;
    if (replied.length > keepLast) {
      for (const e of replied.slice(keepLast)) {
        this.events.delete(e.ts);
        removed++;
      }
      this.markDirty();
    }
    return removed;
  }
}

/** Singleton instance */
export const durableEventStore = new DurableEventStore();
