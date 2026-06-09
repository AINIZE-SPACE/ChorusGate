// ============================================================
// Event Store — Ring-buffer in-memory event queue
// ============================================================

import type { StoredEvent, SlackEventType } from "./types.js";

const MAX_EVENTS = 500;

// Generate simple unique IDs
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `evt_${Date.now()}_${idCounter}`;
}

class EventStore {
  private events: StoredEvent[] = [];

  /** Push a new event into the store */
  push(event: Omit<StoredEvent, "id" | "handled" | "received_at">): StoredEvent {
    const stored: StoredEvent = {
      ...event,
      id: nextId(),
      handled: false,
      received_at: Date.now(),
    };

    this.events.push(stored);

    // Trim to max capacity (ring-buffer behavior: drop oldest)
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    return stored;
  }

  /** Get pending (unhandled) events, newest first */
  getPending(limit = 20, type?: SlackEventType, channel?: string): StoredEvent[] {
    let filtered = this.events.filter((e) => !e.handled);

    if (type) {
      filtered = filtered.filter((e) => e.type === type);
    }
    if (channel) {
      filtered = filtered.filter((e) => e.channel === channel);
    }

    return filtered.slice(-limit).reverse();
  }

  /** Get recent events, newest first */
  getRecent(limit = 20, type?: SlackEventType, channel?: string): StoredEvent[] {
    let filtered = [...this.events];

    if (type) {
      filtered = filtered.filter((e) => e.type === type);
    }
    if (channel) {
      filtered = filtered.filter((e) => e.channel === channel);
    }

    return filtered.slice(-limit).reverse();
  }

  /** Mark an event as handled */
  markHandled(id: string): boolean {
    const evt = this.events.find((e) => e.id === id);
    if (evt) {
      evt.handled = true;
      return true;
    }
    return false;
  }

  /** Get a single event by ID */
  getById(id: string): StoredEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  /** Count pending events */
  countPending(): number {
    return this.events.filter((e) => !e.handled).length;
  }

  /** Total stored events */
  countTotal(): number {
    return this.events.length;
  }

  /** Clear all events */
  clear(): void {
    this.events = [];
    idCounter = 0;
  }
}

/** Singleton event store instance */
export const eventStore = new EventStore();
