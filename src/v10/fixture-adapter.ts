import type { HrsObservationAdapter, RuntimeEmployee } from "./types.js";

/** Isolated demo input. No Slack, Soul, gbrain, or production runtime is read. */
const EMPLOYEES: readonly RuntimeEmployee[] = [
  {
    id: "emp-hermes-01",
    name: "Hermes Coordinator",
    runtime: "hermes",
    status: "working",
    currentTask: { id: "env-demo-01", title: "Route CI failure completion", status: "running" },
    recentEvent: {
      id: "evt-demo-01",
      type: "ci.failed",
      summary: "payment-api verification needs an adapter wake decision",
      occurredAt: "2026-09-24T08:30:00.000Z",
    },
    completions: { succeeded: 12, failed: 1, blocked: 0 },
  },
  {
    id: "emp-openclaw-02",
    name: "OpenClaw Operator",
    runtime: "openclaw",
    status: "blocked",
    currentTask: { id: "env-demo-02", title: "Publish daily event digest", status: "blocked" },
    recentEvent: {
      id: "evt-demo-02",
      type: "approval.pending",
      summary: "Delivery remains blocked until the fixture approval arrives",
      occurredAt: "2026-09-24T08:15:00.000Z",
    },
    completions: { succeeded: 7, failed: 0, blocked: 2 },
  },
];

export class DeterministicFixtureAdapter implements HrsObservationAdapter {
  listEmployees(): readonly RuntimeEmployee[] {
    return EMPLOYEES;
  }
}
