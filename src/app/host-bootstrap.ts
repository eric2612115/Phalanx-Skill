import { resolve } from "node:path";

import type { ExecutionAdapter } from "../runtime/core.js";
import type { ExecuteLpPositionIntentHooks } from "../adapters/lp-execution.js";
import { createSkillBackedExecutor } from "../executors/skill-backed.js";
import {
  type UniswapPlannerExecutionHooks,
} from "../adapters/uniswap.js";
import type { RebalanceDemoFlowInput } from "../demo/rebalance-flow.js";

export type HostExecutorSelectionOptions = {
  readonly executor?: ExecutionAdapter;
  readonly uniswapPlannerHooks?: UniswapPlannerExecutionHooks;
  readonly lpExecutionHooks?: ExecuteLpPositionIntentHooks;
};

export type AgenticRebalanceDemoOption = {
  readonly enabled: boolean;
  readonly omRatePath: string;
  readonly chain: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly positionType?: RebalanceDemoFlowInput["positionType"];
};

export function createDryRunExecutor(
  env: NodeJS.ProcessEnv,
  uniswapPlannerHooks?: UniswapPlannerExecutionHooks,
): ExecutionAdapter {
  return {
    async execute(intent: Parameters<ExecutionAdapter["execute"]>[0]): Promise<unknown> {
      if (intent.action === "planUniswapLiquidity") {
        const { runUniswapLiquidityPlannerForPayload } = await import("../adapters/uniswap.js");
        return runUniswapLiquidityPlannerForPayload(intent.payload, env, uniswapPlannerHooks);
      }
      return {
        mode: "dry_run",
        action: intent.action,
        target: intent.target ?? null,
        payload: intent.payload,
      };
    },
  };
}

export function normalizeWhitelistTargets(targets: readonly string[]): string[] {
  const next = new Set(targets.map((target) => target.trim()).filter((target) => target.length > 0));
  next.add("whitelist-admin");
  return [...next];
}

export function parseWhitelistTargets(values: Readonly<Record<string, string | undefined>>): string[] {
  const raw = values.WHITELIST_TARGETS ?? values.PHALANX_WHITELIST_TARGETS ?? "";
  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return normalizeWhitelistTargets(parsed.length > 0 ? parsed : ["pool"]);
}

export function pickExecutor(
  options: HostExecutorSelectionOptions,
  configValues: Readonly<Record<string, string | undefined>>,
): ExecutionAdapter {
  if (options.executor) {
    return options.executor;
  }
  const env = configValues as NodeJS.ProcessEnv;
  if ((configValues.PHALANX_EXECUTION_BACKEND ?? "").trim() === "onchainos_skill") {
    return createSkillBackedExecutor({
      env,
      uniswapPlannerHooks: options.uniswapPlannerHooks,
      lpExecutionHooks: options.lpExecutionHooks,
    });
  }
  return createDryRunExecutor(env, options.uniswapPlannerHooks);
}

export function pickEventStorePath(
  explicitPath: string | undefined,
  configValues: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const explicit = explicitPath?.trim();
  if (explicit) {
    return explicit;
  }
  const raw = configValues.PHALANX_EVENT_STORE_PATH?.trim();
  return raw && raw.length > 0 ? resolve(raw) : undefined;
}

export function resolveAgenticRebalanceDemoConfig(
  explicitConfig: AgenticRebalanceDemoOption | undefined,
  configValues: Readonly<Record<string, string | undefined>>,
): AgenticRebalanceDemoOption | undefined {
  if (explicitConfig?.enabled) {
    return {
      positionType: "v3",
      ...explicitConfig,
    };
  }
  if ((configValues.PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED ?? "").trim() !== "1") {
    return undefined;
  }
  return {
    enabled: true,
    omRatePath: (configValues.PHALANX_REBALANCE_OMRATE_PATH ?? "/rebalance/opportunities").trim(),
    chain: (configValues.PHALANX_DEFAULT_CHAIN ?? "base").trim(),
    tokenA: (configValues.PHALANX_REBALANCE_TOKEN_A ?? "USDC").trim(),
    tokenB: (configValues.PHALANX_REBALANCE_TOKEN_B ?? "ETH").trim(),
    positionType: "v3",
  };
}
