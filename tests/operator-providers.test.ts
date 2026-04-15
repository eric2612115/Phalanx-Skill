import { describe, expect, it, vi } from "vitest";
import { buildPortfolioSnapshot } from "../src/adapters/portfolio.ts";
import { runGuardianCycle } from "../src/guardian/cycle.ts";
import { fetchOperatorBindingSnapshot } from "../src/operator/providers/binding-provider.ts";
import { fetchOperatorEventSnapshot } from "../src/operator/providers/event-provider.ts";
import { fetchOperatorExplainSnapshot } from "../src/operator/providers/explain-provider.ts";
import { fetchOperatorPolicySnapshot } from "../src/operator/providers/policy-provider.ts";
import {
  fetchOperatorLpPositionDetailSnapshot,
  fetchOperatorPortfolioSnapshot,
} from "../src/operator/providers/portfolio-provider.ts";
import { fetchOperatorRuntimeExecutionContextSnapshot } from "../src/operator/providers/execution-context-provider.ts";
import { fetchOperatorRiskSnapshot } from "../src/operator/providers/risk-provider.ts";
import { fetchOperatorStatusSnapshot } from "../src/operator/providers/status-provider.ts";

describe("operator providers", () => {
  it("status provider reflects readiness and pending approvals", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
      guardianEnabled: true,
      configValues: {
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
        TELEGRAM_ALLOWED_USER_ID: "99",
        OKX_API_KEY: "okx-key",
        OKX_API_SECRET: "okx-secret",
        OKX_API_PASSPHRASE: "okx-pass",
        TEST_WALLET_ADDRESS: "0xwallet",
        // Operator tier satisfied; demo tier missing owner binding => liveReady false
      },
    });

    await host.invokeMcp("phalanx_action", {
      action: "requestWhitelistExpansion",
      payload: { target: "uniswap-v3" },
      target: "whitelist-admin",
    });

    const status = await fetchOperatorStatusSnapshot(host);
    expect(status.lifecycle).toBe("READY");
    expect(status.pendingApprovals).toBe(1);
    expect(status.readiness.liveReady).toBe(false);
    expect(status.readiness.demoReady).toBe(false);
    expect(status.surfaces.guardian).toBe("enabled");
  });

  it("portfolio provider LP detail scope returns pool, ticks, token pair, fee, and bounded identity fields", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "uniswap-v3"],
      configValues: {
        PHALANX_EXECUTION_BACKEND: "onchainos_skill",
        PHALANX_DEFAULT_CHAIN: "base",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
      lpExecutionHooks: {
        resolveExecutionWalletAddressImpl: async () => "0x3333333333333333333333333333333333333333",
        readDefiPositionsImpl: async (input) => {
          expect(input.address).toBe("0x3333333333333333333333333333333333333333");
          expect(input.chain).toBe("base");
          return {
            provider: "onchainos",
            status: "completed",
            argv: ["onchainos", "defi", "positions"],
            summary: "positions ok",
            stdout: JSON.stringify({
              ok: true,
              data: {
                walletIdPlatformList: [
                  {
                    platformList: [
                      {
                        platformName: "Uniswap V3",
                        analysisPlatformId: "plat-uni-1",
                        currencyAmount: "80",
                      },
                    ],
                  },
                ],
              },
            }),
          };
        },
        readDefiPositionDetailImpl: async (input) => {
          expect(input.platformId).toBe("plat-uni-1");
          return {
            provider: "onchainos",
            status: "completed",
            argv: ["onchainos", "defi", "position-detail"],
            summary: "position detail ok",
            stdout: JSON.stringify({
              ok: true,
              data: {
                analysisPlatformId: "plat-uni-1",
                platformName: "Uniswap V3",
                updatedAt: 1710000000,
                walletIdPlatformDetailList: [
                  {
                    networkHoldVoList: [
                      {
                        investTokenBalanceVoList: [
                          {
                            tokenId: "4242",
                            poolAddress: "0xdeadbeef00000000000000000000000000000001",
                            token0Symbol: "USDC",
                            token1Symbol: "ETH",
                            feeTier: "3000",
                            tickLower: -100,
                            tickUpper: 200,
                            currentTick: 50,
                            liquidity: "9900112233",
                            canWithdraw: true,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            }),
          };
        },
      },
    });

    const snap = await fetchOperatorLpPositionDetailSnapshot(host);
    expect(snap.status).toBe("ok");
    if (snap.status !== "ok") {
      throw new Error("expected lp detail ok");
    }
    expect(snap.poolAddress).toMatch(/^0x/i);
    expect(snap.tokenId).toBe("4242");
    expect(snap.tickLower).toBe(-100);
    expect(snap.tickUpper).toBe(200);
    expect(snap.liquidity).toBe("9900112233");
    expect(snap.inRange).toBe(true);
    expect(snap.currentTick).toBe(50);
    expect(snap.token0Symbol).toBe("USDC");
    expect(snap.token1Symbol).toBe("ETH");
    expect(snap.feeTier).toBe("3000");
    expect(snap.withdrawabilitySummary.length).toBeGreaterThan(0);
    expect(snap.chain).toBe("base");
    expect(snap.protocol).toBe("uniswap-v3");
    expect(snap.platformId).toBe("plat-uni-1");
    expect(snap.platformLabel).toBe("Uniswap V3");
    expect(snap.withdrawable).toBe(true);
    expect(snap.lastUpdatedAt).toBe("1710000000");
  });

  it("runtime execution context provider surfaces latest event wallet and payment evidence", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      executor: {
        execute: async () => ({
          provider: "test",
          buckets: [{ kind: "lp", currentBps: 1000, targetBps: 2000 }],
          executionEvidence: {
            wallet: {
              resolvedAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              source: "managed",
              chain: "base",
              reason: "onchain_os_managed_wallet_selected",
              overrideActive: false,
            },
            payment: {
              mode: "x402_optional",
              paymentRequired: false,
              baselineReady: true,
              paymentAttempted: false,
              paymentWrapped: false,
              paymentSettled: false,
              summary: "omrate_http:skipped:no_x402",
            },
          },
        }),
      },
    });

    const pf = await host.invokeMcp("phalanx_portfolio", {});
    expect(pf.ok).toBe(true);

    const ctx = await fetchOperatorRuntimeExecutionContextSnapshot(host);
    expect(ctx.status).toBe("ok");
    if (ctx.status !== "ok") {
      throw new Error("expected runtime context");
    }
    expect(ctx.wallet?.resolvedAddress).toMatch(/^0xaaaaaaaa/i);
    expect(ctx.payment?.mode).toBe("x402_optional");
    expect(ctx.sourceAction).toBe("getPortfolioStatus");
  });

  it("lp detail execution evidence keeps wallet_resolved consistent with resolvedAddress", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "uniswap-v3"],
      configValues: {
        PHALANX_EXECUTION_BACKEND: "onchainos_skill",
        PHALANX_RUNTIME_MODE: "dry_run",
        PHALANX_DEFAULT_CHAIN: "base",
      },
      lpExecutionHooks: {
        resolveExecutionWalletAddressImpl: async () => "0x4444444444444444444444444444444444444444",
        readDefiPositionsImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "positions"],
          summary: "positions ok",
          stdout: JSON.stringify({
            ok: true,
            data: {
              walletIdPlatformList: [
                {
                  platformList: [
                    {
                      platformName: "Uniswap V3",
                      analysisPlatformId: "plat-uni-1",
                    },
                  ],
                },
              ],
            },
          }),
        }),
        readDefiPositionDetailImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "position-detail"],
          summary: "position detail ok",
          stdout: JSON.stringify({
            ok: true,
            data: {
              walletIdPlatformDetailList: [
                {
                  networkHoldVoList: [
                    {
                      investTokenBalanceVoList: [
                        {
                          tokenId: "9",
                          poolAddress: "0xdeadbeef00000000000000000000000000000009",
                          tickLower: -1,
                          tickUpper: 1,
                          currentTick: 0,
                          liquidity: "99",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
        }),
      },
    });

    const res = await host.invokeMcp("phalanx_portfolio", {
      payload: { operatorScope: "lp_position_detail" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error("expected lp detail result");
    }
    const data = res.data as { kind?: string; adapterResult?: Record<string, unknown> };
    expect(data.kind).toBe("executed");
    const evidence = data.adapterResult?.executionEvidence as
      | { wallet?: { resolvedAddress?: string }; milestones?: { wallet_resolved?: boolean } }
      | undefined;
    expect(typeof evidence?.wallet?.resolvedAddress).toBe("string");
    expect((evidence?.wallet?.resolvedAddress ?? "").length).toBeGreaterThan(0);
    expect(evidence?.milestones?.wallet_resolved).toBe((evidence?.wallet?.resolvedAddress ?? "").length > 0);
  });

  it("portfolio provider returns normalized summary when portfolio read succeeds", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      executor: {
        execute: async () => ({
          provider: "test",
          buckets: [{ kind: "lending", currentBps: 6000, targetBps: 5000 }],
          asOf: 42,
        }),
      },
    });

    const snap = await fetchOperatorPortfolioSnapshot(host);
    expect(snap.status).toBe("ok");
    if (snap.status !== "ok") {
      throw new Error("expected portfolio ok");
    }
    expect(snap.asOf).toBe(42);
    expect(snap.buckets).toHaveLength(1);
    expect(snap.buckets[0]?.kind).toBe("lending");
  });

  it("portfolio provider includes bounded post-action readiness without inventing push sent", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      executor: {
        execute: async () => ({
          provider: "test",
          buckets: [{ kind: "lp", currentBps: 5000, targetBps: 5000 }],
          executionEvidence: {
            wallet: {
              resolvedAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              source: "explicit_override",
              chain: "base",
              reason: "explicit_env_wallet_override_active",
              overrideActive: true,
            },
            milestones: { allocation_planned: true, portfolio_push_ready: true },
          },
        }),
      },
    });

    const pf = await host.invokeMcp("phalanx_portfolio", {});
    expect(pf.ok).toBe(true);

    const snap = await fetchOperatorPortfolioSnapshot(host);
    expect(snap.status).toBe("ok");
    if (snap.status !== "ok") {
      throw new Error("expected portfolio ok");
    }
    expect(snap.postActionFromRuntime?.action).toBe("getPortfolioStatus");
    expect(snap.postActionFromRuntime?.walletSource).toBe("explicit_override");
    expect(snap.postActionFromRuntime?.milestoneLine).toMatch(/portfolio_push_ready/);
    expect(snap.postActionFromRuntime?.portfolioPushReady).toBe(true);
    expect(snap.postActionFromRuntime?.portfolioPushSent).toBeUndefined();
  });

  it("portfolio provider surfaces NOT_READY without throwing", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({ lifecycle: "SETUP_IN_PROGRESS", whitelistTargets: ["pool"] });
    const snap = await fetchOperatorPortfolioSnapshot(host);
    expect(snap.status).toBe("unavailable");
    if (snap.status !== "unavailable") {
      throw new Error("expected unavailable");
    }
    expect(snap.code).toBe("NOT_READY");
  });

  it("event provider returns recent rows with tx refs and guardian actions", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      configValues: {
        PHALANX_RUNTIME_MODE: "dry_run",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn(async () => ({
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
            paymentWrapped: false,
            paymentSettled: true,
            summary: "omrate payment required",
          },
          milestones: {
            omrate_requested: true,
            x402_required: true,
            x402_payment_attempted: true,
            x402_payment_settled: true,
          },
        },
        omRateCandidates: [],
        planner: {
          provider: "uniswap",
          lane: "liquidity_planner_skill",
          status: "completed",
          summary: "planner_ok",
          runtimeDownstream: {
            executionTarget: "depositLpPosition",
            executionAction: "depositLpPosition",
            positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
            topUniswapPools: [],
            plannerInput: { chain: "base", tokenA: "USDC", tokenB: "ETH", positionType: "v3" },
            payloadTemplate: {
              protocol: "uniswap-v3",
              chain: "base",
              investmentId: "planner-investment-id",
              token: "USDC",
              tokenSecondary: "ETH",
              amount: "1000000",
              amountSecondary: "500000000000000",
              range: "5",
            },
            missingExecutionFields: [],
          },
        },
        selectedPool: {
          pairLabel: "USDC/ETH",
        },
        swapPreparation: {
          kind: "swap_preparation",
          status: "assets_match",
          summary: "Wallet already aligned.",
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
        },
        summaries: {
          omRate: "http_ok:200",
          planner: "planner_ok",
        },
      })),
      executor: {
        execute: async () => ({
          provider: "test",
          txRefs: ["0xabc"],
          summary: "done",
        }),
      },
    });

    const cycle = runGuardianCycle({
      now: 1,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        1,
      ),
    });
    await host.handleGuardianCycleResult(cycle);

    const events = await fetchOperatorEventSnapshot(host, { limit: 20 });
    expect(events.items.length).toBeGreaterThanOrEqual(2);
    const stages = events.items.map((e) => e.stage);
    expect(stages).toContain("guardian_detected");
    const guardianDetected = events.items.find((e) => e.stage === "guardian_detected");
    expect(guardianDetected?.riskNotes?.[0]).toBeTruthy();
    expect(guardianDetected?.demoRun?.omRateExecutionEvidence.payment?.paymentRequired).toBe(true);
    const approvalOrFollowup = events.items.find((e) => e.stage === "awaiting_approval" || e.stage === "blocked");
    expect(approvalOrFollowup?.demoRun?.omRateExecutionEvidence.payment?.paymentSettled).toBe(true);
  });

  it("event provider preserves approval ids for approval-gated actions", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
    });

    await host.invokeMcp("phalanx_action", {
      action: "requestWhitelistExpansion",
      payload: { target: "uniswap-v3" },
      target: "whitelist-admin",
    });

    const events = await fetchOperatorEventSnapshot(host, { limit: 20 });
    const approvalEvent = events.items.find((e) => e.stage === "awaiting_approval");
    expect(approvalEvent?.approvalId).toBeTruthy();
  });

  it("explain provider returns bounded what/why/next for latest blocked event", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      executor: {
        execute: async () => {
          throw new Error("should not execute");
        },
      },
    });

    await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: { amount: "1" },
      target: "not-whitelisted",
    });

    const ex = await fetchOperatorExplainSnapshot(host);
    expect(ex.hasExplanation).toBe(true);
    expect(ex.stage).toBe("blocked");
    expect(ex.whatHappened).toBeTruthy();
    expect(ex.why).toBeTruthy();
    expect(ex.whatNext).toBeTruthy();
  });

  it("policy provider returns whitelist and lifecycle summary", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "uniswap-v3"],
    });
    const pol = await fetchOperatorPolicySnapshot(host);
    expect(pol.lifecycle).toBe("READY");
    expect(pol.executionPaused).toBe(false);
    expect(pol.whitelistTargets).toContain("pool");
    expect(pol.whitelistTargets).toContain("uniswap-v3");
  });

  it("risk provider exposes rule order, context snapshot, and last guardian assessment", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      riskContext: { now: 99 },
      executor: {
        execute: async () => ({ provider: "test", summary: "ok" }),
      },
    });

    const cycle = runGuardianCycle({
      now: 99,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        99,
      ),
    });
    await host.handleGuardianCycleResult(cycle);

    const risk = await fetchOperatorRiskSnapshot(host);
    expect(risk.riskContext.now).toBe(99);
    expect(risk.engineRuleOrder.length).toBeGreaterThan(0);
    expect(risk.guardianLastAssessment).toBeTruthy();
    expect(risk.guardianLastAssessment?.items[0]?.outcome).toBe("AUTO_EXECUTE");
    expect(risk.guardianLastAssessment?.items[0]?.detected).toContain("drift");
  });

  it("binding provider returns owner, wallet, and config summary", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      configValues: {
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "123456:secret",
        TELEGRAM_ALLOWED_USER_ID: "42",
        OKX_API_KEY: "k",
        OKX_API_SECRET: "s",
        OKX_API_PASSPHRASE: "p",
        OMRATE_API_KEY: "o",
        OMRATE_API_BASE_URL: "https://omrate.io/api",
        XLAYER_RPC_URL: "https://rpc.example",
        POLICY_OWNER_KEY: "0xabc",
        WHITELIST_POLICY_ADDRESS: "0x123",
        PHALANX_OWNER_EVM_ADDRESS: "0xowner",
        BASE_RPC_URL: "https://base.rpc",
        TEST_WALLET_ADDRESS: "0xwallet",
      },
    });

    const b = await fetchOperatorBindingSnapshot(host);
    expect(b.mode).toBe("live");
    expect(b.owner.evmAddress).toBe("0xowner");
    expect(b.owner.claimedTelegramUserId).toBe("42");
    expect(b.owner.pendingTelegramUserId).toBeNull();
    expect(b.telegram.allowedUserId).toBe("42");
    expect(b.wallet.executionOrTestAddress).toBeUndefined();
    expect(b.wallet.source).toBe("managed");
    expect(b.wallet.reason).toBe("live_mode_ignores_test_fallback_without_managed_wallet");
    expect(b.wallet.overrideActive).toBe(false);
    expect(b.setup.lifecycle).toBe("READY");
    expect(b.readiness.demoReady).toBe(true);
  });
});
