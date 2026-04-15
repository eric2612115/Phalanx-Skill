import { describe, expect, it, vi } from "vitest";
import {
  executeGuardianAllocationMainline,
  type AllocationMainlineStageKey,
} from "../src/demo/allocation-mainline.js";
import type { RebalanceDemoFlowResult } from "../src/demo/rebalance-flow.js";
import type { RuntimeEvent } from "../src/runtime/events.js";
import type { WalletEvidence } from "../src/runtime/execution-evidence.js";
import {
  assertAllocationMainlineSmokeEnv,
  buildAllocationMainlineProof,
  collectGroupedTxRefsFromRuntimeEvents,
} from "../scripts/smoke-allocation-mainline.ts";

function baseFlow(overrides?: Partial<RebalanceDemoFlowResult>): RebalanceDemoFlowResult {
  return {
    status: "ok",
    omRate: {
      provider: "omrate",
      status: "completed",
      summary: "http_ok:200",
    },
    omRateExecutionEvidence: {
      payment: {
        mode: "x402_required",
        paymentRequired: true,
        baselineReady: true,
        paymentAttempted: true,
        paymentWrapped: true,
        paymentSettled: true,
        summary: "paid",
      },
      milestones: {
        omrate_requested: true,
        x402_required: true,
        x402_payment_attempted: true,
        x402_payment_settled: true,
      },
    },
    omRateCandidates: [
      {
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        poolAddress: "0xpool000000000000000000000000000000000001",
        score: 10,
      },
    ],
    planner: {
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
          amount: "1000000",
          amountSecondary: "500000000000000",
          range: "5",
          positionType: "v3",
          poolAddress: "0xpool000000000000000000000000000000000001",
        },
        missingExecutionFields: [],
      },
    },
    selectedPool: {
      pairAddress: "0xpool000000000000000000000000000000000001",
      pairLabel: "USDC/ETH",
      version: "v3",
      dexId: "uniswap",
    },
    swapPreparation: {
      kind: "swap_preparation",
      status: "assets_match",
      summary: "aligned",
    },
    lpDepositPayloadSeed: {
      protocol: "uniswap-v3",
      chain: "base",
      investmentId: "planner-investment-id",
      token: "USDC",
      tokenSecondary: "ETH",
      amount: "1000000",
      amountSecondary: "500000000000000",
      range: "5",
      poolAddress: "0xpool000000000000000000000000000000000001",
    },
    summaries: { omRate: "ok", planner: "ok" },
    ...overrides,
  };
}

describe("allocation mainline", () => {
  it("stages funding through portfolio push readiness when execution succeeds", async () => {
    const published: RuntimeEvent[] = [];
    const res = await executeGuardianAllocationMainline(
      {
        demoInput: {
          omRatePath: "/rebalance/opportunities",
          chain: "base",
          tokenA: "USDC",
          tokenB: "ETH",
          positionType: "v3",
          prepareSwap: true,
        },
        guardianReason: "drift",
      },
      {
        runRebalanceDemo: vi.fn().mockResolvedValue(baseFlow()),
        assessFundingReadiness: () => ({ ok: true, summary: "wallet ok" }),
        publishRuntimeEvent: async (e) => {
          published.push(e);
        },
        invokePhalanxAction: vi.fn().mockImplementation(async ({ action }) => {
          if (action === "executeRebalance") {
            return {
              ok: true,
              kind: "executed",
              adapterResult: {
                mode: "rebalance_executed",
                legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
              },
            };
          }
          if (action === "depositLpPosition") {
            return { ok: true, kind: "executed", adapterResult: { provider: "test", txRefs: ["0xlp"] } };
          }
          return { ok: false, code: "UNEXPECTED", message: action };
        }),
      },
    );

    expect(res.outcome.type).toBe("executed");
    const order = res.stages.map((s) => s.stage);
    const expected: AllocationMainlineStageKey[] = [
      "funding_readiness",
      "omrate_intelligence",
      "x402_payment_evidence",
      "allocation_decisions",
      "aave_execution",
      "morpho_execution",
      "uniswap_lp_attempt",
      "whitelist_approval_pause",
      "approval_resume",
      "lp_completion",
      "grouped_reporting_readiness",
      "portfolio_push_readiness",
    ];
    expect(order).toEqual(expected);
    expect(res.stages.every((s) => s.status === "ok")).toBe(true);
    expect(published.some((e) => e.stage === "guardian_detected")).toBe(true);
    expect(res.demoRun?.omRateExecutionEvidence.milestones?.portfolio_push_sent).toBeUndefined();
    expect(res.demoRun?.omRateExecutionEvidence.milestones?.portfolio_push_ready).toBe(true);
  });

  it("marks omrate stage blocked when paid query did not complete", async () => {
    const res = await executeGuardianAllocationMainline(
      {
        demoInput: {
          omRatePath: "/x",
          chain: "base",
          tokenA: "USDC",
          tokenB: "ETH",
          prepareSwap: false,
        },
        guardianReason: "drift",
      },
      {
        runRebalanceDemo: vi.fn().mockResolvedValue(
          baseFlow({
            status: "omrate_not_completed",
            omRate: { provider: "omrate", status: "failed", summary: "http_402" },
            omRateExecutionEvidence: {
              payment: {
                mode: "x402_required",
                paymentRequired: true,
                baselineReady: true,
                paymentAttempted: false,
                paymentWrapped: false,
                paymentSettled: false,
                summary: "blocked",
              },
              milestones: { omrate_requested: true, x402_required: true },
            },
          }),
        ),
        publishRuntimeEvent: async () => {},
        invokePhalanxAction: vi.fn(),
      },
    );

    expect(res.outcome.type).toBe("blocked");
    expect(res.stages.find((s) => s.stage === "omrate_intelligence")?.status).toBe("blocked");
  });

  it("returns pending_approval with guardian context when LP requires whitelist approval", async () => {
    const res = await executeGuardianAllocationMainline(
      {
        demoInput: {
          omRatePath: "/rebalance/opportunities",
          chain: "base",
          tokenA: "USDC",
          tokenB: "ETH",
          prepareSwap: true,
        },
        guardianReason: "drift",
      },
      {
        runRebalanceDemo: vi.fn().mockResolvedValue(baseFlow()),
        publishRuntimeEvent: async () => {},
        invokePhalanxAction: vi.fn().mockImplementation(async ({ action }) => {
          if (action === "executeRebalance") {
            return {
              ok: true,
              kind: "executed",
              adapterResult: {
                mode: "rebalance_executed",
                legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
              },
            };
          }
          if (action === "depositLpPosition") {
            return { ok: true, kind: "pending_approval", approvalId: "appr-1", intentId: "deposit-lp-intent" };
          }
          return { ok: false, code: "UNEXPECTED", message: action };
        }),
      },
    );

    expect(res.outcome.type).toBe("pending_approval");
    if (res.outcome.type === "pending_approval") {
      expect(res.outcome.intentId).toBe("deposit-lp-intent");
    }
    expect(res.guardianApprovalContext?.approvalId).toBe("appr-1");
    expect(res.guardianApprovalContext?.resumedAction).toBe("depositLpPosition");
    const pause = res.stages.find((s) => s.stage === "whitelist_approval_pause");
    expect(pause?.status).toBe("ok");
    const resume = res.stages.find((s) => s.stage === "approval_resume");
    expect(resume?.status).toBe("skipped");
  });

  it("blocks funding readiness when wallet signal facts are absent", async () => {
    const res = await executeGuardianAllocationMainline(
      {
        demoInput: {
          omRatePath: "/rebalance/opportunities",
          chain: "base",
          tokenA: "USDC",
          tokenB: "ETH",
          prepareSwap: true,
        },
        guardianReason: "drift",
      },
      {
        runRebalanceDemo: vi.fn().mockResolvedValue(baseFlow()),
        assessFundingReadiness: () => ({
          ok: false,
          summary: "Funding readiness failed: no wallet signal or amount facts were available.",
        }),
        publishRuntimeEvent: async () => {},
        invokePhalanxAction: vi.fn(),
      },
    );

    expect(res.outcome.type).toBe("blocked");
    expect(res.stages[0]?.stage).toBe("funding_readiness");
    expect(res.stages[0]?.status).toBe("blocked");
  });
});

describe("allocation mainline smoke proof", () => {
  const walletEvidence: WalletEvidence = {
    resolvedAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source: "explicit_override",
    chain: "base",
    reason: "explicit_env_wallet_override_active",
    overrideActive: true,
  };

  it("buildAllocationMainlineProof includes wallet, payment, milestones, grouped tx refs, and human summary", () => {
    const stages = [
      { stage: "funding_readiness" as const, status: "ok" as const, summary: "ok" },
      { stage: "omrate_intelligence" as const, status: "ok" as const, summary: "om" },
    ];
    const proof = buildAllocationMainlineProof({
      profile: "allocation_mainline",
      walletEvidence,
      payment: {
        mode: "x402_required",
        paymentRequired: true,
        baselineReady: true,
        paymentAttempted: true,
        paymentWrapped: true,
        paymentSettled: true,
        summary: "paid",
      },
      milestones: { omrate_requested: true, aave_executed: true },
      stages,
      outcomeType: "executed",
      runtimeEvents: [
        {
          eventId: "e1",
          createdAt: "2026-01-01T00:00:00.000Z",
          correlationId: "c1",
          intentId: "i1",
          action: "executeRebalance",
          entrySource: "mcp",
          target: "pool",
          stage: "executed",
          summary: "rebalance",
          txRefs: ["0xaa", "0xbb"],
        },
        {
          eventId: "e2",
          createdAt: "2026-01-01T00:00:01.000Z",
          correlationId: "c2",
          intentId: "i2",
          action: "depositLpPosition",
          entrySource: "mcp",
          target: "uniswap-v3",
          stage: "executed",
          summary: "lp",
          txRefs: ["0xcc"],
        },
      ],
    });

    expect(proof.walletEvidence.resolvedAddress).toBe(walletEvidence.resolvedAddress);
    expect(proof.paymentEvidence?.paymentSettled).toBe(true);
    expect(proof.executionMilestones?.aave_executed).toBe(true);
    expect(proof.groupedTxRefs.allocation_pool.sort()).toEqual(["0xaa", "0xbb"].sort());
    expect(proof.groupedTxRefs.uniswap_lp).toEqual(["0xcc"]);
    expect(proof.stageTimeline.map((s) => s.stage)).toEqual(["funding_readiness", "omrate_intelligence"]);
    expect(proof.humanSummary).toMatch(/outcome=executed/);
    expect(proof.humanSummary).toMatch(/profile=allocation_mainline/);
  });

  it("collectGroupedTxRefsFromRuntimeEvents dedupes within each bucket", () => {
    const grouped = collectGroupedTxRefsFromRuntimeEvents([
      {
        eventId: "e1",
        createdAt: "t",
        correlationId: "c",
        intentId: "i",
        action: "x",
        entrySource: "mcp",
        target: "pool",
        stage: "executed",
        summary: "s",
        txRefs: ["0xaa", "0xaa"],
      },
    ]);
    expect(grouped.allocation_pool).toEqual(["0xaa"]);
  });

  it("buildAllocationMainlineProof keeps payment and milestone fields stable on early-return paths", () => {
    const proof = buildAllocationMainlineProof({
      profile: "allocation_mainline",
      walletEvidence,
      stages: [{ stage: "funding_readiness", status: "blocked", summary: "wallet signal missing" }],
      outcomeType: "blocked",
      runtimeEvents: [],
    });

    expect(proof.paymentEvidence).toEqual({
      mode: "plain",
      paymentRequired: false,
      baselineReady: false,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      summary: "payment_evidence_unavailable",
    });
    expect(proof.executionMilestones).toEqual({});
    expect(proof.groupedTxRefs).toEqual({
      allocation_pool: [],
      uniswap_lp: [],
      other: [],
    });
  });

  it("assertAllocationMainlineSmokeEnv fails fast on unknown raw profile values", () => {
    expect(() =>
      assertAllocationMainlineSmokeEnv({
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_ALLOWED_USER_ID: "1",
        OKX_API_KEY: "k",
        OKX_API_SECRET: "s",
        OKX_API_PASSPHRASE: "p",
        AGENT_WALLET_ADDRESS: "0x0000000000000000000000000000000000000001",
        PHALANX_OWNER_EVM_ADDRESS: "0x0000000000000000000000000000000000000003",
        PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED: "1",
        PHALANX_FLOW_PROFILE: "alloc_mainlin",
      }),
    ).toThrow(/unknown PHALANX_FLOW_PROFILE/i);
  });

  it("assertAllocationMainlineSmokeEnv still accepts supported raw aliases", () => {
    expect(
      assertAllocationMainlineSmokeEnv({
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_ALLOWED_USER_ID: "1",
        OKX_API_KEY: "k",
        OKX_API_SECRET: "s",
        OKX_API_PASSPHRASE: "p",
        AGENT_WALLET_ADDRESS: "0x0000000000000000000000000000000000000001",
        PHALANX_OWNER_EVM_ADDRESS: "0x0000000000000000000000000000000000000003",
        PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED: "1",
        PHALANX_FLOW_PROFILE: "allocation-mainline",
      }),
    ).toBe("allocation_mainline");
  });
});

describe("runAgenticAllocationMainlineDemo host entry", () => {
  it("runs proactive allocation orchestration through the same bridge as guardian demo rebalance", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "uniswap-v3"],
      configValues: {
        TEST_WALLET_ADDRESS: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn().mockResolvedValue(baseFlow()),
      executor: {
        async execute(intent) {
          if (intent.action === "executeRebalance") {
            return {
              mode: "rebalance_executed",
              legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
            };
          }
          if (intent.action === "depositLpPosition") {
            return { provider: "test", txRefs: ["0xhostdemo"] };
          }
          return { mode: "dry_run", action: intent.action };
        },
      },
    });

    const res = await host.runAgenticAllocationMainlineDemo("unit_allocation_demo");
    expect(res.outcome.type).toBe("executed");
    expect(res.stages.map((s) => s.stage)).toContain("aave_execution");
    expect(host.getLatestRebalanceDemoRunSummary()?.flowStatus).toBe("ok");
  });

  it("throws when agentic rebalance demo is not enabled", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({ lifecycle: "READY" });
    await expect(host.runAgenticAllocationMainlineDemo()).rejects.toThrow(/PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED/);
  });
});
