# V10 HRS observation slice

## Problem statement

Runtime systems such as Hermes and OpenClaw already generate events and task outcomes, but there is no small, cross-runtime entry point that consistently exposes the path from an event through waking, execution, completion, and attention/delivery. V10 establishes that boundary in ChorusGate and makes a minimal read-only observation surface verifiable locally.

## Scope and non-goals

This slice implements an in-process deterministic adapter, an HTTP health/API surface, and a static observation page. It is not a personnel/organization system, performance product, enterprise Control Plane, IAM system, knowledge store, scheduler, generic cloud platform, Slack login flow, or production frontend. It neither reads nor migrates Soul, gbrain, `agents_memory`, mem0, `zederer_ip`, or `summit-saw`.

Existing `src/gateway.ts` and `src/index.ts` remain independent Slack/MCP entry points.

## Data model

`RuntimeEmployee` is a narrow runtime-observation record:

- identity: `id`, display `name`, and `runtime` (`hermes`, `openclaw`, etc.);
- live summary: `status`, optional current task id/title/status, and recent event id/type/summary/timestamp;
- outcome counters: succeeded, failed, and blocked completions.

`HrsObservationAdapter.listEmployees()` owns data acquisition. `DeterministicFixtureAdapter` is the current implementation and returns two constant records. `buildEmployeeViews()` is the projection boundary used by both the Web API and page, so a later adapter cannot bypass the API shape.

## Interface boundary for a real HRS adapter

The next adapter may consume a validated HRS event/task/completion feed and implement `HrsObservationAdapter`. It must map its own runtime data to `RuntimeEmployee`; connection credentials, Slack delivery, scheduler logic, and runtime-internal Soul/memory remain outside this Web surface. The HRS contract's execution boundary remains:

```text
Event -> WakePolicy -> TaskEnvelope -> HarnessAdapter -> Completion -> Attention/Delivery
```

The Web server is read-only and does not invoke `HarnessAdapter.execute()`. Production integration requires a separate adapter decision, input validation, and tests; fixture data must remain available for hermetic test coverage.

## Acceptance criteria

- `npm run v10:web` starts a local-only server without Slack credentials.
- `/health` reports `ok` and the deterministic source.
- `/api/v10/employees` returns at least two records with differing statuses, task/event summaries, and completion counters.
- `/` visibly labels its fixture data and renders the same observations.
- unknown paths return `404`; tests cover this plus the API and conversion.
- existing gateway/MCP imports and commands are not modified by this slice.
