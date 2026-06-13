// ============================================================
// Mock claude — emits stream-json on stdout, reads from stdin.
//
// Usage: node script.mjs [mode]
//   simple       — init → assistant → result (no permissions)
//   permission   — init → assistant(tool_use) → permission_request
//                  → waits for permission_response on stdin
//                  → assistant → result
//   error        — init → assistant(error) → result(is_error:true)
//
// Mode priority: MOCK_CLAUDE_MODE env > CLI arg > "simple" default
// ============================================================

// readline has platform-specific quirks with piped stdin.
// Use raw process.stdin events (stream-json is line-delimited JSON).

const mode = process.env.MOCK_CLAUDE_MODE || process.argv[2] || "simple";
const SESSION_ID = process.env.MOCK_SESSION_ID || "mock-session-001";
const REQUEST_ID = "mock_req_001";

function emit(line) {
  process.stdout.write(JSON.stringify(line) + "\n");
}

let pending = "";
let userReceived = false;
let permissionHandled = false;

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
        startFlow();
      } else if (msg.type === "permission_response" && mode === "permission" && !permissionHandled) {
        permissionHandled = true;
        emit({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_mock_001", content: "File written.", is_error: false }],
          },
          session_id: SESSION_ID,
          parent_tool_use_id: null,
        });
        emit({
          type: "assistant",
          message: {
            id: "msg_mock_002",
            model: "mock",
            role: "assistant",
            type: "message",
            usage: { input_tokens: 50, output_tokens: 20 },
            content: [{ type: "text", text: "Done! The tool executed successfully." }],
          },
          parent_tool_use_id: null,
          session_id: SESSION_ID,
        });
        emit({
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 2000,
          num_turns: 3,
          result: "Done! The tool executed successfully.",
          session_id: SESSION_ID,
          total_cost_usd: 0.01,
          usage: { input_tokens: 200, output_tokens: 80 },
          permission_denials: [],
          uuid: "result-mock-002",
        });
        // flushes & close
        process.stdin.pause();
        setTimeout(() => { process.exit(0); }, 50);
      }
    } catch {
      // ignore invalid JSON
    }
  }
});

process.stdin.on("end", () => {
  if (pending.trim()) {
    try {
      const msg = JSON.parse(pending.trim());
      if (msg.type === "user" && !userReceived) {
        userReceived = true;
        startFlow();
      }
    } catch { /* ignore */ }
  }
});

function startFlow() {
  emit({
    type: "system",
    subtype: "init",
    session_id: SESSION_ID,
    tools: ["Bash", "Write", "Read", "Glob", "Grep", "Edit"],
    model: "claude-sonnet-4-6",
    permissionMode: mode === "permission" ? "default" : "bypassPermissions",
    claude_code_version: "2.1.172-mock",
  });

  emit({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: "Hello from mock claude" }],
    },
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    isReplay: true,
  });

  if (mode === "error") {
    emit({
      type: "assistant",
      message: {
        id: "msg_mock_err",
        model: "mock",
        role: "assistant",
        type: "message",
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: "text", text: "Mock error: simulated failure" }],
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    });
    emit({
      type: "result",
      subtype: "success",
      is_error: true,
      duration_ms: 500,
      num_turns: 1,
      result: "Mock error: simulated failure",
      session_id: SESSION_ID,
      total_cost_usd: 0,
      usage: { input_tokens: 10, output_tokens: 5 },
      permission_denials: [],
      uuid: "result-mock-err",
    });
    process.stdin.pause();
    setTimeout(() => { process.exit(0); }, 50);
    return;
  }

  if (mode === "permission") {
    emit({
      type: "assistant",
      message: {
        id: "msg_mock_001",
        model: "mock",
        role: "assistant",
        type: "message",
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [
          {
            type: "tool_use",
            id: "toolu_mock_001",
            name: "Write",
            input: { file_path: "/tmp/test.txt", content: "hello" },
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    });
    emit({
      type: "system",
      subtype: "permission_request",
      request_id: REQUEST_ID,
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test.txt", content: "hello" },
      session_id: SESSION_ID,
    });
    // keep stdin open — wait for permission_response
    return;
  }

  // simple mode
  emit({
    type: "assistant",
    message: {
      id: "msg_mock_001",
      model: "mock",
      role: "assistant",
      type: "message",
      usage: { input_tokens: 50, output_tokens: 30 },
      content: [{ type: "text", text: "Hello! I am a mock Claude. How can I help?" }],
    },
    parent_tool_use_id: null,
    session_id: SESSION_ID,
  });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1000,
    num_turns: 2,
    result: "Hello! I am a mock Claude. How can I help?",
    session_id: SESSION_ID,
    total_cost_usd: 0.005,
    usage: { input_tokens: 50, output_tokens: 30 },
    permission_denials: [],
    uuid: "result-mock-001",
  });
  process.stdin.pause();
  setTimeout(() => { process.exit(0); }, 50);
}

process.stderr.write("[mock-claude] ready\n");
