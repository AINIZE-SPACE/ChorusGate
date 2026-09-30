# Iteration 10 — Intent

**Status:** SDD preparation; implementation is not authorized by this document.  
**Iteration:** 10 (planning label only; it is not a claim that V10/Iteration 0 was completed).  
**Date:** 2026-09-27

## Intent

Prepare a reviewable, evidence-first definition for the next ChorusGate slice:
turn a selected, real runtime's HRS contract transitions into a local,
traceable observation and evidence path without turning ChorusGate into the
runtime, an organization-management product, or a Zederer knowledge/IP system.

The proposed scope starts only after the review gates in `plan.md` pass. It is
not an authorization to implement product code, create external records, or
operate a production service.

## Product and control-plane boundary

ChorusGate is the local coordination boundary between Channels, Gateway, and
digital-employee runtimes. Its bounded loop is:

```text
Event -> WakePolicy -> TaskEnvelope -> HarnessAdapter -> Completion -> Attention/Delivery
```

It may normalize and observe the handoff, keep correlation/evidence metadata,
and expose a bounded local surface. A runtime continues to own its execution,
tools, scheduler, memory, internal state, and side effects.

The organization/member/collaboration material cited below is migrated
**control-plane operating context only**. It does not define Zederer knowledge,
Zederer IP, public language, or product advice; no such knowledge is copied or
derived by this iteration. `zederer_ip` is cited solely as the source of the
migrated collaboration constraints.

## Explicit responsibilities

| Concern | ChorusGate responsibility | Explicitly outside ChorusGate |
| --- | --- | --- |
| Channel boundary | Receive/route normalized channel events and deliver bounded results through existing channel adapters. | Owning platform credentials, identities, or platform-native business policy. |
| Gateway/control boundary | Apply the approved HRS handoff policy, correlation, evidence receipt, and local observation boundary. | Becoming a general organization, HR, performance, IAM, cloud, or knowledge platform. |
| Runtime boundary | Invoke only an approved adapter contract and record its reported transitions. | Runtime reasoning, memory, scheduler, tools, execution lifecycle, and side effects. |
| Collaboration boundary | Preserve owner, dependency, review, evidence, and handoff state for the proposed work. | Reinterpreting team/organization facts as Zederer knowledge or IP guidance. |

## Outcomes sought

1. A frozen, source-cited contract decision for one selected runtime adapter.
2. A deterministic, testable definition of correlation, terminal completion,
   evidence receipt, and observation behavior.
3. A review-ready delivery plan with explicit authority and external-tracking
   boundaries.

## Non-goals

- No product-code implementation, runtime deployment, scheduler replacement,
  Slack login/credential work, external service calls, or production operation.
- No new transport, IAM, knowledge store, organization-management capability,
  or generalized control plane.
- No creation or modification of Trello boards/cards or GitHub Issues/PRs.
- No assertion that an adapter is feasible, that a prior V10 slice is accepted,
  or that any external tracking item exists.

## Sources and unresolved items

- Product direction and boundary: `README.md`; `docs/planning/chorusgate-direction.md`;
  `docs/planning/architecture-boundaries.md`.
- Existing HRS draft and reviewed open implementation items:
  `docs/planning/V10-HRS-contracts-draft.md`;
  `docs/reviews/pr-159-v10-hrs-contracts-2026-09-05.md`.
- Migrated control-plane organization/collaboration facts:
  `E:/my_project/ainize/zederer_ip/docs/03_operations/SLACK_COORDINATION.md` and
  `E:/my_project/ainize/zederer_ip/docs/03_operations/ZKOS_IP_TEAM_RETROSPECTIVE_2026-08-29.md`.
- **Unresolved:** selected real runtime, authoritative input feed, adapter API
  evidence, persistence location/retention, privacy classification, and the
  exact Iteration 10 acceptance environment are not established in the cited
  sources. They require review decisions before implementation.
