import { resolve } from "node:path";

import { createPhalanxHost } from "../src/app/host.js";
import { listOnchainosCapabilities } from "../src/adapters/onchainos.js";
import { buildLpExecutionObserver } from "../src/demo/observer.js";
import {
  discoverUniswapPlannerSkill,
  executeUniswapLiquidityPlannerInvocation,
  planUniswapLiquidityPlannerInvocation,
  runUniswapLiquidityPlannerForPayload,
} from "../src/adapters/uniswap.js";
import { loadRuntimeConfigValues } from "../src/config/store.js";
import { mergePolicyItemTargets } from "../src/policy/policy-items.js";

type SmokeOutput = {
  mode: "config_driven" | "synthetic_ready";
  configPath: string;
  startup: ReturnType<ReturnType<typeof createPhalanxHost>["getStartupSummary"]>;
  skillReadiness?: {
    onchainos: unknown;
    pancakeswapOnchainos: unknown;
    uniswapPlanner: unknown;
    uniswapPlannerInvocation: unknown;
    /** Official skills CLI + DexScreener data plane via adapter (when plan is `planned`). */
    uniswapPlannerExecution: unknown;
  };
  /** Runtime MCP path: policy + executor; includes officialInvocation/dataPlane/runtimeDownstream when successful. */
  uniswapLiquidityPlanMcp?: unknown;
  lpObserver?: unknown;
  statusTool: unknown;
  portfolioTool?: unknown;
  blockedLpActionTool?: unknown;
  approvalCallback?: string;
  resumed?: unknown;
  postApprovalLpActionTool?: unknown;
  ownerWithdrawTool?: unknown;
  ownerWithdrawCallback?: string;
  ownerWithdrawResumed?: unknown;
};

function useSyntheticReady(env: NodeJS.ProcessEnv): boolean {
  return (env.PHALANX_SMOKE_SYNTHETIC_READY ?? "").trim() === "1";
}

function mergeWhitelistTargets(raw: string | undefined): string {
  const filtered =
    raw
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== "uniswap-v3")
      .join(",") ?? "";
  return mergePolicyItemTargets(filtered, ["pool", "whitelist-admin"]);
}

function extractPlannerPayloadTemplate(
  result: unknown,
): { target: string; action: string; payloadTemplate: Record<string, unknown> } | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const root = result as { ok?: boolean; data?: { adapterResult?: { runtimeDownstream?: Record<string, unknown> } } };
  if (!root.ok) {
    return undefined;
  }
  const runtimeDownstream = root.data?.adapterResult?.runtimeDownstream;
  if (!runtimeDownstream || typeof runtimeDownstream !== "object") {
    return undefined;
  }
  const target = typeof runtimeDownstream.executionTarget === "string" ? runtimeDownstream.executionTarget : undefined;
  const action = typeof runtimeDownstream.executionAction === "string" ? runtimeDownstream.executionAction : undefined;
  const payloadTemplate =
    runtimeDownstream.payloadTemplate && typeof runtimeDownstream.payloadTemplate === "object"
      ? (runtimeDownstream.payloadTemplate as Record<string, unknown>)
      : undefined;
  if (!target || !action || !payloadTemplate) {
    return undefined;
  }
  return { target, action, payloadTemplate };
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
    pancakeswapOnchainos: await listOnchainosCapabilities("bsc"),
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
        execute: async (intent) => {
          if (intent.action === "planUniswapLiquidity") {
            return runUniswapLiquidityPlannerForPayload(intent.payload, runtimeEnv);
          }
          return {
            mode: "synthetic_demo_execution",
            action: intent.action,
            target: intent.target ?? null,
            payload: intent.payload,
            txRefs: [`0x${intent.action}`],
          };
        },
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
    const plannerResult =
      output.uniswapLiquidityPlanMcp &&
      typeof output.uniswapLiquidityPlanMcp === "object" &&
      "ok" in output.uniswapLiquidityPlanMcp &&
      (output.uniswapLiquidityPlanMcp as { ok?: boolean; data?: { adapterResult?: unknown } }).ok
        ? ((output.uniswapLiquidityPlanMcp as { data?: { adapterResult?: unknown } }).data?.adapterResult as
            | Parameters<typeof buildLpExecutionObserver>[0]
            | undefined)
        : undefined;
    output.lpObserver = plannerResult ? buildLpExecutionObserver(plannerResult) : undefined;
    const plannerHandoff = extractPlannerPayloadTemplate(output.uniswapLiquidityPlanMcp);
    if (plannerHandoff && output.lpObserver && output.lpObserver.readyForExecution) {
      const lpPayload = { ...output.lpObserver.payload };
      output.blockedLpActionTool = await syntheticHost.invokeMcp("phalanx_action", {
        action: plannerHandoff.action,
        payload: lpPayload,
        target: plannerHandoff.target,
      });

      const callback = syntheticHost.getTelegramApprovalOutbox()[0]?.approveCallbackData;
      output.approvalCallback = callback;
      if (callback) {
        output.resumed = await syntheticHost.handleTelegramCallback(callback);
        output.postApprovalLpActionTool = await syntheticHost.invokeMcp("phalanx_action", {
          action: plannerHandoff.action,
          payload: lpPayload,
          target: plannerHandoff.target,
        });
      }
    }

    output.ownerWithdrawTool = await syntheticHost.invokeMcp("phalanx_action", {
      action: "withdrawToOwner",
      payload: {
        chain: "base",
        contractToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        readableAmount: "0.1",
      },
    });
    const ownerWithdrawCallback = syntheticHost.getTelegramApprovalOutbox()[0]?.approveCallbackData;
    output.ownerWithdrawCallback = ownerWithdrawCallback;
    if (ownerWithdrawCallback) {
      output.ownerWithdrawResumed = await syntheticHost.handleTelegramCallback(ownerWithdrawCallback);
    }
  } else if (output.startup.lifecycle === "READY") {
    output.portfolioTool = await host.invokeMcp("phalanx_portfolio", {});
  }

  console.log(JSON.stringify(output, null, 2));
}

await main();
