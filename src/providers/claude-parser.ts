// ============================================================
// ClaudeEventParser — 解析 claude -p --output-format stream-json NDJSON
//
// 从 reply-engine.ts 原有逻辑提取，与 ClaudeProvider 配合使用。
// ============================================================

import type { EventParser } from "./types.js";
import { toolLabel } from "./types.js";

/** Plan entries parsed from Claude's todo tool_use input. */
export interface PlanUpdate {
  entries: Array<{
    id: string;
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
  }>;
}

/** Todo tool names that Claude uses across versions. */
const TODO_TOOL_NAMES = new Set([
  "TodoWrite",      // Claude standard
  "todo",           // shorthand
  "task",           // alternative
  "update_plan",    // Claude Code v2+
]);

function isTodoTool(name: string): boolean {
  const lower = name.toLowerCase();
  return TODO_TOOL_NAMES.has(name) || lower.includes("todo") || lower.includes("task");
}

export class ClaudeEventParser implements EventParser {
  private resultText = "";
  private assistantText = "";
  onProgress?: (label: string) => void;
  onSessionId?: (sessionId: string) => void;
  /** Fired when Claude emits a todo/task tool_use with a plan list. */
  onPlanUpdate?: (plan: PlanUpdate) => void;
  /** Fired when Claude emits any tool_use block (name + input). #86 */
  onToolCall?: (name: string, input: unknown) => void;

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
          this.onToolCall?.(b.name, b.input);
          // Check for todo/task plan data
          this.tryParsePlan(b.name, b.input);
        } else if (b.type === "text" && typeof b.text === "string") {
          this.assistantText += b.text;
        }
      }
    } else if (type === "result") {
      if (typeof evt.result === "string") this.resultText = evt.result;
    }
  }

  getResultText(): string {
    return (this.resultText || this.assistantText).trim();
  }

  /** Check if a tool_use block contains todo/task plan data. */
  private tryParsePlan(name: string, input: unknown): void {
    if (!isTodoTool(name) || !input || typeof input !== "object") return;
    const inp = input as Record<string, unknown>;
    const todos = inp.todos ?? inp.tasks ?? inp.items;
    if (!Array.isArray(todos) || todos.length === 0) return;

    const entries: PlanUpdate["entries"] = [];
    for (const item of todos) {
      if (typeof item !== "object" || item === null) continue;
      const t = item as Record<string, unknown>;
      const content = String(
        t.content ?? t.title ?? t.name ?? t.text ?? ""
      ).trim();
      if (!content) continue;
      const rawStatus = String(t.status ?? "pending").trim().toLowerCase();
      const status = mapPlanStatus(rawStatus);
      const id = String(t.id ?? content.slice(0, 20)).trim();
      entries.push({ id, content, status });
    }

    if (entries.length > 0) {
      this.onPlanUpdate?.({ entries });
    }
  }
}

function mapPlanStatus(raw: string): PlanUpdate["entries"][0]["status"] {
  if (raw === "in_progress" || raw === "doing") return "in_progress";
  if (raw === "completed" || raw === "done" || raw === "finished") return "completed";
  if (raw === "cancelled" || raw === "canceled" || raw === "skipped") return "cancelled";
  return "pending";
}
