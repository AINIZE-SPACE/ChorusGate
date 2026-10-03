# G1 Review Record — Runtime/Adapter Scope and Contract Decision

**Gate:** G1 — Scope/contract review (owner: 小扣)
**Verdict:** **CONDITIONAL PASS**
**Reviewer:** 小扣 (Codex implementation executor)
**Date:** 2026-10-02

## Decision

G1 conditionally passes the planning decision only. **C1, described in the
entry evidence as `opencode-via-acpx`, is the one and only candidate selected
for the CG-I10-002 capability spike.** This is a selection for an isolated
spike, not a verified runtime integration, ADR acceptance, or authorization to
write runtime code.

The condition is necessary because the evidence does not yet prove that C1 is
the same adapter identity as the documented `Hermes Host+acpx` mainline:
`V10-HRS-contracts-draft.md` names the latter, while the entry evidence notes
that the literal `acpx-opencode` does not occur in repository documentation.
CG-I10-002 must resolve that identity with executable evidence before ADR-0001
can name a runtime/adapter as accepted.

## Evidence inspected

- `4736d58` (`docs(v10): Iteration 10 SDD pack + G0 review record`), including
  `review-g0.md`, `tasks.md`, and `plan.md`.
- `2550efd` (`docs(v10): G1 entry evidence — runtime/adapter candidates`),
  which adds `g1-entry-runtime-candidates.md`.
- `docs/planning/V10-HRS-contracts-draft.md` §§0, 8–9 and its dual-validation
  checklist; `docs/planning/V10-HRS-observation-slice.md`; and
  `docs/planning/architecture-boundaries.md`.

The requested local commit `65ce2e4` and the requested file
`g1-review-input-runtime-candidates-xiaoma.md` were not present in the local
object database or working tree. `git fetch origin` was attempted before this
review but failed with `Recv failure: Connection was reset`; this record relies
only on the locally inspectable substitute above and does not attribute any
unseen content to the requested commit or file.

## Candidate resolution and boundary

| Candidate | G1 disposition | Reason / permitted next step |
| --- | --- | --- |
| C1 — `opencode-via-acpx` | **Selected conditionally for CG-I10-002 only** | It is the only selected probe candidate. The spike must identify the actual HRS `executor`/adapter identity, prove `execute` and push completion behavior, and record version/license and limits. It must not claim that `opencode-via-acpx` is the documented Hermes mainline without that evidence. |
| C4 — OpenClaw | **Retained as the documented formal fallback; not selected for this spike** | The HRS draft specifies OpenClaw when the mainline is unavailable or constrained. Do not run a second probe: record a C1 failure/limitation as evidence first, then require a separately authorized selection decision. Xiao龙's operations constraints are also still required. |
| C5 — Hermes native | **Not a CG-I10-002 candidate** | Its role as channel/gateway responsibility versus professional-worker runtime is unresolved in the supplied input. It remains out of the exactly-one-candidate spike until a later scope decision explicitly admits it. |
| C2/C3 and self-built runtime | **Not selected** | C2/C3 have no stronger local basis than C1 and introduce cross-machine constraints. A self-built runtime is already rejected by the HRS draft. |

The scope remains the bounded local HRS observation/coordination entry point.
This decision does not authorize a personnel product, generic control plane,
runtime-internal memory access, scheduler replacement, production delivery, or
external tracking changes.

## No-secret posture

CG-I10-002 may proceed only after its prerequisites below are met, and only in
an isolated profile/work area with fixture or non-sensitive test data. The
probe payload, committed evidence, logs, and screenshots must contain no API
keys, tokens, production Soul/gbrain/agents_memory/mem0 data, or credentials.
If a real provider call requires a secret, the secret may be injected only by
the external runner; it must not be put in the repository, payload, receipt,
or review artifact. A fixture/mock path must remain available for hermetic
coverage. Evidence must document the redaction method and the absence of
secret-bearing output.

## Conditions, owners, and next gates

1. **小龙 — prerequisite for CG-I10-002.** Record operational constraints for
   the isolated C1 probe: machine reachability/resources, network-egress
   limits, evidence retention/privacy classification, and whether media work is
   in scope. Until this input is recorded, **CG-I10-002 remains PENDING and
   must not start**.
2. **小马 — CG-I10-002, after the prerequisite.** Produce a capability-spike
   record for C1 only: selection-identity reconciliation, supported API,
   isolation, completion callback/poll behavior, limits, version/license,
   no-secret setup, and a checkable failure/limitation path. No runtime code or
   integration is authorized.
3. **小扣 — G2 and ADR-0001 route.** Review the completed spike and decide
   whether its evidence satisfies the HRS dual-validation checklist. Only then
   may CG-I10-003/ADR-0001 decide C1, elevate C4, or keep the decision open.
4. **小马 then 小扣 — G2/G3/G4.** Freeze the contract/test matrix, obtain the
   operations/local-delivery review, and create a separate bounded
   implementation TaskEnvelope before any product code. G4 remains blocked.

## Status and open concerns

- `CG-I10-001` has G0 **PASS** evidence in `review-g0.md`; the stale G0
  statuses in `plan.md` are reconciled by this review.
- `CG-I10-002..007` remain `PENDING`; this conditional planning decision does
  not satisfy their acceptance criteria or their downstream gates.
- The unavailable requested commit/file and the failed remote fetch must be
  rechecked before treating this as a complete remote-history review.

## Commands / verification scope

- `git fetch origin` (attempted; failed: `Recv failure: Connection was reset`)
- `git show --stat/--name-status 4736d58` and `2550efd`
- `git show`/working-tree inspection of the cited planning and boundary files
- `git cat-file`/revision lookup for `65ce2e4` and path lookup for the requested
  G1 input (not found locally)

No runtime code, external tracker, secret, or deployment action was performed.
