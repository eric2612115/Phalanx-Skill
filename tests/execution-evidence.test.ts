import { describe, expect, it } from "vitest";
import { buildRuntimeEvent } from "../src/runtime/events.js";
import {
  buildPaymentEvidenceForOmRateHttpCall,
  buildPaymentEvidenceForOnchainosX402Cli,
  mergeExecutionMilestones,
  milestonesForOmRateHttpCall,
  normalizePaymentEvidence,
  normalizeWalletEvidence,
  summarizeExecutionEvidence,
} from "../src/runtime/execution-evidence.js";
import type { RuntimeIntent } from "../src/runtime/types.js";

function baseIntent(overrides: Partial<RuntimeIntent> = {}): RuntimeIntent {
  return {
    id: "intent-1",
    lane: "execution",
    action: "demo",
    payload: {},
    entrySource: "mcp",
    ...overrides,
  };
}

describe("normalizeWalletEvidence", () => {
  it("selects managed wallet in live mode when available and no override", () => {
    const w = normalizeWalletEvidence({
      liveMode: true,
      chain: "xlayer",
      managedAddress: "0xManaged000000000000000000000000000000000001",
    });
    expect(w.source).toBe("managed");
    expect(w.resolvedAddress).toMatch(/^0xManaged/);
    expect(w.overrideActive).toBe(false);
    expect(w.chain).toBe("xlayer");
  });

  it("prefers explicit override when set and marks overrideActive", () => {
    const w = normalizeWalletEvidence({
      liveMode: true,
      chain: "xlayer",
      managedAddress: "0xManaged000000000000000000000000000000000001",
      explicitOverride: "  0xOverride0000000000000000000000000000000001  ",
    });
    expect(w.source).toBe("explicit_override");
    expect(w.resolvedAddress.toLowerCase()).toContain("override");
    expect(w.overrideActive).toBe(true);
  });

  it("does not label payload-provided wallets as env overrides", () => {
    const w = normalizeWalletEvidence({
      liveMode: true,
      chain: "base",
      managedAddress: "0xManaged000000000000000000000000000000000001",
      explicitPayload: "0xPayload0000000000000000000000000000000001",
    });
    expect(w.source).toBe("explicit_override");
    expect(w.reason).toBe("payload_wallet_address_provided");
    expect(w.overrideActive).toBe(false);
  });

  it("never selects test_fallback in live mode even when managed is missing", () => {
    const w = normalizeWalletEvidence({
      liveMode: true,
      chain: "xlayer",
      testFallback: "0xTest00000000000000000000000000000000000001",
    });
    expect(w.source).not.toBe("test_fallback");
    expect(w.resolvedAddress).toBe("");
    expect(w.reason).toContain("test_fallback");
  });

  it("allows test_fallback only outside live mode", () => {
    const w = normalizeWalletEvidence({
      liveMode: false,
      chain: "xlayer",
      testFallback: "0xTest00000000000000000000000000000000000001",
    });
    expect(w.source).toBe("test_fallback");
    expect(w.resolvedAddress).toMatch(/^0xTest/);
    expect(w.overrideActive).toBe(false);
  });

  it("exposes resolvedAddress, source, chain, reason, overrideActive on every outcome", () => {
    const w = normalizeWalletEvidence({ liveMode: false, chain: "  sepolia  " });
    expect(w).toMatchObject({
      resolvedAddress: expect.any(String),
      source: expect.stringMatching(/managed|explicit_override|test_fallback/),
      chain: "sepolia",
      reason: expect.any(String),
      overrideActive: expect.any(Boolean),
    });
  });
});

describe("normalizePaymentEvidence", () => {
  it("keeps baselineReady distinct from payment-required mode and settlement flags", () => {
    const baselineOnly = normalizePaymentEvidence({
      mode: "x402_required",
      baselineReady: true,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      summary: "x402 required; no payment yet",
    });
    expect(baselineOnly.baselineReady).toBe(true);
    expect(baselineOnly.mode).toBe("x402_required");
    expect(baselineOnly.paymentAttempted).toBe(false);
    expect(baselineOnly.paymentSettled).toBe(false);

    const attempted = normalizePaymentEvidence({
      mode: "x402_required",
      baselineReady: true,
      paymentAttempted: true,
      paymentWrapped: false,
      paymentSettled: false,
      summary: "payment attempted, transport not wrapped",
    });
    expect(attempted.paymentAttempted).toBe(true);
    expect(attempted.paymentWrapped).toBe(false);
    expect(attempted.paymentSettled).toBe(false);

    const settled = normalizePaymentEvidence({
      mode: "x402_required",
      baselineReady: true,
      paymentAttempted: true,
      paymentWrapped: true,
      paymentSettled: true,
      summary: "paid and settled",
    });
    expect(settled.paymentSettled).toBe(true);
  });

  it("treats paymentWrapped as transport entered, separate from attempted", () => {
    const notWrapped = normalizePaymentEvidence({
      mode: "x402_optional",
      baselineReady: true,
      paymentAttempted: true,
      paymentWrapped: false,
      paymentSettled: false,
      summary: "attempt without wrapped transport",
    });
    expect(notWrapped.paymentAttempted).toBe(true);
    expect(notWrapped.paymentWrapped).toBe(false);

    const wrapped = normalizePaymentEvidence({
      mode: "x402_optional",
      baselineReady: true,
      paymentAttempted: true,
      paymentWrapped: true,
      paymentSettled: false,
      summary: "inside x402 transport",
    });
    expect(wrapped.paymentWrapped).toBe(true);
  });

  it("preserves degraded payment path with explanatory summary and unsettled flag", () => {
    const degraded = normalizePaymentEvidence({
      mode: "x402_required",
      baselineReady: true,
      paymentAttempted: true,
      paymentWrapped: true,
      paymentSettled: false,
      summary: "degraded: provider timeout, action may continue without paid tier",
    });
    expect(degraded.paymentAttempted).toBe(true);
    expect(degraded.paymentWrapped).toBe(true);
    expect(degraded.paymentSettled).toBe(false);
    expect(degraded.summary).toContain("degraded");
  });

  it("carries optional receipt metadata", () => {
    const p = normalizePaymentEvidence({
      mode: "plain",
      baselineReady: false,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      summary: "no payment",
      receipt: { provider: "stub", id: "r1" },
    });
    expect(p.receipt).toEqual({ provider: "stub", id: "r1" });
  });
});

describe("buildPaymentEvidenceForOmRateHttpCall", () => {
  it("marks x402_required and no attempt when the query is skipped", () => {
    const p = buildPaymentEvidenceForOmRateHttpCall({
      x402Requested: true,
      paymentRequiredByServer: undefined,
      queryStatus: "skipped",
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "no_base",
      baselineReady: false,
    });
    expect(p.mode).toBe("x402_optional");
    expect(p.paymentRequired).toBe(false);
    expect(p.paymentAttempted).toBe(false);
    expect(p.paymentSettled).toBe(false);
    expect(p.baselineReady).toBe(false);
  });

  it("marks attempted and settled on terminal HTTP outcomes when x402-aware", () => {
    const ok = buildPaymentEvidenceForOmRateHttpCall({
      x402Requested: true,
      paymentRequiredByServer: false,
      queryStatus: "completed",
      httpStatus: 200,
      paymentAttempted: true,
      paymentWrapped: true,
      paymentSettled: true,
      fetchSummary: "x402_wrapped_fetch:eip155:8453",
      baselineReady: true,
      receipt: { selectedNetwork: "eip155:8453" },
    });
    expect(ok.paymentAttempted).toBe(true);
    expect(ok.paymentWrapped).toBe(true);
    expect(ok.paymentSettled).toBe(true);
    expect(ok.paymentRequired).toBe(false);

    const failed = buildPaymentEvidenceForOmRateHttpCall({
      x402Requested: true,
      paymentRequiredByServer: true,
      queryStatus: "failed",
      httpStatus: 402,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "plain_fetch:payment_disabled",
      baselineReady: true,
    });
    expect(failed.paymentAttempted).toBe(false);
    expect(failed.paymentSettled).toBe(false);
    expect(failed.paymentWrapped).toBe(false);
    expect(failed.paymentRequired).toBe(true);
  });

  it("uses plain mode without x402 attempts when x402 is not requested", () => {
    const p = buildPaymentEvidenceForOmRateHttpCall({
      x402Requested: false,
      paymentRequiredByServer: undefined,
      queryStatus: "completed",
      httpStatus: 200,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "plain_fetch:x402_not_requested",
      baselineReady: false,
    });
    expect(p.mode).toBe("plain");
    expect(p.paymentAttempted).toBe(false);
    expect(p.paymentWrapped).toBe(false);
  });

  it("carries agentic-wallet selection metadata for replayed payments", () => {
    const p = buildPaymentEvidenceForOmRateHttpCall({
      x402Requested: true,
      paymentRequiredByServer: true,
      queryStatus: "completed",
      httpStatus: 200,
      paymentAttempted: true,
      paymentWrapped: true,
      paymentSettled: true,
      fetchSummary: "agentic_x402:eip155:196",
      baselineReady: true,
      receipt: {
        payerAddress: "0x0dfddf188f102978c75882bc990d903ebe08f443",
        selectedNetwork: "eip155:196",
        walletSource: "agentic_active_wallet",
      },
    });
    expect(p.paymentAttempted).toBe(true);
    expect(p.paymentWrapped).toBe(true);
    expect(p.paymentSettled).toBe(true);
    expect(p.receipt).toMatchObject({
      payerAddress: "0x0dfddf188f102978c75882bc990d903ebe08f443",
      selectedNetwork: "eip155:196",
      walletSource: "agentic_active_wallet",
    });
  });
});

describe("milestonesForOmRateHttpCall", () => {
  it("sets omrate_requested only after a non-skipped query", () => {
    const payment = buildPaymentEvidenceForOmRateHttpCall({
      x402Requested: true,
      paymentRequiredByServer: undefined,
      queryStatus: "skipped",
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "x",
      baselineReady: false,
    });
    expect(milestonesForOmRateHttpCall({ queryStatus: "skipped", payment })).toEqual({});

    const p2 = buildPaymentEvidenceForOmRateHttpCall({
      x402Requested: true,
      paymentRequiredByServer: true,
      queryStatus: "failed",
      httpStatus: 500,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "x",
      baselineReady: true,
    });
    expect(milestonesForOmRateHttpCall({ queryStatus: "failed", payment: p2 })).toMatchObject({
      omrate_requested: true,
      x402_required: true,
    });
  });
});

describe("buildPaymentEvidenceForOnchainosX402Cli", () => {
  it("structures CLI x402 lane with attempted/settled flags", () => {
    const p = buildPaymentEvidenceForOnchainosX402Cli({
      status: "tool_missing",
      summary: "onchainos binary not found",
      exitCode: null,
    });
    expect(p.mode).toBe("x402_required");
    expect(p.paymentAttempted).toBe(true);
    expect(p.paymentWrapped).toBe(false);
    expect(p.paymentSettled).toBe(true);
    expect(p.receipt).toMatchObject({ lane: "x402_payment", status: "tool_missing" });
  });
});

describe("mergeExecutionMilestones", () => {
  it("ORs boolean progress flags across snapshots", () => {
    const merged = mergeExecutionMilestones(
      { wallet_resolved: true },
      { omrate_requested: true },
      { x402_payment_settled: true },
    );
    expect(merged.wallet_resolved).toBe(true);
    expect(merged.omrate_requested).toBe(true);
    expect(merged.x402_payment_settled).toBe(true);
  });
});

describe("summarizeExecutionEvidence", () => {
  it("includes wallet, payment, and milestone segments", () => {
    const text = summarizeExecutionEvidence({
      wallet: normalizeWalletEvidence({
        liveMode: true,
        chain: "xlayer",
        managedAddress: "0xabc0000000000000000000000000000000000001",
      }),
      payment: normalizePaymentEvidence({
        mode: "x402_optional",
        baselineReady: true,
        paymentAttempted: false,
        paymentWrapped: false,
        paymentSettled: false,
        summary: "optional lane",
      }),
      milestones: { funding_ready: true },
    });
    expect(text).toContain("wallet=managed");
    expect(text).toContain("payment mode=x402_optional");
    expect(text).toContain("milestones=funding_ready");
  });
});

describe("RuntimeEvent.executionEvidence", () => {
  it("passes through executionEvidence from buildRuntimeEvent extras", () => {
    const evidence = {
      wallet: normalizeWalletEvidence({
        liveMode: false,
        chain: "xlayer",
        testFallback: "0xfallback000000000000000000000000000000001",
      }),
    };
    const ev = buildRuntimeEvent(baseIntent(), "executed", {
      summary: "done",
      executionEvidence: evidence,
    });
    expect(ev.executionEvidence).toEqual(evidence);
  });
});
