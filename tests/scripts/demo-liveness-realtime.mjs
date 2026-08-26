// ============================================================
// Functional demo: drive the REAL LivenessMonitor with REAL
// timers against a fake SocketManager — proves liveness works
// at the integration level, not just via injected fake clocks.
//
// Runs in ~3s. Expect output:
//   - "monitor started"
//   - a "socket healthy" log initially (probe passing)
//   - a "zombie socket detected" warn + onZombieDetected event
//     after the fake socket goes dead and failureLimit probes fail
//   - exit 0
// ============================================================

import { LivenessMonitor } from "../../src/liveness.js";

const logs = [];
const events = [];

// Fake SocketManager: starts connected, goes dead after 800ms.
const fakeSocketManager = {
  connected: true,
  anyConnected() {
    return this.connected;
  },
  async forceReconnectAll() {
    // Simulate a successful reconnect.
    this.connected = true;
    return true;
  },
};

setTimeout(() => {
  console.log(`[demo] ${Date.now() - t0}ms: socket going dead (zombie)`);
  fakeSocketManager.connected = false;
}, 800);

const mon = new LivenessMonitor(
  {
    tickIntervalMs: 300, // fast ticks so suspend layer also runs
    suspendJumpMs: 1000,
    probeIntervalMs: 200, // fast probes
    failureLimit: 3, // fail 3x -> zombie
  },
  {
    isConnected: () => fakeSocketManager.anyConnected(),
    log: (level, module, msg) => {
      logs.push({ level, msg });
      console.log(`[${level}] ${msg}`);
    },
    onSuspendDetected: (sec) => {
      events.push(`suspend:${sec}`);
      console.log(`[demo] onSuspendDetected(${sec}s)`);
    },
    onZombieDetected: () => {
      events.push("zombie");
      console.log("[demo] onZombieDetected -> forceReconnectAll()");
      mon.stop();
      verify();
    },
    onUnrecoverable: () => {
      events.push("unrecoverable");
      console.log("[demo] onUnrecoverable (unexpected here)");
      mon.stop();
      process.exit(2);
    },
  },
);

const t0 = Date.now();
mon.start();
console.log("[demo] monitor started");

let done = false;
function verify() {
  if (done) return;
  done = true;
  const hadZombie = events.includes("zombie");
  const hadHealthy = logs.some((l) => l.level === "info" && /socket healthy/.test(l.msg));
  const hadWarn = logs.some((l) => l.level === "warn" && /zombie socket detected/.test(l.msg));
  console.log("\n[demo] === RESULT ===");
  console.log(`[demo] events:        ${JSON.stringify(events)}`);
  console.log(`[demo] zombie fired:  ${hadZombie}`);
  console.log(`[demo] warn logged:   ${hadWarn}`);
  console.log(`[demo] healthy log:   ${hadHealthy}`);
  // We expect: healthy initial probe + zombie warn. No suspend (clicks are regular).
  const ok = hadZombie && hadWarn;
  console.log(`[demo] VERDICT: ${ok ? "PASS" : "FAIL"}`);
  // Keep the process alive long enough to see any stray late callbacks.
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
}

// Safety net: if the zombie path never fires, report FAIL after 3s.
setTimeout(() => {
  if (!done) {
    console.log("[demo] TIMEOUT: zombie never detected within 3s");
    mon.stop();
    verify();
  }
}, 3000);
