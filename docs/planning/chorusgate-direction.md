# ChorusGate project direction

## Problem

Digital employees run through different Agent Runtimes, including Hermes, OpenClaw, Codex, and Claude. In real collaboration each runtime has its own way to receive events, wake work, execute tasks, report completion, notify people, and expose operational state. The result is a gap at the collaboration boundary: cross-runtime work has no shared contract, no dependable state loop, no evidence receipt, and no local place to observe or control the boundary.

ChorusGate addresses that boundary. It is not a replacement for a runtime's reasoning, memory, scheduler, or internal tool harness.

## Product boundary

ChorusGate is the local runtime-coordination entry point for organizational intelligence and collaboration among digital employees. It connects people and runtimes through Channels and Gateway, and uses HRS contracts to make this path explicit and verifiable:

```text
Event -> WakePolicy -> TaskEnvelope -> HarnessAdapter -> Completion -> Attention / Delivery
```

The product is local-first. It provides a verifiable local observation surface and a controlled boundary for delivery and attention. Runtime-specific execution remains owned by the corresponding runtime and its adapter.

The current product is **not** an organization-management system, HR or performance product, knowledge base, IAM layer, generic cloud platform, or a generalized “silicon organization Control Plane.” Those areas are not implementation goals unless a demonstrated operating loop later requires a narrowly scoped capability.

## Core objects and relationships

| Object | Responsibility | Relationship |
| --- | --- | --- |
| Channel | Human-facing collaboration context, such as Slack or a future channel connector | Delivers human attention and provides the entry point for events. |
| Gateway | Local coordinator at the channel/runtime boundary | Receives and routes events, applies policy, and exposes bounded operational control. |
| Runtime | A digital-employee execution environment, such as Hermes, OpenClaw, Codex, or Claude | Owns its internal execution, tools, and lifecycle. |
| HRS contract | Portable coordination contract | Carries Event, WakePolicy, TaskEnvelope, HarnessAdapter, Completion, and Attention/Delivery semantics across runtimes. |
| Web observation | Local, read-only observation surface | Makes contract-derived runtime state, outcomes, and evidence visible without becoming a runtime controller. |

In short: people collaborate through a Channel; Gateway translates that interaction into an HRS-governed handoff; a Runtime performs its own work through an adapter; Completion records the outcome and evidence; Attention/Delivery returns the result to the appropriate human or channel; Web observation makes the bounded loop inspectable locally.

## Roadmap and acceptance conditions

### Iteration 0 / V10 — establish the direction and minimum observable loop

V10 is the first iteration, not the finished product. It establishes the contract vocabulary, deterministic fixture data, a read-only Web observation surface, and tests that make the minimum loop reproducible without Slack credentials or external services.

Acceptance conditions:

- the HRS path and product boundary are documented and linked from both READMEs;
- a local Web server exposes health and runtime-observation data from deterministic fixtures;
- the page/API/tests verify task, event, status, and completion-outcome projection;
- existing Slack Gateway and MCP entry points remain operationally independent.

### Iteration 1 — real HRS adapter and evidence ledger

Replace or supplement fixtures with a real, validated HRS adapter for a selected runtime. Record contract transitions and completion evidence in a local ledger with traceable correlation between Event, TaskEnvelope, Completion, and Delivery.

Acceptance conditions:

- one real runtime can produce and consume the selected HRS contract end to end;
- every terminal completion has a stable correlation id and locally retrievable evidence receipt;
- malformed, duplicate, and out-of-order inputs have defined handling and tests;
- the observation surface shows real adapter data while fixture coverage remains hermetic.

### Later iterations — reliability and multi-runtime coordination

Extend from one proven runtime loop to coordination across multiple runtimes and channels. Priorities are delivery reliability, recovery, policy boundaries, and comparable observability—not broad organization-management features.

Acceptance conditions:

- at least two runtime adapters interoperate through the same contract semantics;
- retry, idempotency, failure, blocked work, and recovery are observable and testable;
- attention/delivery policies have explicit local control boundaries and auditable outcomes;
- new scope is admitted only when supported by evidence from real operating loops.

## Current implementation references

- [`V10-HRS-observation-slice.md`](./V10-HRS-observation-slice.md) describes the implemented Iteration 0 slice.
- [`V10-HRS-contracts-draft.md`](./V10-HRS-contracts-draft.md) preserves the contract draft.
- [`../../README.md`](../../README.md) and [`../../README_CN.md`](../../README_CN.md) provide the project-level entry points and operational commands.
