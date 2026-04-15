import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPhalanxHost } from "./app/host.js";
import { loadRuntimeConfigValues, resolveMemoryStatePath } from "./config/store.js";
import { maybeStartGuardianFromEnv } from "./guardian/service.js";
import { McpMemoryStateStore } from "./memory/mcp-memory-store.js";
import { startPhalanxMcpStdioServer } from "./mcp/stdio.js";
import { startTelegramBotPolling } from "./telegram/live.js";

function writeStartup(value: unknown, useStdErr = false): void {
  const line = `${JSON.stringify(value, null, 2)}\n`;
  if (useStdErr) {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

/**
 * AgentPhalanx runtime entry (Phalanx-Skill dry-run host for local dev).
 */
export async function main(): Promise<void> {
  const configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env");
  const runtimeEnv = loadRuntimeConfigValues(configPath, process.env);
  const memoryPath = resolveMemoryStatePath(configPath, runtimeEnv);
  const stateStore = new McpMemoryStateStore(memoryPath);
  const restoredState = await stateStore.loadLatestState().catch(() => null);
  const guardianEnabled = runtimeEnv.PHALANX_GUARDIAN_ENABLED === "1";
  const host = createPhalanxHost({
    guardianEnabled,
    configValues: runtimeEnv,
    stateStore,
    initialMemoryState: restoredState,
  });
  const summary = host.getStartupSummary();
  const useMcpStdio = runtimeEnv.PHALANX_ENABLE_MCP_STDIO === "1";
  writeStartup(
    {
      mode: summary.mode,
      runtime: summary,
    },
    useMcpStdio,
  );

  let stopTelegram: (() => void) | undefined;
  const telegramToken = host.getRuntimeConfig().telegram.botToken;
  if (summary.mode === "live" && telegramToken) {
    const telegram = startTelegramBotPolling({
      token: telegramToken,
      host,
    });
    host.bindTelegramApprovalNotifier(telegram.approvalNotifier);
    host.bindTelegramReportNotifier(telegram.reportNotifier);
    void telegram.start();
    stopTelegram = () => telegram.stop();
  }

  if (useMcpStdio) {
    void startPhalanxMcpStdioServer(host).catch((error) => {
      console.error("Failed to start MCP stdio transport:", error);
    });
  }

  const stopGuardian = maybeStartGuardianFromEnv(host, runtimeEnv as NodeJS.ProcessEnv, {
    stateStore,
  });
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  if (runtimeEnv.PHALANX_DRY_RUN_KEEPALIVE !== "0") {
    keepAlive = setInterval(() => {}, 60_000);
  }

  const cleanup = () => {
    stopTelegram?.();
    if (stopGuardian !== undefined) {
      stopGuardian();
    }
    if (keepAlive !== undefined) {
      clearInterval(keepAlive);
    }
  };

  if (stopGuardian !== undefined) {
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  } else if (keepAlive !== undefined || stopTelegram !== undefined) {
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
}

function isDirectExecution(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  void main();
}
