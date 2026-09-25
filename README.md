# ChorusGate

[中文文档](./README_CN.md)

## Project direction

ChorusGate is the local runtime-coordination entry point for organizational intelligence and collaboration among digital employees. It connects people and Agent Runtimes—including Hermes, OpenClaw, Codex, and Claude—through Channels and Gateway.

Its shared HRS contract makes the collaboration loop explicit:

```text
Event -> WakePolicy -> TaskEnvelope -> HarnessAdapter -> Completion -> Attention / Delivery
```

ChorusGate is local-first: it provides a verifiable local observation surface and controlled delivery/attention boundary. A runtime continues to own its own execution, tools, memory, scheduler, and internal behavior.

## Problem

Real runtimes each have their own events, task handoff, execution, completion, notification, and observation model. Cross-runtime collaboration therefore lacks a uniform contract, closed-loop status, evidence receipts, and a local operational entry point. ChorusGate addresses that coordination boundary; it does not replace the runtimes themselves.

## Long-term target

The long-term target is a proven coordination loop for multiple digital-employee runtimes: Channel/Gateway connects people and runtimes; HRS carries the portable contract; adapters execute within their runtime; Completion returns traceable evidence; and local Web observation makes the bounded state and outcomes inspectable.

See the project-level relationships, roadmap, and acceptance conditions in [ChorusGate project direction](docs/planning/chorusgate-direction.md).

## Non-goals

ChorusGate is not a generalized “silicon organization Control Plane,” an organization-management system, HR or performance platform, knowledge base, IAM layer, generic cloud platform, or a replacement scheduler/runtime. These are not current implementation targets; any future scope must be justified by a real operating loop.

## Roadmap

- **Iteration 0 / V10:** set the direction, establish the HRS vocabulary, deterministic fixtures, and a locally verifiable read-only observation surface.
- **Iteration 1:** add a real HRS adapter and local evidence ledger with traceable contract transitions.
- **Later:** make multi-runtime coordination reliable through idempotency, recovery, delivery policy, and comparable observability.

V10 is the first iteration—not the final product.

## Iteration 0 / V10: HRS runtime contracts + observation slice

The implemented V10 slice is read-only: a deterministic fixture adapter produces two digital-employee runtime records for a small Web API and page. It does not start Slack, authenticate a user, or contact an external service. The existing Slack gateway and MCP server remain operational entry points and are not replaced.

## V10 local Web demo

Prerequisite: Node.js 18+ and installed dependencies (`npm install`).

```bash
npm run v10:web
```

Open <http://127.0.0.1:4310>. The page is clearly labelled as deterministic demo data and shows employee/agent cards, runtime status, current task, recent event, and success/failure/blocked completion counts.

Endpoints:

- `GET /health` — liveness response and fixture source
- `GET /api/v10/employees` — employee runtime observation JSON
- `GET /` — static HTML observation page

Change `V10_WEB_PORT` to use another local port, for example `V10_WEB_PORT=4311 npm run v10:web` (PowerShell: `$env:V10_WEB_PORT=4311; npm run v10:web`).

## Verification

```bash
npm run typecheck
node --import tsx --import ./tests/test-env.mjs --test tests/v10-web.test.ts
```

The second command exercises fixture-to-view conversion plus health, employee API, HTML, and unknown-path behaviour. Run `npm test` for the full gateway suite. V10's interface boundary and acceptance criteria are in [`docs/planning/V10-HRS-observation-slice.md`](docs/planning/V10-HRS-observation-slice.md); the original contract draft remains in [`docs/planning/V10-HRS-contracts-draft.md`](docs/planning/V10-HRS-contracts-draft.md).

## Directory map

```text
src/
  gateway.ts, index.ts, tools/     existing Slack gateway and MCP entry points
  v10/
    types.ts                       read-only HRS observation boundary
    fixture-adapter.ts             deterministic demo runtime records
    employee-view.ts               adapter-to-Web projection
    web-server.ts, web-page.ts     native HTTP server and static page
tests/
  v10-web.test.ts                  conversion and HTTP acceptance tests
docs/planning/
  chorusgate-direction.md          project direction and staged acceptance conditions
  V10-HRS-contracts-draft.md       existing HRS contract draft
  V10-HRS-observation-slice.md     implemented slice design
```

## Existing gateway and MCP modes

V10 does not replace the existing Slack Socket Mode gateway or MCP server.
Install Node.js 18+, create the Slack app from the applicable manifest, and
configure its bot and app tokens in the relevant agent profile
`~/.chorusgate/<agent-id>/.env`; shell environment variables take precedence.
See [INSTALL.md](INSTALL.md) for profile migration and initialization, then
install and link the CLI:

```bash
npm install
npm link
```

Start either existing mode:

```bash
npm run gateway  # Slack Socket Mode gateway
npm run mcp      # MCP channel-tool server
```

For the complete Slack prerequisites, manifests, `.env` and profile guidance,
see [INSTALL.md](INSTALL.md). For MCP registration and environment guidance,
see [the MCP section of INSTALL.md](INSTALL.md#7-set-up-mcp-server-claude-code-ide-integration);
the [documentation index](docs/README.md) links the gateway and MCP operational
references.

## License

MIT
