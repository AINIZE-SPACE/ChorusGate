#!/usr/bin/env bash
# ============================================================
# chorusgate-watchdog.sh — restart an agent daemon whose heartbeat
# is stale or whose process died (liveness spec Layer 3).
#
# Judge: read <agent home>/status.json + gateway.pid. Restart when
#   - the PID file exists but the process is gone (dead), OR
#   - the process is alive but status.json.updatedAt is older than
#     GATEWAY_HEARTBEAT_STALE_MS (default 180000) — half-open/hung.
#
# Register with cron every ~5 min (see README / liveness spec):
#   */5 * * * * /path/to/scripts/chorusgate-watchdog.sh
#
# Usage:
#   scripts/chorusgate-watchdog.sh
#   scripts/chorusgate-watchdog.sh codex 180000
# ============================================================
set -u

AGENT="${1:-default}"
STALE_MS="${2:-180000}"

if [ -n "${CHORUSGATE_HOME:-}" ]; then
  HOME_DIR="$CHORUSGATE_HOME/$AGENT"
else
  HOME_DIR="$HOME/.chorusgate/$AGENT"
fi
STATUS="$HOME_DIR/status.json"
PIDFILE="$HOME_DIR/gateway.pid"

# Daemon never started (or cleanly stopped) — nothing to do.
[ -f "$STATUS" ] || exit 0
[ -f "$PIDFILE" ] || exit 0

PID="$(cat "$PIDFILE" | tr -d '[:space:]')"
case "$PID" in
  ''|*[!0-9]*) exit 0 ;;   # unparseable pid file
esac
[ "$PID" -gt 0 ] || exit 0

UPDATED="$(sed -n 's/.*"updatedAt"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$STATUS" | head -1)"
if [ -z "$UPDATED" ]; then
  AGE_MS="$STALE_MS"        # unparseable status — treat as stale
else
  NOW_MS="$(($(date +%s) * 1000))"
  AGE_MS=$((NOW_MS - UPDATED))
fi

if kill -0 "$PID" 2>/dev/null; then ALIVE=1; else ALIVE=0; fi

RESTART=0
if [ "$ALIVE" -eq 0 ]; then RESTART=1; fi
if [ "$ALIVE" -eq 1 ] && [ "$AGE_MS" -gt "$STALE_MS" ]; then RESTART=1; fi

if [ "$RESTART" -eq 1 ]; then
  CMD="${CHORUSGATE_BIN:-chorusgate}"
  echo "[watchdog] restarting agent '$AGENT' (alive=$ALIVE heartbeatAge=${AGE_MS}ms)"
  "$CMD" restart --agent "$AGENT"
fi
exit 0
