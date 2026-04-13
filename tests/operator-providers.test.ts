import { describe, expect, it } from "vitest";
import { buildPortfolioSnapshot } from "../src/adapters/portfolio.ts";
import { runGuardianCycle } from "../src/guardian/cycle.ts";
import { fetchOperatorBindingSnapshot } from "../src/operator/providers/binding-provider.ts";
import { fetchOperatorEventSnapshot } from "../src/operator/providers/event-provider.ts";
import { fetchOperatorExplainSnapshot } from "../src/operator/providers/explain-provider.ts";
import { fetchOperatorPolicySnapshot } from "../src/operator/providers/policy-provider.ts";
import { fetchOperatorPortfolioSnapshot } from "../src/operator/providers/portfolio-provider.ts";
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
    expect(stages).toContain("executed");
    const guardianDetected = events.items.find((e) => e.stage === "guardian_detected");
    expect(guardianDetected?.riskNotes?.[0]).toBeTruthy();
    const executed = events.items.filter((e) => e.stage === "executed" && e.entrySource === "guardian");
    expect(executed.some((e) => e.txRefs?.includes("0xabc"))).toBe(true);
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
    expect(b.wallet.executionOrTestAddress).toBe("0xwallet");
    expect(b.setup.lifecycle).toBe("READY");
    expect(b.readiness.demoReady).toBe(true);
  });
});
