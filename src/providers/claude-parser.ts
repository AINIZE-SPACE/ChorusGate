// ============================================================
// ClaudeEventParser — 解析 claude -p --output-format stream-json NDJSON
//
// 从 reply-engine.ts 原有逻辑提取，与 ClaudeProvider 配合使用。
// ============================================================

import type { EventParser } from "./types.js";
import { toolLabel } from "./types.js";

export class ClaudeEventParser implements EventParser {
  private resultText = "";
  private assistantText = "";
  onProgress?: (label: string) => void;
  onSessionId?: (sessionId: string) => void;

  feed(line: string): void {
    const t = line.trim();
    if (!t || t[0] !== "{") return;

    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(t);
    } catch {
      return;
    }

    const type = evt.type as string | undefined;

    if (type === "assistant") {
      const msg = evt.message as Record<string, unknown> | undefined;
      const content = (msg?.content as unknown[]) || [];
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_use" && typeof b.name === "string") {
          this.onProgress?.(toolLabel(b.name));
        } else if (b.type === "text" && typeof b.text === "string") {
          this.assistantText += b.text;
        }
      }
    } else if (type === "result") {
      if (typeof evt.result === "string") this.resultText = evt.result;
    }
  }

  getResultText(): string {
    // Prefer result event text; fall back to accumulated assistant text.
    return (this.resultText || this.assistantText).trim();
  }
}
