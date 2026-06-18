// ============================================================
// CodexEventParser — 解析 codex exec --json JSONL
//
// 基于 M0 实测 fixture（Codex CLI v0.139.0）:
//   tests/fixtures/codex-hello.jsonl
//   tests/fixtures/codex-resume.jsonl
//
// JSONL 格式:
//   {"type":"thread.started","thread_id":"019ebaf3-..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello!"}}
//   {"type":"turn.completed","usage":{...}}
//
// 跟踪: [#23](https://github.com/AINIZE-SPACE/chorusgate/issues/23)
//       [#86](https://github.com/AINIZE-SPACE/chorusgate/issues/86) — StreamUpdate
// ============================================================

import type { EventParser, StreamUpdate } from "./types.js";
import { toolLabel } from "./types.js";

/** Codex usage metrics from turn.completed. */
export interface CodexMetrics {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
}

/** Real-time text fragment callback for gateway streaming (#86). */
export type CodexTextCallback = (text: string) => void;

export class CodexEventParser implements EventParser {
  private resultText = "";
  onProgress?: (label: string) => void;
  onSessionId?: (sessionId: string) => void;
  /** Real-time text push on each agent_message (#86). */
  onText?: CodexTextCallback;
  /** Metrics callback on turn.completed (#86). */
  onMetrics?: (metrics: CodexMetrics) => void;
  /** M3 unified StreamUpdate callback — Codex coarse-grained (#86). */
  onStreamUpdate?: (update: StreamUpdate) => void;

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

    switch (type) {
      case "thread.started": {
        const tid =
          (evt.thread_id as string) ||
          ((evt.thread as Record<string, unknown> | undefined)
            ?.id as string);
        if (tid) {
          this.onSessionId?.(tid);
          this.onStreamUpdate?.({ kind: "session_id", payload: tid, providerId: "codex" });
        }
        break;
      }

      case "turn.started":
        this.onProgress?.("🤔 Codex 思考中…");
        this.onStreamUpdate?.({ kind: "progress", payload: "🤔 Codex 思考中…", providerId: "codex" });
        break;

      case "item.completed": {
        const item = evt.item as Record<string, unknown> | undefined;
        if (!item) break;

        if (item.type === "agent_message" && typeof item.text === "string") {
          const text = item.text as string;
          this.resultText += text;
          this.onText?.(text); // #86: push to gateway for real-time Slack update
          this.onStreamUpdate?.({ kind: "text", payload: text, providerId: "codex" });
        }

        if (
          (item.type as string) === "tool_use" &&
          typeof item.name === "string"
        ) {
          const label = toolLabel(item.name as string);
          this.onProgress?.(label);
          this.onStreamUpdate?.({ kind: "tool_call", payload: { name: item.name, label }, providerId: "codex" });
        }

        const content = item.content as unknown[] | undefined;
        if (content) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === "output_text" && typeof b.text === "string") {
              this.resultText += b.text as string;
            }
            if (b.type === "tool_use" && typeof b.name === "string") {
              const label = toolLabel(b.name as string);
              this.onProgress?.(label);
              this.onStreamUpdate?.({ kind: "tool_call", payload: { name: b.name, label }, providerId: "codex" });
            }
          }
        }
        break;
      }

      case "turn.completed": {
        const usage = evt.usage as Record<string, unknown> | undefined;
        if (usage) {
          const metrics: CodexMetrics = {
            inputTokens: (usage.input_tokens as number) || 0,
            outputTokens: (usage.output_tokens as number) || 0,
            cachedInputTokens: (usage.cached_input_tokens as number) || 0,
            reasoningOutputTokens: (usage.reasoning_output_tokens as number) || 0,
          };
          this.onMetrics?.(metrics);
          this.onStreamUpdate?.({ kind: "metrics", payload: metrics, providerId: "codex" });
        }
        break;
      }
    }
  }

  getResultText(): string {
    return this.resultText.trim();
  }
}
