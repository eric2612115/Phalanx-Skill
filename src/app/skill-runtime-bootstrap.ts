import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSkillBootstrapConfig } from "../config/runtime-config.js";
import { McpMemoryStateStore } from "../memory/mcp-memory-store.js";
import { startPhalanxMcpStdioServer } from "../mcp/stdio.js";
import { createSkillHost } from "./skill-host.js";

function writeStartup(value: unknown, useStdErr = false): void {
  const line = `${JSON.stringify(value, null, 2)}\n`;
  if (useStdErr) {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

/**
 * Skill-only bootstrap for the `Phalanx-Skill` kernel.
 * This path intentionally does not start Telegram polling or guardian loops.
 */
export async function main(): Promise<void> {
  const configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env");
  const bootstrap = loadSkillBootstrapConfig(configPath, process.env);
  const stateStore = new McpMemoryStateStore(bootstrap.runtimeStatePath);
  const restoredState = await stateStore.loadLatestRuntimeState().catch(() => null);
  const skillHost = createSkillHost({
    configValues: bootstrap.values,
    guardianEnabled: false,
    stateStore,
    initialMemoryState: restoredState,
  });
  const summary = skillHost.runtime.getStartupSummary();
  const useMcpStdio = bootstrap.values.PHALANX_ENABLE_MCP_STDIO === "1";
  writeStartup(
    {
      mode: summary.mode,
      runtime: summary,
      ownership: {
        telegram: "external",
        guardian: "external",
      },
    },
    useMcpStdio,
  );

  if (useMcpStdio) {
    void startPhalanxMcpStdioServer(skillHost.runtime).catch((error) => {
      console.error("Failed to start MCP stdio transport:", error);
    });
  }

  let keepAlive: ReturnType<typeof setInterval> | undefined;
  if (bootstrap.values.PHALANX_DRY_RUN_KEEPALIVE !== "0") {
    keepAlive = setInterval(() => {}, 60_000);
  }

  if (keepAlive !== undefined) {
    const cleanup = () => {
      clearInterval(keepAlive);
    };
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
