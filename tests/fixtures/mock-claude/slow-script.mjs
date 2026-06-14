// ============================================================
// slow-script.mjs — mock claude that sleeps before responding
// Used by interrupt-integration tests (IT-01..IT-08).
//
// Usage: node slow-script.mjs [sleepMs]
//   MOCK_SLEEP_MS env > CLI arg > 2000 default
//
// Behavior:
//   1. Emits init event immediately
//   2. Reads stdin until "user" message arrives
//   3. Sleeps sleepMs (simulating long-running Claude task)
//   4. Emits result event
//   5. Exits 0
//
// Honors SIGTERM by exiting quickly (Node default) — the test
// asserts on child.killed === "SIGTERM" via the parent's view,
// not the OS-level process state.
// ============================================================

const sleepMs = Number(
  process.env.MOCK_SLEEP_MS || process.argv[2] || 2000,
);

const SESSION_ID = process.env.MOCK_SESSION_ID || "mock-slow-session";

function emit(line) {
  process.stdout.write(JSON.stringify(line) + "\n");
}

// Emit init immediately
emit({
  type: "system",
  subtype: "init",
  session_id: SESSION_ID,
  cwd: process.cwd(),
  model: "mock-slow-model",
  tools: ["Bash"],
});

let userReceived = false;
let pending = "";

process.stdin.setEncoding("utf-8");
process.stdin.resume();

process.stdin.on("data", (chunk) => {
  pending += chunk;
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === "user" && !userReceived) {
        userReceived = true;
        startSlowFlow();
      }
    } catch {
      // ignore
    }
  }
});

function startSlowFlow() {
  setTimeout(() => {
    emit({
      type: "assistant",
      message: {
        id: "msg_slow_001",
        model: "mock-slow-model",
        role: "assistant",
        type: "message",
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: "text", text: "Slow response after " + sleepMs + "ms" }],
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    });
    emit({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: sleepMs,
      num_turns: 1,
      result: "Slow response after " + sleepMs + "ms",
      session_id: SESSION_ID,
      total_cost_usd: 0.01,
      usage: { input_tokens: 50, output_tokens: 10 },
      permission_denials: [],
      uuid: "result-slow-001",
    });
    process.stdin.pause();
    setTimeout(() => process.exit(0), 50);
  }, sleepMs);
}

// Safety: if user message never arrives, exit after 30s
setTimeout(() => {
  if (!userReceived) {
    console.error("[slow-script] no user message received in 30s, exiting");
    process.exit(1);
  }
}, 30000);
