# Iteration 10 — Task Register

**External tracking status:** `PENDING / NOT EXECUTED`. No Trello board/card or
GitHub Issue/PR was created, modified, or verified by this SDD preparation.

## Work register

| ID | Task / Owner | Dependencies | Acceptance criteria | Risks / Flagged Concerns | Status |
| --- | --- | --- | --- | --- | --- |
| CG-I10-001 | Freeze SDD scope and sources — 小扣 | None | G0 passes; all five artifacts distinguish ChorusGate-local sources from cited `zederer_ip` migration/control-plane sources and retain unresolved items. | FC-I10-01 through FC-I10-05. | `PENDING — HUMAN REVIEW REQUIRED` |
| CG-I10-002 | Select/probe one runtime adapter — 小马, with 小龙 operational input | CG-I10-001; G1 | Capability-spike record documents selection criteria and the selected candidate, then records supported API, isolation, completion callback/poll behavior, limits, license/version, and no-secret test setup. | FC-I10-01. | `PENDING — HUMAN REVIEW REQUIRED; G1 conditional pass; blocked pending 小龙 operational input` |
| CG-I10-003 | Decide ADR-0001 and data/retention boundaries — 小扣 | CG-I10-002; G2 | ADR records chosen/rejected alternatives, correlation namespace, retention/location, privacy constraints, and supersede trigger. | FC-I10-02, FC-I10-04. | `PENDING — HUMAN REVIEW REQUIRED; dependencies are not approved` |
| CG-I10-004 | Freeze contract/test matrix — 小马 | CG-I10-003 | Schema, state transitions, duplicate/out-of-order rule, push/poll precedence, WakeAction-to-Attention precedence, and test cases are approved. | FC-I10-03, FC-I10-04. | `PENDING — HUMAN REVIEW REQUIRED; ADR is not approved` |
| CG-I10-005 | Authorize bounded implementation envelope — 小扣 | CG-I10-004; G3 | Separate implementation TaskEnvelope specifies repo/branch, scope, authority, tests, and no-external-operation limits. | Missing authority must remain a block. | `PENDING — HUMAN REVIEW REQUIRED` |
| CG-I10-006 | Implement and self-verify the approved slice — 小克 | CG-I10-005 | Only approved scope changes; fixture and real-adapter seam meet I10-FR-01..06; test evidence captured. | No product code is authorized by this SDD; implementation remains blocked pending CG-I10-005 and G4. | `PENDING — HUMAN REVIEW REQUIRED; no implementation authorization` |
| CG-I10-007 | Independently test and accept — 小马 then 小扣 | CG-I10-006 | Clean-checkout tests, regression evidence, review verdict, remaining risks, and next owner documented separately. | Test pass is not deployment or release. | `PENDING — HUMAN REVIEW REQUIRED; implementation is not approved` |

## Proposed later tracking mapping — pending only

| Local task | Trello target | GitHub Issue target | State |
| --- | --- | --- | --- |
| CG-I10-001..005 | Board: `chorusgate`; create in **Backlog** first | Create/link a GitHub Issue only after backlog item is established | PENDING / NOT EXECUTED |
| CG-I10-006 | Move only after implementation authorization and owner acceptance | Linked implementation Issue, if authorized | PENDING / NOT EXECUTED |
| CG-I10-007 | Move only with independently verifiable evidence | Linked acceptance/defect Issue(s), if authorized | PENDING / NOT EXECUTED |

The required sequence is **Trello board `chorusgate` -> Backlog first -> GitHub
Issues**. This table is a proposal for a later authorized operator; it is not a
record of external work.

## Article 5 task execution fields

These fields supplement, rather than replace, the register's IDs, owners,
dependencies, acceptance criteria, risks, and statuses. Evidence locations are
planned locations only until the named task is performed and independently
reviewed. No row below grants implementation or external-tracker authority.

| ID | Scope | Inputs | Evidence location | Next owner |
| --- | --- | --- | --- | --- |
| CG-I10-001 | Maintain the five SDD artifacts as a source-cited, bounded planning set; do not implement, track externally, or assert approval. | `intent.md`, `constitution.md`, `spec.md`, `plan.md`, `tasks.md`; local planning/boundary sources; cited `zederer_ip` migration/control-plane sources. | `docs/planning/iteration-10-sdd/`; G0 record location to be designated by the human reviewer. | 小扣 for the pending G0 human review. |
| CG-I10-002 | Select and probe exactly one candidate runtime adapter in an isolated, no-secret setup; document the selection criteria, selected candidate, and capability limits; do not integrate it. | G1 approval; I10-FR-01; local HRS draft/review; operational constraints from 小龙. | Planned ADR-0001 and a capability-spike record under `docs/planning/`; no evidence exists yet. | 小扣 for retention/ADR decision after 小马 supplies evidence. |
| CG-I10-003 | Decide and record runtime choice, alternatives, correlation namespace, retention/location, and privacy boundaries; do not persist product data. | CG-I10-002 evidence; G2 review; FC-I10-02 and FC-I10-04; I10-FR-06. | Planned `docs/planning/ADR-0001-*`; no ADR or review evidence exists yet. | 小马 to freeze the contract/test matrix after the ADR is approved. |
| CG-I10-004 | Define schema and transition/test rules, including duplicate/out-of-order, push/poll, WakeAction-to-Attention, and namespace precedence; do not modify behavior. | Approved ADR-0001; I10-FR-02..05; FC-I10-03 and FC-I10-04. | Planned contract/test-matrix artifact under `docs/planning/` and later test evidence; neither exists yet. | 小龙 for the pending G3 operations/local-delivery review, then 小扣 for authorization. |
| CG-I10-005 | Create a separately authorized, bounded implementation TaskEnvelope only after the required reviews; do not start code here. | CG-I10-004 artifact; G3 result; G1-G3 evidence; repository/branch and authority decision. | Planned implementation TaskEnvelope in the authorized work record; no envelope exists yet. | 小克 for implementation only after G4 approval and explicit acceptance of the envelope. |
| CG-I10-006 | Implement and self-verify only the G4-authorized observation/evidence slice; preserve runtime and Zederer-IP boundaries. | Approved CG-I10-005 TaskEnvelope; G4 authorization; approved ADR, contract/test matrix, and I10-FR-01..06. | Planned implementation branch/PR, test outputs, and evidence receipts named by the TaskEnvelope; none exist yet. | 小马 for independent test/integration review, then 小扣 for acceptance. |
| CG-I10-007 | Independently test the approved slice and record acceptance separately from deployment or release. | CG-I10-006 implementation/test evidence; G5 criteria; clean checkout; documented external state if authorized. | Planned independent test/acceptance report and review record; no evidence exists yet. | 小扣 for final human acceptance decision or return to 小克 if remediation is required. |

## Sources

- Role/review routing is cited `zederer_ip` migration/control-plane context, not
  ChorusGate-local product or knowledge/IP source material, from
  `E:/my_project/ainize/zederer_ip/docs/03_operations/SLACK_COORDINATION.md` and
  `E:/my_project/ainize/zederer_ip/docs/03_operations/ZKOS_IP_TEAM_RETROSPECTIVE_2026-08-29.md`.
- Product/contract prerequisites are from `docs/planning/chorusgate-direction.md`,
  `docs/planning/V10-HRS-contracts-draft.md`, and
  `docs/reviews/pr-159-v10-hrs-contracts-2026-09-05.md`.
