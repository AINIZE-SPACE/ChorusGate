// ============================================================
// PlanTracker + Claude plan detection tests
// 跟踪: [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { PlanTracker } from "../src/plan-tracker.js";
import { ClaudeEventParser } from "../src/providers/claude-parser.js";

// ---- PlanTracker -----------------------------------------------------------

test("PlanTracker parses todo JSON result", () => {
  const tracker = new PlanTracker();
  const entries = tracker.parseTodoResult(JSON.stringify({
    todos: [
      { id: "1", content: "分析代码", status: "in_progress" },
      { id: "2", content: "编写测试", status: "pending" },
      { id: "3", content: "更新文档", status: "completed" },
    ],
  }));
  assert.ok(entries);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].status, "in_progress");
  assert.equal(entries[1].status, "pending");
  assert.equal(entries[2].status, "completed");
});

test("PlanTracker updatePlan returns rendered text", () => {
  const tracker = new PlanTracker();
  const update = tracker.updatePlan("C123:thread1", [
    { id: "1", content: "分析代码", status: "in_progress" },
    { id: "2", content: "编写测试", status: "pending" },
  ]);
  assert.ok(update);
  assert.ok(update.changed);
  assert.ok(update.text.includes("📋"));
  assert.ok(update.text.includes("🔄"));
  assert.ok(update.text.includes("⏳"));
  assert.ok(update.text.includes("分析代码"));
  assert.ok(update.text.includes("0/2 完成"));
  assert.ok(update.text.includes("1 进行中"));
});

test("PlanTracker updatePlan detects no change", () => {
  const tracker = new PlanTracker();
  const entries = [{ id: "1", content: "任务A", status: "pending" as const }];

  const u1 = tracker.updatePlan("key", entries);
  assert.ok(u1?.changed);

  const u2 = tracker.updatePlan("key", entries);
  assert.ok(u2);
  assert.equal(u2.changed, false);
});

test("PlanTracker clears session", () => {
  const tracker = new PlanTracker();
  tracker.updatePlan("key", [{ id: "1", content: "任务A", status: "pending" }]);
  tracker.clear("key");

  const update = tracker.updatePlan("key", [{ id: "2", content: "任务B", status: "pending" }]);
  assert.ok(update?.changed); // fresh start
});

test("PlanTracker plan message ts get/set", () => {
  const tracker = new PlanTracker();
  assert.equal(tracker.getPlanMessageTs("key"), undefined);

  tracker.setPlanMessageTs("key", "123.456");
  assert.equal(tracker.getPlanMessageTs("key"), "123.456");
});

// ---- ClaudeEventParser plan detection --------------------------------------

test("ClaudeEventParser detects TodoWrite tool_use", () => {
  const parser = new ClaudeEventParser();
  let planFired = false;

  parser.onPlanUpdate = (plan) => {
    planFired = true;
    assert.equal(plan.entries.length, 2);
    assert.equal(plan.entries[0].content, "分析代码");
    assert.equal(plan.entries[0].status, "in_progress");
  };

  parser.feed(JSON.stringify({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "TodoWrite",
        id: "toolu_001",
        input: {
          todos: [
            { id: "1", content: "分析代码", status: "in_progress" },
            { id: "2", content: "编写测试", status: "pending" },
          ],
        },
      }],
    },
  }));

  assert.ok(planFired);
});

test("ClaudeEventParser ignores non-todo tools", () => {
  const parser = new ClaudeEventParser();
  let planFired = false;
  parser.onPlanUpdate = () => { planFired = true; };

  parser.feed(JSON.stringify({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Bash",
        id: "toolu_002",
        input: { command: "ls" },
      }],
    },
  }));

  assert.equal(planFired, false);
});

test("ClaudeEventParser parses tasks array (alternative format)", () => {
  const parser = new ClaudeEventParser();
  let planFired = false;

  parser.onPlanUpdate = (plan) => {
    planFired = true;
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.entries[0].content, "task1");
  };

  parser.feed(JSON.stringify({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "todo",
        id: "toolu_003",
        input: {
          tasks: [{ id: "t1", content: "task1", status: "in_progress" }],
        },
      }],
    },
  }));

  assert.ok(planFired);
});

test("PlanTracker ignores non-todo JSON", () => {
  const tracker = new PlanTracker();
  assert.equal(tracker.parseTodoResult("just some text"), null);
  assert.equal(tracker.parseTodoResult(""), null);
  assert.equal(tracker.parseTodoResult(JSON.stringify({ foo: "bar" })), null);
});

test("PlanTracker renders completed/cancelled with strikethrough", () => {
  const tracker = new PlanTracker();
  const update = tracker.updatePlan("key", [
    { id: "1", content: "task1", status: "completed" },
    { id: "2", content: "task2", status: "cancelled" },
    { id: "3", content: "task3", status: "in_progress" },
  ]);
  assert.ok(update?.text.includes("✅ ~task1~"));
  assert.ok(update?.text.includes("❌ ~task2~"));
  assert.ok(update?.text.includes("*task3*"));
  assert.ok(update?.text.includes("2/3 完成"));
});
