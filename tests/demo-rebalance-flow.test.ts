import { describe, expect, it, vi } from "vitest";

import {
  buildRebalanceDemoRunMetadata,
  normalizeOmRatePaidResponseToCandidates,
  runRebalanceDemoFlow,
} from "../src/demo/rebalance-flow.ts";
import type { UniswapLiquidityPlannerExecutionResult } from "../src/adapters/uniswap.ts";

function completedPlannerResult(
  payloadTemplate: Record<string, unknown>,
): UniswapLiquidityPlannerExecutionResult {
  return {
    provider: "uniswap",
    lane: "liquidity_planner_skill",
    status: "completed",
    summary: "planner_ok",
    runtimeDownstream: {
      executionTarget: "uniswap-v3",
      executionAction: "depositLpPosition",
      positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
      topUniswapPools: [
        {
          pairAddress: "0xpool000000000000000000000000000000000001",
          pairLabel: "USDC/ETH",
          version: "v3",
          dexId: "uniswap",
        },
      ],
      plannerInput: {
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        positionType: "v3",
      },
      payloadTemplate: {
        protocol: "uniswap-v3",
        chain: "base",
        investmentId: "planner-investment-id",
        token: "USDC",
        tokenSecondary: "ETH",
        amount: "",
        amountSecondary: "",
        range: "",
        positionType: "v3",
        poolAddress: "0xpool000000000000000000000000000000000001",
        ...payloadTemplate,
      },
      missingExecutionFields: ["amount", "amountSecondary", "range"],
    },
  };
}

describe("demo rebalance flow", () => {
  it("normalizes OmRate candidates from nested payloads and keeps chain in the dedupe key", () => {
    const candidates = normalizeOmRatePaidResponseToCandidates({
      data: {
        candidates: [
          {
            chain: "base",
            tokenA: "USDC",
            tokenB: "ETH",
            poolAddress: "0xpool",
            score: 10,
          },
          {
            chain: "base",
            tokenA: "USDC",
            tokenB: "ETH",
            poolAddress: "0xpool",
            score: 9,
          },
          {
            chain: "ethereum",
            tokenA: "USDC",
            tokenB: "ETH",
            poolAddress: "0xpool",
            score: 8,
          },
        ],
      },
    });

    expect(candidates).toEqual([
      {
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        poolAddress: "0xpool",
        score: 10,
        label: undefined,
      },
      {
        chain: "ethereum",
        tokenA: "USDC",
        tokenB: "ETH",
        poolAddress: "0xpool",
        score: 8,
        label: undefined,
      },
    ]);
  });

  it("builds LP handoff from runtime discovery instead of reading PHALANX_LP env defaults", async () => {
    const executeOmRateQuery = vi.fn().mockResolvedValue({
      provider: "omrate",
      status: "completed",
      summary: "http_ok:200",
      x402Requested: true,
      x402BaselineReady: true,
      paymentRequiredByServer: undefined,
      paymentWrapped: true,
      bodyPreview: JSON.stringify({
        data: {
          candidates: [
            {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              poolAddress: "0xpool000000000000000000000000000000000001",
              score: 10,
            },
          ],
        },
      }),
    });
    const executeUniswapLiquidityPlannerInvocation = vi.fn().mockResolvedValue(completedPlannerResult({}));

    const result = await runRebalanceDemoFlow(
      {
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        prepareSwap: false,
      },
      {
        env: {
          PHALANX_LP_INVESTMENT_ID: "env-only-investment-id",
          PHALANX_LP_AMOUNT: "999999",
        } as NodeJS.ProcessEnv,
        executeOmRateQuery,
        planUniswapLiquidityPlannerInvocation: vi.fn(),
        executeUniswapLiquidityPlannerInvocation,
      },
    );

    expect(result.status).toBe("ok");
    expect(result.selectedPool?.pairAddress).toBe("0xpool000000000000000000000000000000000001");
    expect(result.lpDepositPayloadSeed).toMatchObject({
      protocol: "uniswap-v3",
      chain: "base",
      investmentId: "planner-investment-id",
      poolAddress: "0xpool000000000000000000000000000000000001",
    });
    expect(result.lpDepositPayloadSeed.investmentId).not.toBe("env-only-investment-id");
    expect(result.swapPreparation.status).toBe("not_evaluated");
    expect(result.omRateExecutionEvidence.payment).toMatchObject({
      paymentRequired: false,
      paymentAttempted: false,
      paymentWrapped: true,
      paymentSettled: false,
      baselineReady: true,
    });
  });

  it("recommends a swap from runtime wallet holdings when the LP pair is not yet aligned", async () => {
    const result = await runRebalanceDemoFlow(
      {
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        prepareSwap: true,
        walletHeldTokenAddresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        lpTokenAddresses: {
          tokenA: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenB: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        preparationWalletAddress: "0x1111111111111111111111111111111111111111",
        swapAmountIn: "1000000",
      },
      {
        env: {} as NodeJS.ProcessEnv,
        executeOmRateQuery: vi.fn().mockResolvedValue({
          provider: "omrate",
          status: "completed",
          summary: "http_ok:200",
          x402Requested: true,
          x402BaselineReady: true,
          paymentRequiredByServer: undefined,
          paymentWrapped: true,
          bodyPreview: JSON.stringify({
            candidates: [{ chain: "base", tokenA: "USDC", tokenB: "ETH", score: 10 }],
          }),
        }),
        planUniswapLiquidityPlannerInvocation: vi.fn(),
        executeUniswapLiquidityPlannerInvocation: vi.fn().mockResolvedValue(
          completedPlannerResult({
            token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tokenSecondary: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          }),
        ),
      },
    );

    expect(result.swapPreparation.status).toBe("swap_recommended");
    expect(result.swapPreparation.recommendedSwapIntent).toMatchObject({
      action: "swap",
      payload: {
        chain: "base",
        wallet: "0x1111111111111111111111111111111111111111",
        fromTokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        toTokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        amount: "1000000",
        slippage: "0.5",
      },
    });
  });

  it("buildRebalanceDemoRunMetadata captures pool, swap, LP readiness, and flow status for operator surfaces", async () => {
    const executeOmRateQuery = vi.fn().mockResolvedValue({
      provider: "omrate",
      status: "completed",
      summary: "http_ok:200",
      x402Requested: true,
      x402BaselineReady: true,
      paymentRequiredByServer: true,
      paymentWrapped: false,
      bodyPreview: JSON.stringify({
        data: {
          candidates: [
            {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              poolAddress: "0xpool000000000000000000000000000000000001",
              score: 10,
            },
          ],
        },
      }),
    });
    const flow = await runRebalanceDemoFlow(
      {
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        prepareSwap: true,
        walletHeldTokenAddresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        lpTokenAddresses: {
          tokenA: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenB: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        preparationWalletAddress: "0x1111111111111111111111111111111111111111",
        swapAmountIn: "1000000",
      },
      {
        env: {} as NodeJS.ProcessEnv,
        executeOmRateQuery,
        planUniswapLiquidityPlannerInvocation: vi.fn(),
        executeUniswapLiquidityPlannerInvocation: vi.fn().mockResolvedValue(
          completedPlannerResult({
            token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tokenSecondary: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          }),
        ),
      },
    );

    const meta = buildRebalanceDemoRunMetadata(
      {
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      flow,
      {
        readyForExecution: false,
        missingExecutionFields: ["amount"],
        summary: "Needs amount",
        action: "depositLpPosition",
        target: "uniswap-v3",
      },
      { pendingApprovalId: "approval-xyz" },
    );

    expect(meta.kind).toBe("rebalance_demo_v1");
    expect(meta.flowStatus).toBe("ok");
    expect(meta.selectedPool?.pairAddress).toBe("0xpool000000000000000000000000000000000001");
    expect(meta.swapPreparation.status).toBe("swap_recommended");
    expect(meta.swapPreparation.recommendedSwapIntent?.payload.fromTokenAddress).toMatch(/0xaaaa/);
    expect(meta.lpExecution.ready).toBe(false);
    expect(meta.lpExecution.missingFields).toContain("amount");
    expect(meta.lpExecution.action).toBe("depositLpPosition");
    expect(meta.pendingApproval?.approvalId).toBe("approval-xyz");
    expect(meta.omRateSummary).toBe("http_ok:200");
    expect(meta.plannerSummary).toBe("planner_ok");
    expect(meta.omRateExecutionEvidence.payment).toMatchObject({
      paymentRequired: true,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
    });
    expect(flow.omRateExecutionEvidence.payment).toMatchObject({
      paymentRequired: true,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
    });
  });
});
