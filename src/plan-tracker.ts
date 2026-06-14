// ============================================================
// PlanTracker — detect Claude todo tool results, render as
//              a live-updating plan status message in Slack
//
// When Claude emits a todo/task tool result containing a task
// list, the gateway parses it and posts/edits a plan status
// message in the Slack thread.  Users see real-time progress:
//
//   📋 *任务进度*
//   ✅ 分析代码结构
//   🔄 实现核心逻辑
//   ⏳ 编写测试
//   ⏳ 更新文档
//
// Inspired by Hermes' _build_plan_update_from_todo_result().
//
// 跟踪: [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32)
// ============================================================

/** A single task entry in the plan. */
export interface PlanEntry {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

/** In-memory state for one session's plan. */
interface PlanState {
  entries: PlanEntry[];
  /** Slack message ts of the plan status message (for editing). */
  planMessageTs?: string;
  /** Last rendered text — skip redundant edits. */
  lastRendered: string;
}

// ---- PlanTracker -------------------------------------------------------------

export class PlanTracker {
  /** Per-session plan state keyed by `${channel}:${threadTs}`. */
  private plans = new Map<string, PlanState>();

  /**
   * Try to parse a todo tool result into plan entries.
   * Returns entries if successful, null if the result isn't a todo list.
   */
  parseTodoResult(resultText: string): PlanEntry[] | null {
    if (!resultText || !resultText.trim()) return null;

    // Try to parse JSON from the result.
    let data: unknown;
    try {
      data = JSON.parse(resultText);
    } catch {
      // Maybe there's a JSON block embedded in markdown
      const match = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (!match) return null;
      try {
        data = JSON.parse(match[1]);
      } catch {
        return null;
      }
    }

    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;

    // Check for Claude's todo format: { "todos": [...] }
    const todos = obj.todos ?? obj.tasks ?? obj.items;
    if (!Array.isArray(todos) || todos.length === 0) return null;

    const entries: PlanEntry[] = [];
    for (const item of todos) {
      if (typeof item !== "object" || item === null) continue;
      const t = item as Record<string, unknown>;
      const content = String(
        t.content ?? t.title ?? t.name ?? t.id ?? t.text ?? ""
      ).trim();
      if (!content) continue;
      const rawStatus = String(t.status ?? "pending").trim().toLowerCase();
      const status = this.mapStatus(rawStatus);
      const id = String(t.id ?? content.slice(0, 20)).trim();
      entries.push({ id, content, status });
    }

    return entries.length > 0 ? entries : null;
  }

  /**
   * Update the plan for a session and return the Slack-formatted text.
   * Returns null if nothing changed.
   */
  updatePlan(
    sessionKey: string,
    entries: PlanEntry[],
  ): { text: string; changed: boolean } | null {
    let state = this.plans.get(sessionKey);
    if (!state) {
      state = { entries: [], lastRendered: "" };
      this.plans.set(sessionKey, state);
    }

    // Merge: update existing entries, add new ones
    const existing = new Map(state.entries.map((e) => [e.id, e]));
    for (const entry of entries) {
      existing.set(entry.id, entry);
    }
    state.entries = Array.from(existing.values());

    const text = this.renderText(state.entries);
    const changed = text !== state.lastRendered;
    state.lastRendered = text;
    return { text, changed };
  }

  /** Get or set the Slack message ts for the plan status message. */
  getPlanMessageTs(sessionKey: string): string | undefined {
    return this.plans.get(sessionKey)?.planMessageTs;
  }

  setPlanMessageTs(sessionKey: string, ts: string): void {
    let state = this.plans.get(sessionKey);
    if (!state) {
      state = { entries: [], lastRendered: "" };
      this.plans.set(sessionKey, state);
    }
    state.planMessageTs = ts;
  }

  /** Clear plan state for a session. */
  clear(sessionKey: string): void {
    this.plans.delete(sessionKey);
  }

  // ---- private helpers -------------------------------------------------------

  private mapStatus(raw: string): PlanEntry["status"] {
    if (raw === "in_progress" || raw === "doing") return "in_progress";
    if (raw === "completed" || raw === "done" || raw === "finished") return "completed";
    if (raw === "cancelled" || raw === "canceled" || raw === "skipped") return "cancelled";
    return "pending";
  }

  private renderText(entries: PlanEntry[]): string {
    if (entries.length === 0) return "";

    const lines = ["📋 *任务进度*"];
    for (const e of entries) {
      const icon = this.statusIcon(e.status);
      const style = e.status === "completed" || e.status === "cancelled"
        ? `~${e.content}~`
        : e.status === "in_progress"
          ? `*${e.content}*`
          : e.content;
      lines.push(`${icon} ${style}`);
    }

    // Summary line
    const total = entries.length;
    const completed = entries.filter((e) =>
      e.status === "completed" || e.status === "cancelled").length;
    const inProgress = entries.filter((e) => e.status === "in_progress").length;
    let summary = `_${completed}/${total} 完成`;
    if (inProgress > 0) summary += `，${inProgress} 进行中`;
    summary += "_";
    lines.push(summary);

    return lines.join("\n");
  }

  private statusIcon(status: PlanEntry["status"]): string {
    switch (status) {
      case "completed": return "✅";
      case "in_progress": return "🔄";
      case "cancelled": return "❌";
      default: return "⏳";
    }
  }
}
