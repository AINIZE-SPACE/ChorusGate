# ChorusGate

ChorusGate is a local-first coordination gateway for coding-agent runtimes and collaboration channels. The existing Slack gateway and MCP server remain the operational entry points. V10 adds a deliberately small, observable boundary for runtime coordination; it does not replace those components.

## V10: HRS runtime contracts + observation slice

### The problem

Hermes, OpenClaw, and similar runtimes already emit events, wake workers, run tasks, report completion, and notify people. What is missing is one portable and testable control entry point to observe that path across runtimes. V10 defines the HRS boundary and supplies a local demo view of its resulting runtime state.

```text
Event -> WakePolicy -> TaskEnvelope -> HarnessAdapter
                                      -> Completion -> Attention / Delivery
```

The first V10 slice is read-only: a deterministic fixture adapter produces two digital-employee runtime records for a small Web API and page. It does not start Slack, authenticate a user, or contact an external service.

### Explicit non-goals

V10 is **not** a silicon-organization management system, performance platform, enterprise Control Plane, HR system, knowledge base, IAM layer, generic cloud platform, scheduler, or complete frontend product. It does not move or ingest `zederer_ip`, `agents_memory`, `summit-saw`, Soul, gbrain, or mem0 data.

ChorusGate's scope here is a runtime coordination/control gateway: normalize the HRS boundary and make the bounded runtime state observable. Runtime-internal agent behavior stays with the corresponding runtime and its adapter.

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
npm test -- --test-name-pattern='V10'
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
