# Iteration 10 — Plan and Review Gates

**Status:** `G0 PASS RECORDED; G1 CONDITIONAL PASS RECORDED`. This remains
planning only: CG-I10-002 is pending its stated prerequisite, and all
implementation phases remain conditional.

## Ordered gates

| Gate | Owner | Entry evidence | Exit condition | Outcome if not passed | Current status |
| --- | --- | --- | --- | --- | --- |
| G0 — SDD completeness | 小扣 | `intent.md`, `constitution.md`, `spec.md`, `plan.md`, `tasks.md` | Sources, boundary, non-goals, unresolved items, tasks and external status are internally consistent. | Return to SDD preparation. | `PASS — recorded in review-g0.md (2026-09-30)` |
| G1 — Scope/contract review | 小扣 | G0 plus proposed runtime and decision options | Accepts/rejects scope, authority, HRS boundaries, retention decision owner, and external-tracking deferral. | Block implementation. | `CONDITIONAL PASS — recorded in review-g1.md (2026-10-02); CG-I10-002 remains blocked pending 小龙 operational input` |
| G2 — Independent test/integration review | 小马 | G1-approved spec and adapter evidence | Confirms test matrix, state/correlation rules, regression scope, and acceptance environment. | Return to design/spike. | `PENDING — HUMAN REVIEW REQUIRED; G1 conditional pass; CG-I10-002 remains blocked pending 小龙 operational input` |
| G3 — Operations/local-delivery review | 小龙 | G2-reviewed plan | Confirms local runtime feasibility, environment constraints, observability and handoff requirements without exposing secrets. | Block runtime integration. | `PENDING — HUMAN REVIEW REQUIRED; G2 is not approved` |
| G4 — Implementation authorization | 小扣 | G1-G3 approvals recorded with source paths/evidence | A separate, bounded implementation TaskEnvelope exists. | No product code may begin. | `PENDING — HUMAN REVIEW REQUIRED; G1 conditional pass; G2/G3 are not approved` |
| G5 — Independent acceptance (future) | 小马, then 小扣 | Clean-checkout test evidence, review evidence, and documented external state | Separately records test and product acceptance; no deployment is implied. | Reopen the failing task. | `PENDING — HUMAN REVIEW REQUIRED; G4 and implementation are not approved` |

## Planned technical sequence

### Before G4 — planning evidence (tasks CG-I10-002..004)

1. Run a bounded adapter capability spike in an isolated profile/test fixture.
2. Write/approve ADR-0001 for runtime choice and rejected alternatives.
3. Freeze schema and transition rules, including precedence/namespace/retention
   decisions, before modifying behavior.

### After G4 — implementation sequence

1. Implement fixtures and contract validation before the real-adapter seam.
2. Implement the read-only projection and evidence-receipt lookup boundary.
3. Run unit, integration, regression, and clean-checkout independent tests.
4. Prepare a local artifact/review handoff; deployment and publishing remain
   outside this plan unless separately authorized.

## Review evidence format

Each gate record must state: verdict (`PASS`, `CONDITIONAL`, or `BLOCKED`),
reviewer, date, source paths/commands inspected, open concerns, and next owner.
An approval does not substitute for implementation, testing, merge, deployment,
or human acceptance.

## Sources

- Existing adapter/checklist and reviewed gaps:
  `docs/planning/V10-HRS-contracts-draft.md`;
  `docs/reviews/pr-159-v10-hrs-contracts-2026-09-05.md`.
- Migrated review/evidence discipline (used only as control-plane input):
  `E:/my_project/ainize/zederer_ip/docs/03_operations/ZKOS_IP_TEAM_RETROSPECTIVE_2026-08-29.md`.
