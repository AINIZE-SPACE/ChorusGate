// ============================================================
// watchdog install/uninstall — 注册系统任务自动拉起死亡的 daemon
//
// #148: 2026-08-20 6am 事故复盘——daemon 崩了没人拉。脚本
// scripts/chorusgate-watchdog.{ps1,sh} 早已存在但从未注册。
// 本命令把它挂到系统调度：
//   - Windows: schtasks 每 5 分钟跑一次 watchdog.ps1（/RL HIGHEST 提权）
//   - Linux:   systemd user timer 每 5 分钟跑一次 watchdog.sh
//
// 判断逻辑在脚本内（PID 消失 或 status.updatedAt 超时 → restart）。
// ============================================================

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./cli-args.js";
import { BIN_FILE } from "./gateway-paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const WATCHDOG_PS1 = resolve(projectRoot, "scripts", "chorusgate-watchdog.ps1");
const WATCHDOG_SH = resolve(projectRoot, "scripts", "chorusgate-watchdog.sh");
const NODE_BIN = process.execPath;

/** Scheduled-task / systemd unit name for an agent. */
export function watchdogTaskName(agentId: string): string {
  return `chorusgate-watchdog-${agentId}`;
}

function resolveAgentId(): string {
  return parseCliArgs().agentId ?? "default";
}

/** 重启命令：node <abs BIN_FILE>（绝对路径，不依赖 schtasks 的 PATH）。 */
function restartCmd(): string {
  return `${NODE_BIN} ${BIN_FILE}`;
}

// ---- Windows: Task Scheduler ------------------------------------------------

function installWindows(agentId: string): number {
  if (!existsSync(WATCHDOG_PS1)) {
    console.error(`watchdog script not found: ${WATCHDOG_PS1}`);
    return 1;
  }
  const name = watchdogTaskName(agentId);
  const binCmd = restartCmd();
  // /TR 值经 spawnSync argv 传递，调度器执行时按引号切词 → powershell -File
  // 收到 -Bin 的值为单个参数 "node E:\...\bin\chorusgate.mjs"。
  const tr =
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${WATCHDOG_PS1}" ` +
    `-Agent ${agentId} -Bin "${binCmd}"`;
  const r = spawnSync(
    "schtasks",
    [
      "/Create", "/TN", name, "/TR", tr,
      "/SC", "MINUTE", "/MO", "5",
      "/RL", "HIGHEST", "/IT", "/F",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status === 0) {
    console.error(`✔ watchdog installed: '${name}' (every 5 min, elevated)`);
    console.error(`  trigger: ${tr}`);
    return 0;
  }
  console.error(`✘ failed to install '${name}': ${out.trim()}`);
  return 1;
}

function uninstallWindows(agentId: string): number {
  const name = watchdogTaskName(agentId);
  const r = spawnSync("schtasks", ["/Delete", "/TN", name, "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status === 0) {
    console.error(`✔ watchdog uninstalled: '${name}'`);
    return 0;
  }
  // 任务不存在也算卸载成功（幂等）。
  if (/does not exist|not find|找不到/i.test(out)) {
    console.error(`✔ watchdog '${name}' not found — nothing to uninstall`);
    return 0;
  }
  console.error(`✘ failed to uninstall '${name}': ${out.trim()}`);
  return 1;
}

// ---- Linux: systemd user timer ----------------------------------------------

function installLinux(agentId: string): number {
  if (!existsSync(WATCHDOG_SH)) {
    console.error(`watchdog script not found: ${WATCHDOG_SH}`);
    return 1;
  }
  const name = watchdogTaskName(agentId);
  const unitDir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });

  const service = [
    "[Unit]",
    `Description=ChorusGate watchdog for agent '${agentId}' (#148)`,
    "",
    "[Service]",
    "Type=oneshot",
    `Environment=CHORUSGATE_BIN=${restartCmd()}`,
    `ExecStart=${WATCHDOG_SH} ${agentId}`,
    "",
  ].join("\n");
  const timer = [
    "[Unit]",
    `Description=Run ChorusGate watchdog for agent '${agentId}' every 5 min`,
    "",
    "[Timer]",
    "OnBootSec=5min",
    "OnUnitActiveSec=5min",
    "AccuracySec=30s",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");

  writeFileSync(join(unitDir, `${name}.service`), service, "utf8");
  writeFileSync(join(unitDir, `${name}.timer`), timer, "utf8");
  for (const sub of ["daemon-reload", ["enable", "--now", `${name}.timer`]]) {
    const args = Array.isArray(sub) ? sub : [sub];
    const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error(
        `✘ systemctl --user ${args.join(" ")} failed: ${((r.stderr || "") + (r.stdout || "")).trim()}`,
      );
      return 1;
    }
  }
  console.error(`✔ watchdog installed: '${name}.timer' (every 5 min)`);
  console.error(`  units: ${unitDir}/${name}.{service,timer}`);
  return 0;
}

function uninstallLinux(agentId: string): number {
  const name = watchdogTaskName(agentId);
  const r = spawnSync(
    "systemctl",
    ["--user", "disable", "--now", `${name}.timer`],
    { encoding: "utf8" },
  );
  const unitDir = join(homedir(), ".config", "systemd", "user");
  rmSync(join(unitDir, `${name}.service`), { force: true });
  rmSync(join(unitDir, `${name}.timer`), { force: true });
  if (r.status !== 0 && /Unit .* does not exist|not loaded|not found/i.test((r.stderr || "") + (r.stdout || ""))) {
    console.error(`✔ watchdog '${name}' not found — nothing to uninstall`);
    return 0;
  }
  if (r.status !== 0) {
    console.error(
      `✘ systemctl disable failed: ${((r.stderr || "") + (r.stdout || "")).trim()}`,
    );
    return 1;
  }
  console.error(`✔ watchdog uninstalled: '${name}.timer'`);
  return 0;
}

// ---- entry ------------------------------------------------------------------

/** `chorusgate watchdog install [--agent <id>]` */
export async function watchdogInstall(): Promise<void> {
  const agentId = resolveAgentId();
  console.error(`installing watchdog for agent '${agentId}'...`);
  const code =
    platform() === "win32"
      ? installWindows(agentId)
      : installLinux(agentId);
  process.exitCode = code;
}

/** `chorusgate watchdog uninstall [--agent <id>]` */
export async function watchdogUninstall(): Promise<void> {
  const agentId = resolveAgentId();
  console.error(`uninstalling watchdog for agent '${agentId}'...`);
  const code =
    platform() === "win32"
      ? uninstallWindows(agentId)
      : uninstallLinux(agentId);
  process.exitCode = code;
}
