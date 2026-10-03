# Iteration 10 — Strict SDD Specification

**Status:** DRAFT FOR REVIEW. No implementation authorization.

## 1. Scope

Iteration 10 specifies one bounded, real-runtime HRS observation/evidence
slice. It is a successor planning slice to the deterministic V10 observation
example, not evidence that the example or any real adapter has been accepted.

The selected adapter must ingest a validated event/task/completion feed and
produce a local, read-only projection plus retrievable evidence metadata. The
Web surface must never execute a runtime action.

## 2. Required behavior

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| I10-FR-01 | Select exactly one runtime and document its adapter capability evidence. | ADR records runtime, API/version/license constraints, feasible/limited/blocked result, and source evidence. |
| I10-FR-02 | Normalize only the approved Event, TaskEnvelope, Completion, and delivery/attention fields needed for the slice. | Schemas name `schema_version`, correlation IDs, allowed terminal outcomes, validation failures, and compatibility rules. |
| I10-FR-03 | Preserve a traceable correlation path from event to completion/evidence. | A test fixture demonstrates event ID -> envelope ID -> completion ID -> evidence receipt; duplicate/out-of-order behavior is defined. |
| I10-FR-04 | Provide a local read-only observation projection. | API/page cannot invoke execution; it exposes source classification, status, task/event summary, terminal outcome, and evidence-receipt reference. |
| I10-FR-05 | Keep hermetic coverage. | Deterministic fixtures remain available and automated tests cover validation, projection, error/unknown paths, and no-write observation behavior. |
| I10-FR-06 | Define retention and sensitive-data boundaries before persistence. | Review-approved retention/location decision excludes secrets and runtime-private memory; unresolved choice blocks persistence implementation. |

## 3. Non-functional and safety requirements

- Local-first; no credentials or external network call is required for
  deterministic tests.
- Inputs fail closed when schema version, correlation, allowed transition, or
  source identity is invalid.
- Completion reconciliation must define push/poll precedence and deduplication.
- The TaskEnvelope state machine and WakeAction-to-Attention conflict precedence
  must be explicit before production-facing implementation; the latter was
  called out as unfinished in the existing HRS review.
- No records from Soul, gbrain, `agents_memory`, mem0, or `zederer_ip` may be
  read, copied, or migrated by this slice.

## 4. Out of scope

Runtime scheduler replacement, channel transport, Slack authentication,
production UI, multi-runtime coordination, generic ledger/platform features,
organization management, and external tracker operations are excluded.

## 5. Open decisions / Flagged Concerns

| ID | Concern | Impact | Required decision owner |
| --- | --- | --- | --- |
| FC-I10-01 | Real runtime/adapter has not been selected or independently probed. | Blocks I10-FR-01 and implementation. | 小马 with 小龙 operational input; 小扣 acceptance. |
| FC-I10-02 | Evidence receipt store, retention, deletion and privacy classification are unknown. | Blocks persistence and delivery claims. | 小扣; implementation owner supplies options. |
| FC-I10-03 | Existing draft does not yet settle WakeAction-to-Attention conflict precedence. | Can create inconsistent delivery behavior. | 小扣 decision after 小马 review. |
| FC-I10-04 | Existing draft leaves project naming/namespace policy open. | Risks correlation and tenancy ambiguity. | 小扣 decision; 小马 verifies tests. |
| FC-I10-05 | No Trello board or GitHub Issue has been inspected or changed in this task. | External mapping cannot be treated as created. | Authorized tracker operator. |

## Sources

- Contract vocabulary/open implementation closure: `docs/planning/V10-HRS-contracts-draft.md` and `docs/reviews/pr-159-v10-hrs-contracts-2026-09-05.md`.
- Observation boundary: `docs/planning/V10-HRS-observation-slice.md`.
- Product boundary: `docs/planning/chorusgate-direction.md`.
