/**
 * Whitelist deploy contract: does not auto-run foundry/cast or bypass Docker review.
 * Optional PHALANX_WHITELIST_DEPLOY_CMD may be set to an explicit approved command string (parsed via `parseShellCommandWords` in the whitelist adapter).
 */

import { resolve } from "node:path";

import { ConfigStore, resolveServiceConfigPath } from "../src/config/store.js";
import {
  buildWhitelistContractLiveConfig,
  parseShellCommandWords,
} from "../src/adapters/whitelist-contract.js";

import { isExecutedDirectly, runProbeCommand } from "./probe-shared.js";

export type DeployWhitelistResult = {
  script: "deploy-whitelist";
  status: "unsupported" | "tool_missing" | "failed" | "completed";
  summary: string;
  command?: string[];
  exitCode?: number | null;
  policyAddress?: string;
  configWriteback?: {
    updated: boolean;
    configPath: string;
  };
  /** Post-deploy live read readiness (viem path); independent of deploy command success. */
  whitelistContractLive?: ReturnType<typeof buildWhitelistContractLiveConfig>;
};

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function extractWhitelistPolicyAddress(output: string): string | null {
  const matches = output.match(/0x[a-fA-F0-9]{40}/g);
  return matches?.at(-1) ?? null;
}

export function writeWhitelistPolicyAddressToConfig(
  policyAddress: string,
  configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env"),
): { updated: boolean; configPath: string } {
  const store = new ConfigStore(resolveServiceConfigPath(configPath, process.env));
  store.updateValidated({ WHITELIST_POLICY_ADDRESS: policyAddress }, () => null);
  return {
    updated: true,
    configPath: resolveServiceConfigPath(configPath, process.env),
  };
}

export async function runDeployWhitelist(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeployWhitelistResult> {
  const liveHint = buildWhitelistContractLiveConfig(env);
  const cmd = parseShellCommandWords(env.PHALANX_WHITELIST_DEPLOY_CMD);
  if (!cmd) {
    return {
      script: "deploy-whitelist",
      status: "unsupported",
      summary:
        "No PHALANX_WHITELIST_DEPLOY_CMD set; on-chain deploy is not executed to avoid bypassing Docker review baselines.",
      whitelistContractLive: liveHint,
    };
  }

  const [bin, ...args] = cmd;
  if (!bin) {
    return {
      script: "deploy-whitelist",
      status: "failed",
      summary: "PHALANX_WHITELIST_DEPLOY_CMD parsed to an empty command",
      whitelistContractLive: liveHint,
    };
  }

  const record = await runProbeCommand(bin, args, { timeoutMs: 600_000 });
  if (record.spawnError?.code === "ENOENT") {
    return {
      script: "deploy-whitelist",
      status: "tool_missing",
      summary: `Deploy binary not found on PATH: ${bin}`,
      command: cmd,
      whitelistContractLive: liveHint,
    };
  }

  if (!record.ok) {
    return {
      script: "deploy-whitelist",
      status: "failed",
      summary: (record.stderr || record.stdout || "deploy command failed").replace(/\s+/g, " ").trim(),
      command: cmd,
      exitCode: record.exitCode,
      whitelistContractLive: liveHint,
    };
  }

  const combinedOutput = `${record.stdout}\n${record.stderr}`;
  const policyAddress = extractWhitelistPolicyAddress(combinedOutput);
  const configWriteback = policyAddress ? writeWhitelistPolicyAddressToConfig(policyAddress) : undefined;

  return {
    script: "deploy-whitelist",
    status: "completed",
    summary: policyAddress
      ? "Deploy command exited successfully and whitelist policy address was written to service.env"
      : "Deploy command exited successfully",
    command: cmd,
    exitCode: record.exitCode,
    ...(policyAddress ? { policyAddress } : {}),
    ...(configWriteback ? { configWriteback } : {}),
    whitelistContractLive: liveHint,
  };
}

async function main(): Promise<void> {
  const result = await runDeployWhitelist();
  printJson(result);
  if (result.status === "failed" || result.status === "tool_missing") {
    process.exitCode = 2;
  }
}

if (isExecutedDirectly(import.meta.url)) {
  await main();
}
