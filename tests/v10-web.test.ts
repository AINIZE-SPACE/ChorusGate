import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createV10WebServer } from "../src/v10/web-server.ts";
import { buildEmployeeViews } from "../src/v10/employee-view.ts";
import { DeterministicFixtureAdapter } from "../src/v10/fixture-adapter.ts";
import { renderV10Page } from "../src/v10/web-page.ts";

test("V10 fixture exposes employees with status, task, event, and completion counts", () => {
  const employees = buildEmployeeViews(new DeterministicFixtureAdapter());
  assert.equal(employees.length, 2);
  assert.deepEqual(employees.map((employee) => employee.status), ["working", "blocked"]);
  assert.equal(employees[0].currentTask?.status, "running");
  assert.equal(employees[1].recentEvent.type, "approval.pending");
  assert.equal(employees[1].completions.blocked, 2);
});

test("V10 page escapes adapter-provided text", () => {
  const employee = buildEmployeeViews(new DeterministicFixtureAdapter())[0];
  const page = renderV10Page([{ ...employee, name: '<img src=x onerror="alert(1)">', runtime: '<runtime>' as typeof employee.runtime }]);
  assert.doesNotMatch(page, /<img src=x/);
  assert.match(page, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(page, /&lt;runtime&gt;/);
});

test("V10 Web server serves health, employees, page, and a 404", async (t) => {
  const server = createV10WebServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), { status: "ok", dataSource: "deterministic-fixture" });
  const api = await fetch(`${base}/api/v10/employees`);
  const body = await api.json() as { employees: Array<{ status: string; completions: { succeeded: number } }> };
  assert.equal(api.status, 200);
  assert.equal(body.employees.length, 2);
  assert.equal(body.employees[0].status, "working");
  assert.equal(body.employees[0].completions.succeeded, 12);
  const page = await fetch(`${base}/`);
  assert.match(await page.text(), /Hermes Coordinator/);
  const missing = await fetch(`${base}/unknown`);
  assert.equal(missing.status, 404);
});
