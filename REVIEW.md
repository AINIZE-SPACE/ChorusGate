# Code Review Report — slack4ccmcp (dev branch)

**Date:** 2026-06-12
**Branch:** `dev`
**Review Scope:** Full codebase (19 source files, 2 bin entry points)
**Reviewer:** Automated Claude Code review

---

## Summary

| Severity  | Found | Fixed | Pending |
|-----------|-------|-------|---------|
| Critical  | 1     | 1     | 0       |
| High      | 1     | 1     | 0       |
| Medium    | 5     | 3     | 2       |
| Low       | 5     | 2     | 3       |
| **Total** | **12**| **7** | **5**   |

**Overall:** The codebase is well-structured for its size — clear module boundaries, good comments, and a consistent style. The dual-mode architecture (MCP server + standalone gateway daemon) is cleanly separated. The main issues are a critical security leak (token logging), a mismatch between documented and actual behavior in `slack_reply`, and some duplication that's been refactored out. There's room for improvement in error handling consistency and test coverage.

---

## Issues

### ✅ CRITICAL-001: Token logging in gateway.ts (FIXED)

**File:** `src/gateway.ts:23` (before fix)
**Severity:** Critical
**Category:** Security

`console.error()` was printing the full `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` values to stderr on every gateway startup. These tokens grant full API access. Stderr can end up in log files, terminal scrollback, CI output, or system logs — all of which are attack surface.

**Fix:** Changed to log only a redacted prefix (`xoxb-...` → `xoxb-...`) if present, or `MISSING` if absent.

---

### ✅ HIGH-001: slack_reply doesn't mark events as handled (FIXED)

**File:** `src/tools/reply.ts`
**Severity:** High
**Category:** Correctness

The tool description explicitly claims: *"After replying, marks the original event as handled."* But the handler function never called `eventStore.markHandled()`. When used via the MCP tool (not the gateway), replied-to events would remain in the pending queue forever, causing stale event buildup.

**Fix:** Added logic to find matching events by `channel + ts` and `channel + thread_ts` in the recent event buffer and mark them as handled. This is best-effort (the in-memory store is ring-buffered) but covers the common case.

---

### ✅ MEDIUM-001: Windows \r\n breaks stream-json parsing (FIXED)

**File:** `src/reply-engine.ts:238`
**Severity:** Medium
**Category:** Correctness

The stream-json output from `claude -p` on Windows may contain `\r\n` line endings. The parser split on `\n` only, leaving trailing `\r` characters in JSON lines. `JSON.parse("\r")` throws `SyntaxError`, which the code silently caught — meaning tool-use labels and final result text could be silently lost on Windows.

**Fix:** Added `.replace(/\r/g, "")` before splitting lines.

---

### ✅ MEDIUM-002: Duplicated bootstrap code (FIXED)

**Files:** `src/index.ts`, `src/gateway.ts`
**Severity:** Medium
**Category:** Maintainability

Both entry points duplicated the same 40+ lines: `.env` loading, MCP placeholder fixup, token validation, and `initSlackClients()`. This duplication meant any change to token format validation had to be applied in two places.

**Fix:** Extracted shared bootstrap into `src/bootstrap.ts` with a single `bootstrap()` function. Both entry points now call it in one line.

---

### ✅ MEDIUM-003: Missing build/lint scripts (FIXED)

**File:** `package.json`
**Severity:** Medium
**Category:** Developer Experience

No `build`, `typecheck`, or `lint` scripts existed. TypeScript errors could go unnoticed until runtime (tsx is JIT). CI would have no way to validate the build.

**Fix:** Added `build`, `typecheck`, and `lint` scripts, all running `tsc --noEmit`.

---

### ⚠️ MEDIUM-004: No automated tests (PENDING)

**Files:** (none exist)
**Severity:** Medium
**Category:** Quality

The project has zero test files — no unit tests for the event store, no integration tests for the MCP tools, no mock-based tests for the reply engine. For a bridge between Slack and Claude Code (two external systems), this is a significant gap.

**Recommendation:** Add at minimum:
- Unit tests for `EventStore` (push, filter, markHandled, ring-buffer eviction)
- Unit tests for `SessionStore` (getOrCreate, evictIdle, persist/load cycle)
- Integration test for tool handler logic (mock `getWebClient()`)
- Reply-engine test with a canned stream-json fixture

---

### ⚠️ MEDIUM-005: Inconsistent error handling across tools (PENDING)

**Files:** `src/tools/*.ts`
**Severity:** Medium
**Category:** Consistency

Most tools throw `new Error(...)` on failure, which is caught by the MCP server's generic `CallToolRequestSchema` handler. However:
- `replyTool` now has additional best-effort matching that silently ignores failures
- `channelHistoryTool` and `threadRepliesTool` handle empty results gracefully but don't distinguish "error" from "empty"
- `getUserInfoTool` does an extra `profile` lookup that some others don't

**Recommendation:** Consider a consistent pattern where tools return a structured result with `ok: boolean` and `error?: string` rather than throwing. This avoids the MCP layer always returning 500-style errors for expected failure modes like "channel not found".

---

### ✅ LOW-001: .env.example missing gateway/MCP vars (FIXED)

**File:** `.env.example`
**Severity:** Low
**Category:** Documentation

The example file only documented `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN`. All gateway env vars (`GATEWAY_*`, `CLAUDE_BIN`, `MCP_SENDER_ONLY`, etc.) were undocumented.

**Fix:** Expanded `.env.example` with all supported variables, organized into sections with defaults.

---

### ℹ️ LOW-002: _event unused parameter (NO-OP)

**File:** `src/index.ts:265`
**Severity:** Low
**Category:** Style

`notifySubscribers(_event: StoredEvent)` uses the `_event` underscore convention — this is the standard TypeScript idiom for parameters required by a type signature (`EventCallback`) but intentionally unused in the function body. No fix needed.

---

### ℹ️ LOW-003: Empty .mcp.json at project root (PENDING)

**File:** `.mcp.json`
**Severity:** Low
**Category:** Configuration

The project's `.mcp.json` has an empty `mcpServers: {}`. The `.mcp.json.example` shows proper configuration but users may be confused by the empty file. Consider either populating it with the example content or removing it (and keeping only .example).

---

### ℹ️ LOW-004: Module-level side effect in gateway-paths.ts (OBSERVATION)

**File:** `src/gateway-paths.ts:20`
**Severity:** Low
**Category:** Architecture

`GATEWAY_DIR` is computed as `resolve(process.cwd(), ".gateway")` at module load time. If `process.cwd()` changes between module load and first use (unlikely but possible), the path would be stale. This is a known pattern in this project (the recent commit `3fa6803` explicitly moved `.gateway/` to follow cwd).

---

### ℹ️ LOW-005: list-channels doesn't support pagination (KNOWN LIMITATION)

**File:** `src/tools/list-channels.ts`
**Severity:** Low
**Category:** Feature Gap

The tool fetches up to `limit` channels (default 50) but doesn't handle `response_metadata.next_cursor` for pagination. Workspaces with >50 channels will see truncated results. This is acceptable for an MVP but should be documented.

---

## Architecture Notes

### Strengths

1. **Clean dual-mode design:** The MCP server (`index.ts`) and gateway daemon (`gateway.ts`) share core modules (`slack-clients`, `socket-manager`, `event-store`) while having distinct responsibilities. The `MCP_SENDER_ONLY` flag prevents the MCP process from stealing Socket Mode events from the gateway — a non-obvious pitfall correctly addressed.

2. **Session continuity:** Per-channel/thread Claude session UUID tracking via `memory/sessions.md` is elegant — human-readable, git-trackable, and stateless from the gateway's perspective.

3. **Progress UX:** The placeholder-message + heartbeat + tool-label pattern in `gateway.ts` provides live feedback during long AI replies, preventing the "is the bot frozen?" problem.

4. **Windows-aware spawn:** The `reply-engine.ts` spawn logic handles Windows `shell:true` requirements and `DEP0190` warnings explicitly, with comments explaining each workaround.

5. **No silent failures:** Console.error is used consistently so issues are visible in logs.

### Areas for Improvement

1. **Test coverage (0%):** See MEDIUM-004.
2. **Pagination support:** Tools that list resources (`list_channels`, `check_events` with large stores) don't page.
3. **Error taxonomy:** Tools throw generic `Error` — no distinction between "not found", "permission denied", "rate limited", or "network error".
4. **Lint configuration:** No ESLint or Prettier config; TypeScript strict mode provides most of the guardrails.

---

## Issue Tracking

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| CRITICAL-001 | Critical | Token logging in gateway.ts | ✅ Fixed |
| HIGH-001 | High | slack_reply doesn't mark events as handled | ✅ Fixed |
| MEDIUM-001 | Medium | \r\n line endings break stream-json parsing | ✅ Fixed |
| MEDIUM-002 | Medium | Duplicated bootstrap code | ✅ Fixed |
| MEDIUM-003 | Medium | Missing build/lint scripts | ✅ Fixed |
| MEDIUM-004 | Medium | No automated tests | ⚠️ Pending |
| MEDIUM-005 | Medium | Inconsistent error handling | ⚠️ Pending |
| LOW-001 | Low | .env.example incomplete | ✅ Fixed |
| LOW-002 | Low | _event unused parameter | ℹ️ By design |
| LOW-003 | Low | Empty .mcp.json | ⚠️ Pending |
| LOW-004 | Low | Module-level cwd() side effect | ℹ️ Observation |
| LOW-005 | Low | No pagination in list-channels | ℹ️ Known limitation |

---

## Files Changed

| File | Change |
|------|--------|
| `src/gateway.ts` | Removed token logging; use shared `bootstrap()` |
| `src/index.ts` | Use shared `bootstrap()` instead of inline init |
| `src/bootstrap.ts` | **New** — shared env load + token validation + client init |
| `src/tools/reply.ts` | Added `eventStore.markHandled()` after successful reply |
| `src/reply-engine.ts` | Strip `\r` from stream-json lines before parsing |
| `package.json` | Added `build`, `typecheck`, `lint` scripts |
| `.env.example` | Documented all supported env vars with defaults |

---

*Generated by Claude Code review. All TypeScript compiles cleanly (`tsc --noEmit` passes).*
