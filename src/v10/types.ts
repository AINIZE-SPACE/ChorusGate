/**
 * Read-only shapes used by the V10 HRS observation slice. They intentionally
 * mirror only the runtime boundary; they are not a personnel or IAM model.
 */
export type RuntimeKind = "hermes" | "openclaw" | "codex" | "claude-code";
export type EmployeeStatus = "active" | "working" | "blocked" | "offline";
export type TaskStatus = "queued" | "running" | "waiting" | "blocked" | "succeeded" | "failed";

export interface RuntimeEmployee {
  id: string;
  name: string;
  runtime: RuntimeKind;
  status: EmployeeStatus;
  currentTask?: { id: string; title: string; status: TaskStatus };
  recentEvent: { id: string; type: string; summary: string; occurredAt: string };
  completions: { succeeded: number; failed: number; blocked: number };
}

export interface EmployeeView extends RuntimeEmployee {
  source: "deterministic-fixture";
}

export interface HrsObservationAdapter {
  listEmployees(): readonly RuntimeEmployee[];
}
