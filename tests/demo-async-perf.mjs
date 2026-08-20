// ============================================================
// demo-async-perf.mjs — 异步交互性能演示
//
// 场景：ChorusGate gateway 事件循环同时收到 N 条 Slack 消息，
//       每条消息需经过 agent 处理（这里用 150ms 模拟一次 agent 往返）。
// 对比两种处理方式：
//   A. 串行（await 逐个处理）— 总耗时 ≈ N × 150ms
//   B. 异步并发（事件循环不阻塞，I/O 等待时切换）— 总耗时 ≈ 150ms + 开销
//
// 运行：node tests/demo-async-perf.mjs
// ============================================================

const N = 10;                       // 消息条数
const PER_MSG_MS = 150;             // 单条 agent 往返耗时（模拟）
const CONCURRENCY = N;              // 并发数

// 模拟一条 Slack 消息的异步处理（真实场景是 spawn agent + 流式响应，
// 这里用 setTimeout 表示"等 I/O"，期间事件循环可以处理其他消息）
function handleMessage(id) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(`msg-${id} done`), PER_MSG_MS);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serial() {
  const t0 = performance.now();
  const results = [];
  for (let i = 0; i < N; i++) results.push(await handleMessage(i));
  const dt = performance.now() - t0;
  return { dt, count: results.length };
}

async function concurrent() {
  const t0 = performance.now();
  // Promise.all：一次性把 N 个异步任务丢给事件循环，I/O 等待期并行
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => handleMessage(i))
  );
  const dt = performance.now() - t0;
  return { dt, count: results.length };
}

// 串行并发各跑 3 次取中位数，避免单次抖动
async function bench(fn) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const r = await fn();
    samples.push(r.dt);
    await sleep(20);
  }
  samples.sort((a, b) => a - b);
  return samples[1]; // 中位数
}

const serialMs = await bench(serial);
const concMs = await bench(concurrent);

console.log(`模拟 ${N} 条 Slack 消息并发到达，单条 agent 往返 ${PER_MSG_MS}ms`);
console.log(`- 串行处理（await 逐个）      : ${serialMs.toFixed(1)}ms  (≈ ${Math.round(serialMs)}ms = ${N} × ${PER_MSG_MS}ms)`);
console.log(`- 异步并发（事件循环并行 I/O）: ${concMs.toFixed(1)}ms`);
console.log(`- 提速：${(serialMs / concMs).toFixed(1)}×（${Math.round(serialMs / concMs)} 条消息共享同一段等待）`);
console.log("");
console.log("原理：单条处理耗时是 I/O 等待（agent 生成响应期间 CPU 空闲），");
console.log("Node 事件循环在等待期不阻塞，可以同时推进其他消息的 I/O。");
console.log("这就是 ChorusGate 用单个进程就能同时服务多个 agent 会话的原因。");
