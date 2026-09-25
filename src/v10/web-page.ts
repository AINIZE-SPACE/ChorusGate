import type { EmployeeView } from "./types.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] as string);
}

export function renderV10Page(employees: readonly EmployeeView[]): string {
  const cards = employees.map((employee) => {
    const task = employee.currentTask
      ? `${employee.currentTask.title} (${employee.currentTask.status})`
      : "No active task";
    const statusClass = ["active", "working", "blocked", "offline"].includes(employee.status)
      ? employee.status
      : "offline";
    return `<article class="card"><h2>${escapeHtml(employee.name)}</h2><p><b>${escapeHtml(employee.runtime)}</b> <span class="status ${statusClass}">${escapeHtml(employee.status)}</span></p><p><b>Current task:</b> ${escapeHtml(task)}</p><p><b>Recent event:</b> ${escapeHtml(employee.recentEvent.type)} — ${escapeHtml(employee.recentEvent.summary)}</p><dl><div><dt>Completed</dt><dd>${employee.completions.succeeded}</dd></div><div><dt>Failed</dt><dd>${employee.completions.failed}</dd></div><div><dt>Blocked</dt><dd>${employee.completions.blocked}</dd></div></dl></article>`;
  }).join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChorusGate V10 Runtime View</title><style>body{font:16px system-ui,sans-serif;margin:0;background:#101827;color:#e6edf7}main{max-width:1000px;margin:48px auto;padding:0 24px}.notice{color:#a9c7ff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}.card{background:#1c283b;border:1px solid #34445e;border-radius:12px;padding:20px}h1,h2{margin-top:0}.status{padding:3px 8px;border-radius:999px;background:#52616f}.working{background:#176b53}.blocked{background:#93413e}dl{display:flex;gap:28px}dt{color:#aab8cd}dd{font-size:1.5rem;margin:2px 0}</style></head><body><main><h1>ChorusGate V10 — Runtime observation</h1><p class="notice">Demo data: deterministic local fixture. This page does not connect to Slack, Soul, gbrain, agents_memory, mem0, or a production runtime.</p><section class="grid">${cards}</section></main></body></html>`;
}
