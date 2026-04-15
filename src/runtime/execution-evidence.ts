/**
 * Normalized execution evidence for wallet resolution, x402/payment stages,
 * and allocation milestones. Adapters emit raw facts; runtime composes this shape.
 */

export type WalletEvidenceSource = "managed" | "explicit_override" | "test_fallback";

export interface WalletEvidence {
  readonly resolvedAddress: string;
  readonly source: WalletEvidenceSource;
  readonly chain: string;
  readonly reason: string;
  /** True when an explicit env override address is active (troubleshooting path). */
  readonly overrideActive: boolean;
}

export type PaymentEvidenceMode = "plain" | "x402_optional" | "x402_required";

export interface PaymentEvidence {
  readonly mode: PaymentEvidenceMode;
  /** True when the upstream service actually required a payment-gated path. */
  readonly paymentRequired: boolean;
  /** Runtime baseline for x402-capable access (credentials/config present). */
  readonly baselineReady: boolean;
  /** A payment was actually attempted for this action. */
  readonly paymentAttempted: boolean;
  /**
   * The runtime successfully switched into an x402-capable payment transport
   * (distinct from merely attempting or being payment-aware).
   */
  readonly paymentWrapped: boolean;
  /** Payment reached a settled terminal outcome (success or explicit degraded/failure). */
  readonly paymentSettled: boolean;
  readonly summary: string;
  /** Optional provider receipt or proof blob when available. */
  readonly receipt?: Readonly<Record<string, unknown>>;
}

/** Canonical allocation / execution progress flags (design Pillar 3). */
export interface ExecutionMilestones {
  readonly wallet_resolved?: boolean;
  readonly funding_ready?: boolean;
  readonly omrate_requested?: boolean;
  readonly x402_required?: boolean;
  readonly x402_payment_attempted?: boolean;
  readonly x402_payment_settled?: boolean;
  readonly allocation_planned?: boolean;
  readonly aave_executed?: boolean;
  readonly morpho_executed?: boolean;
  readonly uniswap_blocked_for_approval?: boolean;
  readonly approval_requested?: boolean;
  readonly approval_resumed?: boolean;
  readonly uniswap_executed?: boolean;
  readonly tx_refs_captured?: boolean;
  readonly grouped_reporting_ready?: boolean;
  readonly portfolio_push_ready?: boolean;
  readonly portfolio_push_sent?: boolean;
}

/** Optional bundle attached to runtime events and proof JSON. */
export interface ExecutionEvidence {
  readonly wallet?: WalletEvidence;
  readonly payment?: PaymentEvidence;
  readonly milestones?: ExecutionMilestones;
}

export interface NormalizeWalletEvidenceInput {
  readonly liveMode: boolean;
  readonly chain: string;
  /** Managed / Onchain OS resolved wallet when available. */
  readonly managedAddress?: string;
  /** `AGENT_WALLET_ADDRESS` / `PHALANX_WALLET_ADDRESS` style override. */
  readonly explicitOverride?: string;
  /** Intent/payload-specified wallet for a single action; not an env override. */
  readonly explicitPayload?: string;
  /** Non-live rehearsal / test-only address; never selected in live mode. */
  readonly testFallback?: string;
}

function trimAddr(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Single-source wallet evidence with managed-first semantics in live mode.
 * Explicit overrides win for troubleshooting but remain visibly marked.
 * `test_fallback` is only eligible when `liveMode` is false.
 */
export function normalizeWalletEvidence(input: NormalizeWalletEvidenceInput): WalletEvidence {
  const chain = typeof input.chain === "string" && input.chain.trim().length > 0 ? input.chain.trim() : "unknown";
  const managed = trimAddr(input.managedAddress);
  const override = trimAddr(input.explicitOverride);
  const payloadExplicit = trimAddr(input.explicitPayload);
  const testFallback = trimAddr(input.testFallback);

  if (payloadExplicit) {
    return {
      resolvedAddress: payloadExplicit,
      source: "explicit_override",
      chain,
      reason: "payload_wallet_address_provided",
      overrideActive: false,
    };
  }

  if (override) {
    return {
      resolvedAddress: override,
      source: "explicit_override",
      chain,
      reason: "explicit_env_wallet_override_active",
      overrideActive: true,
    };
  }

  if (managed) {
    return {
      resolvedAddress: managed,
      source: "managed",
      chain,
      reason: "onchain_os_managed_wallet_selected",
      overrideActive: false,
    };
  }

  if (!input.liveMode && testFallback) {
    return {
      resolvedAddress: testFallback,
      source: "test_fallback",
      chain,
      reason: "non_live_mode_test_fallback_wallet",
      overrideActive: false,
    };
  }

  if (input.liveMode && testFallback) {
    return {
      resolvedAddress: "",
      source: "managed",
      chain,
      reason: "live_mode_ignores_test_fallback_without_managed_wallet",
      overrideActive: false,
    };
  }

  return {
    resolvedAddress: "",
    source: "managed",
    chain,
    reason: input.liveMode ? "live_mode_missing_managed_wallet" : "no_wallet_candidate_resolved",
    overrideActive: false,
  };
}

export interface NormalizePaymentEvidenceInput {
  readonly mode: PaymentEvidenceMode;
  readonly paymentRequired?: boolean;
  readonly baselineReady: boolean;
  readonly paymentAttempted: boolean;
  readonly paymentWrapped: boolean;
  readonly paymentSettled: boolean;
  readonly summary: string;
  readonly receipt?: Readonly<Record<string, unknown>>;
}

/** Builds a consistent payment evidence object; callers keep adapter translation thin. */
export function normalizePaymentEvidence(input: NormalizePaymentEvidenceInput): PaymentEvidence {
  return {
    mode: input.mode,
    paymentRequired: input.paymentRequired ?? false,
    baselineReady: input.baselineReady,
    paymentAttempted: input.paymentAttempted,
    paymentWrapped: input.paymentWrapped,
    paymentSettled: input.paymentSettled,
    summary: input.summary.trim().length > 0 ? input.summary.trim() : "payment_evidence",
    receipt: input.receipt,
  };
}

export interface BuildPaymentEvidenceForOmRateHttpCallInput {
  readonly x402Requested: boolean;
  readonly paymentRequiredByServer?: boolean;
  readonly queryStatus: "skipped" | "completed" | "failed";
  readonly httpStatus?: number;
  readonly paymentAttempted: boolean;
  readonly paymentWrapped: boolean;
  readonly paymentSettled: boolean;
  readonly fetchSummary: string;
  /** From env/x402 sync summary at call time (planned or degraded means signing stack present). */
  readonly baselineReady: boolean;
  readonly receipt?: Readonly<Record<string, unknown>>;
}

/**
 * OmRate HTTP probe/query: maps transport + HTTP outcome into canonical payment evidence.
 * Skipped queries never count as payment attempts; completed/failed are terminal for settlement when x402-aware.
 */
export function buildPaymentEvidenceForOmRateHttpCall(
  input: BuildPaymentEvidenceForOmRateHttpCallInput,
): PaymentEvidence {
  const paymentRequired = input.paymentRequiredByServer === true;
  const mode: PaymentEvidenceMode = paymentRequired ? "x402_required" : input.x402Requested ? "x402_optional" : "plain";
  const paymentWrapped = input.x402Requested && input.paymentWrapped;
  const paymentAttempted = input.x402Requested && input.paymentAttempted;
  const paymentSettled = input.x402Requested && input.paymentSettled;
  const statusPart =
    input.queryStatus === "skipped"
      ? `skipped:${input.fetchSummary}`
      : `${input.queryStatus}${input.httpStatus !== undefined ? `:${input.httpStatus}` : ""}`;
  const summary = `omrate_http:${statusPart};wrap=${paymentWrapped};${input.fetchSummary}`;
  const receipt: Record<string, unknown> = {
    queryStatus: input.queryStatus,
    fetchSummary: input.fetchSummary,
    x402Requested: input.x402Requested,
    paymentRequiredByServer: input.paymentRequiredByServer === true,
  };
  if (input.httpStatus !== undefined) {
    receipt.httpStatus = input.httpStatus;
  }
  if (input.receipt) {
    Object.assign(receipt, input.receipt);
  }
  return normalizePaymentEvidence({
    mode,
    paymentRequired,
    baselineReady: input.baselineReady,
    paymentAttempted,
    paymentWrapped,
    paymentSettled,
    summary,
    receipt,
  });
}

export function milestonesForOmRateHttpCall(input: {
  readonly queryStatus: "skipped" | "completed" | "failed";
  readonly payment: PaymentEvidence;
}): ExecutionMilestones {
  const parts: ExecutionMilestones[] = [];
  if (input.queryStatus !== "skipped") {
    parts.push({ omrate_requested: true });
  }
  if (input.payment.paymentRequired) {
    parts.push({ x402_required: true });
  }
  if (input.payment.paymentAttempted) {
    parts.push({ x402_payment_attempted: true });
  }
  if (input.payment.paymentSettled) {
    parts.push({ x402_payment_settled: true });
  }
  return mergeExecutionMilestones(...parts);
}

/** Onchain OS CLI `payment x402-pay`: payment attempted; HTTP wrap is N/A (paymentWrapped=false). */
export function buildPaymentEvidenceForOnchainosX402Cli(input: {
  readonly status: "completed" | "failed" | "tool_missing";
  readonly summary: string;
  readonly exitCode?: number | null;
}): PaymentEvidence {
  const paymentSettled = true;
  return normalizePaymentEvidence({
    mode: "x402_required",
    paymentRequired: true,
    baselineReady: true,
    paymentAttempted: true,
    paymentWrapped: false,
    paymentSettled,
    summary: `onchainos_x402_cli:${input.status}:${input.summary.replace(/\s+/g, " ").trim().slice(0, 200)}`,
    receipt: { lane: "x402_payment", status: input.status, exitCode: input.exitCode ?? null },
  });
}

/**
 * Merges milestone snapshots monotonically: once true, a flag stays true.
 * Undefined keys are omitted unless set true in any part.
 */
export function mergeExecutionMilestones(...parts: readonly ExecutionMilestones[]): ExecutionMilestones {
  const keys = [
    "wallet_resolved",
    "funding_ready",
    "omrate_requested",
    "x402_required",
    "x402_payment_attempted",
    "x402_payment_settled",
    "allocation_planned",
    "aave_executed",
    "morpho_executed",
    "uniswap_blocked_for_approval",
    "approval_requested",
    "approval_resumed",
    "uniswap_executed",
    "tx_refs_captured",
    "grouped_reporting_ready",
    "portfolio_push_ready",
    "portfolio_push_sent",
  ] as const;

  const out: Record<string, boolean> = {};
  for (const key of keys) {
    if (parts.some((p) => p[key] === true)) {
      out[key] = true;
    }
  }
  return out as ExecutionMilestones;
}

function milestoneLine(m: ExecutionMilestones): string {
  const active = (
    Object.entries(m) as Array<[keyof ExecutionMilestones, boolean | undefined]>
  )
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  return active.length > 0 ? `milestones=${active.join(",")}` : "milestones=none";
}

/** Compact human-readable summary for logs and Telegram-adjacent surfaces. */
export function summarizeExecutionEvidence(evidence: ExecutionEvidence): string {
  const segments: string[] = [];
  if (evidence.wallet) {
    const w = evidence.wallet;
    segments.push(
      `wallet=${w.source}${w.resolvedAddress ? `:${w.resolvedAddress.slice(0, 10)}…` : ":<empty>"} chain=${w.chain} override=${w.overrideActive}`,
    );
  }
  if (evidence.payment) {
    const p = evidence.payment;
    segments.push(
      `payment mode=${p.mode} required=${p.paymentRequired} baseline=${p.baselineReady} attempted=${p.paymentAttempted} wrapped=${p.paymentWrapped} settled=${p.paymentSettled}`,
    );
    if (p.summary) {
      segments.push(p.summary);
    }
  }
  if (evidence.milestones && Object.keys(evidence.milestones).length > 0) {
    segments.push(milestoneLine(evidence.milestones));
  }
  return segments.join(" | ");
}
