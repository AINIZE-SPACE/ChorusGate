# Issue Tracking — slack4ccmcp Code Review

> Generated 2026-06-12 | Branch: `dev` | Repo: [AINIZE-SPACE/slack4ccmcp](https://github.com/AINIZE-SPACE/slack4ccmcp)

---

## Open Issues

### #16 MEDIUM — No automated test coverage

**Status:** Open | **Severity:** Medium | **Category:** Quality
**GitHub:** [#16](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/16)
**Labels:** `enhancement` `code-review` `priority:medium` `area:reliability`
**Affected files:** (none exist)

The project has zero test files. Add at minimum:
- [ ] Unit tests for `EventStore` (push, filter, markHandled, ring-buffer eviction)
- [ ] Unit tests for `SessionStore` (getOrCreate, evictIdle, persist/load cycle)
- [ ] Tool handler tests with mocked `getWebClient()`
- [ ] Reply-engine smoke test with canned stream-json fixture

---

### #17 MEDIUM — Inconsistent error handling across tools

**Status:** Open | **Severity:** Medium | **Category:** Consistency
**GitHub:** [#17](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/17)
**Labels:** `bug` `code-review` `priority:medium` `area:slack`
**Affected files:** `src/tools/*.ts`, `src/index.ts`

Tools currently throw generic `Error` on failure. No distinction between "not found", "permission denied", "rate limited", or "network error". Consider:
- [ ] Standardized `ToolResult` type with `ok: boolean` and `error?: { code, message }`
- [ ] Map Slack API error codes to meaningful responses
- [ ] Don't treat "channel not found" the same as "network timeout"

---

### #19 LOW — Empty .mcp.json at project root

**Status:** Open | **Severity:** Low | **Category:** Configuration
**GitHub:** [#19](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/19)
**Labels:** `bug` `code-review` `priority:low` `documentation`
**Affected files:** `.mcp.json`

The `.mcp.json` has `mcpServers: {}`. Users following the README may expect configuration to be here. Either:
- [ ] Populate with the example content from `.mcp.json.example`
- [ ] Or remove and add a note in README pointing to `.mcp.json.example`

---

### #20 LOW — Module-level cwd() side effect in gateway-paths.ts

**Status:** Open | **Severity:** Low | **Category:** Architecture
**GitHub:** [#20](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/20)
**Labels:** `bug` `code-review` `priority:low` `area:slack`
**Affected files:** `src/gateway-paths.ts`

`GATEWAY_DIR = resolve(process.cwd(), ".gateway")` computed at import time. If `process.cwd()` differs between import and first use (e.g. in test runners), the path is stale. Consider lazy evaluation.

---

### #21 LOW — No pagination support in list-channels

**Status:** Open | **Severity:** Low | **Category:** Feature Gap
**GitHub:** [#21](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/21)
**Labels:** `enhancement` `code-review` `priority:low` `area:slack`
**Affected files:** `src/tools/list-channels.ts`

The `conversations.list` API can return `response_metadata.next_cursor` for pagination. The tool doesn't handle this — workspaces with >50 channels see truncated results. Either add cursor support or document the limitation.

---

## Resolved Issues (Closed on GitHub)

### #11 ✅ CRITICAL — Token logging in gateway.ts
**GitHub:** [#11](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/11) (closed)
**Labels:** `bug` `code-review` `priority:critical` `area:slack`
`console.error` was printing full `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` to stderr.
→ Changed to redacted prefix-only logging.

### #12 ✅ HIGH — slack_reply doesn't mark events as handled
**GitHub:** [#12](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/12) (closed)
**Labels:** `bug` `code-review` `priority:high` `area:slack`
Tool description claimed "marks events as handled" but never called `markHandled()`.
→ Added best-effort handled-marking by channel+ts matching.

### #13 ✅ MEDIUM — Windows \r\n breaks stream-json parsing
**GitHub:** [#13](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/13) (closed)
**Labels:** `bug` `code-review` `priority:medium` `area:reliability`
`\r\n` line endings caused silent JSON parse failures in `reply-engine.ts`.
→ Strip `\r` before line splitting.

### #14 ✅ MEDIUM — Duplicated bootstrap code
**GitHub:** [#14](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/14) (closed)
**Labels:** `enhancement` `code-review` `priority:medium` `area:slack`
`gateway.ts` and `index.ts` duplicated 40+ lines of env loading + token validation.
→ Extracted into `src/bootstrap.ts`.

### #15 ✅ MEDIUM — Missing build/lint scripts
**GitHub:** [#15](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/15) (closed)
**Labels:** `enhancement` `code-review` `priority:medium` `area:lifecycle`
No `typecheck`/`lint`/`build` scripts in package.json.
→ Added `tsc --noEmit` based scripts.

### #18 ✅ LOW — .env.example incomplete
**GitHub:** [#18](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/18) (closed)
**Labels:** `documentation` `code-review` `priority:low`
Only two env vars documented; all gateway/CLAUDE_BIN vars were missing.
→ Expanded with full documentation and defaults.

---

## Labels Created for This Review

| Label | Color | Purpose |
|-------|-------|---------|
| `priority:critical` | `#B60205` | Must fix immediately — security, data-loss, crash |
| `priority:high` | `#D93F0B` | Should fix soon — correctness or UX impact |
| `priority:medium` | `#FBCA04` | Should fix — maintainability or non-critical bug |
| `priority:low` | `#0E8A16` | Nice to have — cosmetic, docs, edge-case |
| `code-review` | `#1D76DB` | Found during code review |

---

*11 issues filed. 6 closed (fixed). 5 open (pending).*
*Report: [REVIEW.md](REVIEW.md)*
