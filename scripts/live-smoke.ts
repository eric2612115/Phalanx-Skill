import { resolve } from "node:path";

import { createPhalanxHost } from "../src/app/host.js";
import { listOnchainosCapabilities } from "../src/adapters/onchainos.js";
import {
  discoverUniswapPlannerSkill,
  executeUniswapLiquidityPlannerInvocation,
  planUniswapLiquidityPlannerInvocation,
} from "../src/adapters/uniswap.js";
import { loadRuntimeConfigValues } from "../src/config/store.js";
import { mergePolicyItemTargets } from "../src/policy/policy-items.js";

type SmokeOutput = {
  mode: "config_driven" | "synthetic_ready";
  configPath: string;
  startup: ReturnType<ReturnType<typeof createPhalanxHost>["getStartupSummary"]>;
  skillReadiness?: {
    onchainos: unknown;
    uniswapPlanner: unknown;
    uniswapPlannerInvocation: unknown;
    /** Official skills CLI + DexScreener data plane via adapter (when plan is `planned`). */
    uniswapPlannerExecution: unknown;
  };
  /** Runtime MCP path: policy + executor; includes officialInvocation/dataPlane/runtimeDownstream when successful. */
  uniswapLiquidityPlanMcp?: unknown;
  statusTool: unknown;
  portfolioTool?: unknown;
  actionTool?: unknown;
  governanceActionTool?: unknown;
  approvalCallback?: string;
  resumed?: unknown;
  postGovernanceActionTool?: unknown;
};

function useSyntheticReady(env: NodeJS.ProcessEnv): boolean {
  return (env.PHALANX_SMOKE_SYNTHETIC_READY ?? "").trim() === "1";
}

function mergeWhitelistTargets(raw: string | undefined): string {
  return mergePolicyItemTargets(raw, ["pool", "whitelist-admin", "uniswap-v3"]);
}

async function main(): Promise<void> {
  const configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env");
  const runtimeEnv = loadRuntimeConfigValues(configPath, process.env);
  const host = createPhalanxHost({
    configValues: runtimeEnv,
  });

  const output: SmokeOutput = {
    mode: "config_driven",
    configPath,
    startup: host.getStartupSummary(),
    statusTool: undefined,
  };

  const uniswapPlannerInvocation = planUniswapLiquidityPlannerInvocation(
    {
      chain: "base",
      tokenA: "ETH",
      tokenB: "USDC",
      positionType: "v3",
    },
    runtimeEnv,
  );
  output.skillReadiness = {
    onchainos: await listOnchainosCapabilities("base"),
    uniswapPlanner: discoverUniswapPlannerSkill(runtimeEnv),
    uniswapPlannerInvocation,
    uniswapPlannerExecution: await executeUniswapLiquidityPlannerInvocation(
      uniswapPlannerInvocation,
      runtimeEnv,
    ),
  };

  const status = await host.invokeMcp("phalanx_status", {});
  output.statusTool = status;

  if (useSyntheticReady(runtimeEnv)) {
    const syntheticHost = createPhalanxHost({
      lifecycle: "READY",
      configValues: {
        ...runtimeEnv,
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_ALLOWED_USER_ID: runtimeEnv.TELEGRAM_ALLOWED_USER_ID ?? "1",
        WHITELIST_TARGETS: mergeWhitelistTargets(runtimeEnv.WHITELIST_TARGETS),
      },
      executor: {
        execute: async (intent) => ({
          mode: "synthetic_demo_execution",
          action: intent.action,
          target: intent.target ?? null,
          payload: intent.payload,
          txRefs: [`0x${intent.action}`],
        }),
      },
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "synthetic_governance_write_confirmed",
        txHash: "0xsyntheticgovernance",
      }),
    });

    output.mode = "synthetic_ready";
    output.startup = syntheticHost.getStartupSummary();
    output.statusTool = await syntheticHost.invokeMcp("phalanx_status", {});
    output.portfolioTool = await syntheticHost.invokeMcp("phalanx_portfolio", {});
    output.uniswapLiquidityPlanMcp = await syntheticHost.invokeMcp("phalanx_uniswap_liquidity_plan", {
      chain: "base",
      tokenA: "USDC",
      tokenB: "ETH",
      positionType: "v3",
    });
    output.actionTool = await syntheticHost.invokeMcp("phalanx_action", {
      action: "swap",
      payload: {
        fromTokenAddress: "0x1111111111111111111111111111111111111111",
        toTokenAddress: "0x2222222222222222222222222222222222222222",
        readableAmount: "1.5",
        chain: "base",
      },
      target: "uniswap-v3",
    });
    const governancePayload = {
      fromTokenAddress: "0x1111111111111111111111111111111111111111",
      toTokenAddress: "0x2222222222222222222222222222222222222222",
      readableAmount: "1.5",
      chain: "bsc",
      contractAddress: "0x3333333333333333333333333333333333333333",
    };
    output.governanceActionTool = await syntheticHost.invokeMcp("phalanx_action", {
      action: "swap",
      payload: governancePayload,
      target: "pancakeswap-v3",
    });

    const callback = syntheticHost.getTelegramApprovalOutbox()[0]?.approveCallbackData;
    output.approvalCallback = callback;
    if (callback) {
      output.resumed = await syntheticHost.handleTelegramCallback(callback);
      output.postGovernanceActionTool = await syntheticHost.invokeMcp("phalanx_action", {
        action: "swap",
        payload: governancePayload,
        target: "pancakeswap-v3",
      });
    }
  } else if (output.startup.lifecycle === "READY") {
    output.portfolioTool = await host.invokeMcp("phalanx_portfolio", {});
  }

  console.log(JSON.stringify(output, null, 2));
}

await main();
