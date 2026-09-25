import { createServer, type Server } from "node:http";
import { DeterministicFixtureAdapter } from "./fixture-adapter.js";
import { buildEmployeeViews } from "./employee-view.js";
import { renderV10Page } from "./web-page.js";
import type { HrsObservationAdapter } from "./types.js";

export function createV10WebServer(adapter: HrsObservationAdapter = new DeterministicFixtureAdapter()): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const employees = buildEmployeeViews(adapter);
    if (path === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", dataSource: "deterministic-fixture" }));
      return;
    }
    if (path === "/api/v10/employees") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ dataSource: "deterministic-fixture", employees }));
      return;
    }
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderV10Page(employees));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

// tsx may normalize the entry-point URL differently on Windows, so use the
// explicit source-file suffix instead of comparing two independently encoded URLs.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/v10/web-server.ts")) {
  const configuredPort = process.env.V10_WEB_PORT ?? "4310";
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`V10_WEB_PORT must be an integer from 1 to 65535; received ${configuredPort}`);
  }
  createV10WebServer().listen(port, "127.0.0.1", () => {
    console.log(`ChorusGate V10 demo: http://127.0.0.1:${port}`);
  });
}
