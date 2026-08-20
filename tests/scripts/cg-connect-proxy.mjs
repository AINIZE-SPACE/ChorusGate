// Minimal HTTP CONNECT proxy for L4 ST-NR-106.
// Routes the sit-nr daemon's Slack traffic through a localhost tunnel so we can
// inject a mid-session network outage (kill proxy) and recovery (restart proxy)
// ISOLATED to the test daemon — never touching production claude/codex.
// Usage: node cg-connect-proxy.mjs [port]
import { createServer } from "node:net";
import { connect } from "node:net";

const PORT = Number(process.argv[2] || process.env.PORT || 17900);
const server = createServer((client) => {
  client.once("data", (buf) => {
    const req = buf.toString("utf8");
    const m = /^CONNECT ([^:\s]+):(\d+) HTTP\/1\.1/i.exec(req);
    if (!m) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const host = m[1];
    const port = m[2];
    const upstream = connect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  });
  client.on("error", () => {});
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[cg-proxy] CONNECT proxy listening on 127.0.0.1:${PORT}`);
});
