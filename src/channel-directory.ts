// ============================================================
// Channel Directory — Slack channel/thread discovery + persistence
//
// Maintains a lightweight JSON index of reachable Slack channels
// and active threads, used by the gateway for session routing,
// context injection, and channel name resolution.
//
// Persisted to memory/channel-directory.json.
//
// 跟踪: [#132](https://github.com/AINIZE-SPACE/ChorusGate/issues/132)
// ============================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const MEMORY_DIR = resolve(projectRoot, "memory");
const CHANNEL_DIR_JSON = resolve(MEMORY_DIR, "channel-directory.json");

// ---- Types -----------------------------------------------------------------

export interface ChannelEntry {
  /** Slack channel ID, or "CHANNEL:thread_ts" for thread entries */
  id: string;
  /** Human-readable name, e.g. "#chorusgate_v4" or "chorusgate_v4 / topic" */
  name: string;
  /** Channel type */
  type: "channel" | "group" | "dm";
  /** thread_ts (only for "group" entries representing a thread) */
  threadId?: string;
  /** Parent channel ID (only for thread entries) */
  parentChannelId?: string;
}

export interface ChannelDirectory {
  updatedAt: string; // ISO timestamp
  profiles: Record<string, {
    botUserId: string;
    channels: ChannelEntry[];
  }>;
}

// ---- Core ------------------------------------------------------------------

export class ChannelDirectoryManager {
  private data: ChannelDirectory = { updatedAt: "", profiles: {} };
  private readonly filePath: string;
  private readonly memoryDir: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? CHANNEL_DIR_JSON;
    this.memoryDir = dirname(this.filePath);
    this.load();
  }

  // ---- persistence ----------------------------------------------------------

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.data = JSON.parse(raw);
    } catch {
      this.data = { updatedAt: new Date().toISOString(), profiles: {} };
    }
  }

  private save(): void {
    try {
      mkdirSync(this.memoryDir, { recursive: true });
      this.data.updatedAt = new Date().toISOString();
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n");
    } catch (err) {
      console.error(
        "[channel-directory] WARNING: failed to write:",
        (err as Error).message,
      );
    }
  }

  // ---- profile management ---------------------------------------------------

  /** Ensure a profile entry exists. */
  ensureProfile(profileId: string, botUserId: string): void {
    if (!this.data.profiles[profileId]) {
      this.data.profiles[profileId] = { botUserId, channels: [] };
    } else if (!this.data.profiles[profileId].botUserId) {
      this.data.profiles[profileId].botUserId = botUserId;
    }
  }

  // ---- channel operations ---------------------------------------------------

  /** Add or update a channel entry. */
  upsertChannel(
    profileId: string,
    entry: ChannelEntry,
  ): void {
    const ch = this.data.profiles[profileId]?.channels ?? [];
    const idx = ch.findIndex((c) => c.id === entry.id);
    if (idx >= 0) {
      ch[idx] = entry;
    } else {
      ch.push(entry);
    }
    if (!this.data.profiles[profileId]) {
      this.data.profiles[profileId] = { botUserId: "", channels: ch };
    }
    this.save();
  }

  /** Remove a channel entry by id. */
  removeChannel(profileId: string, channelId: string): void {
    const ch = this.data.profiles[profileId]?.channels;
    if (!ch) return;
    const idx = ch.findIndex((c) => c.id === channelId);
    if (idx < 0) return;
    ch.splice(idx, 1);
    this.save();
  }

  /** Get channels for a profile. */
  getChannels(profileId: string): ChannelEntry[] {
    return this.data.profiles[profileId]?.channels ?? [];
  }

  /** Resolve a channel name by id. Returns undefined if not found. */
  resolveChannelName(profileId: string, channelId: string): string | undefined {
    return this.data.profiles[profileId]?.channels
      .find((c) => c.id === channelId)?.name;
  }

  /** Resolve channel type by id. */
  lookupChannelType(profileId: string, channelId: string): string | undefined {
    return this.data.profiles[profileId]?.channels
      .find((c) => c.id === channelId)?.type;
  }

  /**
   * Build or refresh the channel list from Slack API conversations.list.
   * Call this on startup and periodically (every 5 min).
   */
  async refreshFromSlack(
    profileId: string,
    botUserId: string,
    channels: Array<{ id: string; name: string; is_channel: boolean; is_im: boolean; is_group: boolean }>,
  ): Promise<void> {
    this.ensureProfile(profileId, botUserId);
    const existing = new Map(
      this.data.profiles[profileId].channels.map((c) => [c.id, c]),
    );

    for (const ch of channels) {
      const type = ch.is_im ? "dm" : ch.is_group ? "group" : "channel";
      const name = ch.is_im ? ch.id : `#${ch.name}`;
      existing.set(ch.id, {
        id: ch.id,
        name,
        type: type as ChannelEntry["type"],
      });
    }

    this.data.profiles[profileId].channels = Array.from(existing.values());
    this.save();
  }

  /** Register a thread entry derived from a parent channel. */
  registerThread(
    profileId: string,
    channelId: string,
    threadTs: string,
    channelName: string,
  ): void {
    const entryId = `${channelId}:${threadTs}`;
    const existing = this.data.profiles[profileId]?.channels
      .find((c) => c.id === entryId);
    if (existing) return; // already registered

    this.upsertChannel(profileId, {
      id: entryId,
      name: `${channelName} / thread ${threadTs.slice(0, 10)}`,
      type: "group",
      threadId: threadTs,
      parentChannelId: channelId,
    });
  }

  /** Snapshot the full directory (for debug / status commands). */
  snapshot(): ChannelDirectory {
    return JSON.parse(JSON.stringify(this.data));
  }
}

/** Singleton channel directory manager. */
export const channelDirectory = new ChannelDirectoryManager();
