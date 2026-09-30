# Iteration 10 — Project Constitution

**Status:** proposed project-level rules for this iteration; not a replacement
for repository instructions or an external team policy.

## Articles

1. **Evidence before status.** Requirement, local artifact, test, review/merge,
   deployment, human acceptance, and external-tracking states are distinct.
   No state may be inferred from another.
2. **Boundary first.** ChorusGate coordinates the Channel/Gateway/Runtime
   handoff. It must not absorb runtime-private execution, memory, scheduling,
   tools, side effects, identity, organization management, or Zederer IP.
3. **Source-cited decisions.** Any factual product or collaboration assertion
   in Iteration 10 must cite a repository source path. Unknown facts remain
   `UNRESOLVED`, not assumptions.
4. **Least-authority operation.** This SDD authorizes documentation only.
   Implementation, deployment, external tracking, credentials, and publication
   need a separately authorized task.
5. **Stable handoffs.** Every executable task must have a stable ID, owner,
   scope, inputs, dependency, acceptance criteria, evidence location, and next
   owner. A downstream task must not start before its dependencies pass.
6. **Independent reviews.** 小扣 reviews scope, boundary, source use, and
   acceptance; 小马 reviews testability, integration and regression evidence;
   小龙 reviews operational/local-environment and delivery constraints. Each
   review is an explicit gate, not a forwarded assertion.
7. **Safe control-plane facts.** Member/role/collaboration facts migrated from
   `zederer_ip` are used only to route work and specify gates. They must not be
   presented as Zederer knowledge, IP, canonical public language, or product
   rationale.
8. **External tracking is deferred.** The later sequence is Trello board
   `chorusgate`, backlog-first, then GitHub Issues. Until a separately
   authorized operator performs and verifies those actions, every mapping is
   `PENDING / NOT EXECUTED`.

## Source basis and limits

- Evidence layers and staged gates are adapted as project controls from
  `E:/my_project/ainize/zederer_ip/docs/03_operations/ZKOS_IP_TEAM_RETROSPECTIVE_2026-08-29.md`.
- Current role/channel migration context is
  `E:/my_project/ainize/zederer_ip/docs/03_operations/SLACK_COORDINATION.md`.
- Product boundaries are governed locally by
  `docs/planning/chorusgate-direction.md` and
  `docs/planning/architecture-boundaries.md`.
- The cited retrospective labels its SOP as a proposal/review-required source;
  this constitution therefore applies only to the Iteration 10 SDD until an
  authorized project decision changes it.
