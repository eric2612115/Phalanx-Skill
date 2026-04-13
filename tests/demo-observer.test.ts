import { describe, expect, it } from "vitest";

import { buildLpExecutionObserver } from "../src/demo/observer.ts";
import type { UniswapLiquidityPlannerExecutionResult } from "../src/adapters/uniswap.ts";

function plannerResult(
  missingExecutionFields: readonly ("investmentId" | "amount" | "amountSecondary" | "range")[],
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
      topUniswapPools: [],
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
        ...payloadTemplate,
      },
      missingExecutionFields,
    },
  };
}

describe("demo observer", () => {
  it("preserves planner payload as-is and reports missing execution fields without env fallback", () => {
    const observer = buildLpExecutionObserver(
      plannerResult(["amount", "amountSecondary", "range"], {
        investmentId: "planner-investment-id",
        amount: "",
        amountSecondary: "",
        range: "",
      }),
    );

    expect(observer).toMatchObject({
      readyForExecution: false,
      target: "uniswap-v3",
      action: "depositLpPosition",
      missingExecutionFields: ["amount", "amountSecondary", "range"],
    });
    expect(observer?.payload).toMatchObject({
      investmentId: "planner-investment-id",
      amount: "",
      amountSecondary: "",
      range: "",
    });
  });

  it("marks observer ready when planner downstream is already execution-complete", () => {
    const observer = buildLpExecutionObserver(
      plannerResult([], {
        amount: "1000000",
        amountSecondary: "500000000000000",
        range: "5",
      }),
    );

    expect(observer).toMatchObject({
      readyForExecution: true,
      missingExecutionFields: [],
      action: "depositLpPosition",
    });
  });
});
