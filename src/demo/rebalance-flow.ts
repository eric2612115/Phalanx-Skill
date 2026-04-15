import type { OnchainosSwapExecutionCommandInput } from "../adapters/onchainos.js";
import {
  executeOmRateQuery,
  type OmRateQueryExecutionResult,
  type OmRateQueryPlanInput,
} from "../adapters/omrate.js";
import {
  buildPaymentEvidenceForOmRateHttpCall,
  mergeExecutionMilestones,
  milestonesForOmRateHttpCall,
  type ExecutionEvidence,
} from "../runtime/execution-evidence.js";
import {
  executeUniswapLiquidityPlannerInvocation,
  planUniswapLiquidityPlannerInvocation,
  type UniswapLiquidityPlannerExecutionResult,
  type UniswapLiquidityPlannerInvocationInput,
} from "../adapters/uniswap.js";

export type OmRateRebalanceCandidate = {
  readonly chain?: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly poolAddress?: string;
  readonly score?: number;
  readonly label?: string;
};

export type RebalanceDemoFlowInput = {
  readonly omRatePath: string;
  readonly omRateMethod?: "GET" | "POST";
  readonly omRateBodyJson?: unknown;
  readonly x402Aware?: boolean;
  readonly chain: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly positionType?: UniswapLiquidityPlannerInvocationInput["positionType"];
  readonly investmentIdSeed?: string;
  readonly prepareSwap?: boolean;
  readonly walletHeldTokenAddresses?: readonly string[];
  readonly lpTokenAddresses?: { readonly tokenA: string; readonly tokenB: string };
  readonly preparationWalletAddress?: string;
  readonly swapAmountIn?: string;
};

export type RebalanceDemoFlowDeps = {
  readonly env: NodeJS.ProcessEnv;
  readonly executeOmRateQuery: typeof executeOmRateQuery;
  readonly planUniswapLiquidityPlannerInvocation: typeof planUniswapLiquidityPlannerInvocation;
  readonly executeUniswapLiquidityPlannerInvocation: typeof executeUniswapLiquidityPlannerInvocation;
};

export type RebalanceDemoSwapPreparation = {
  readonly kind: "swap_preparation";
  readonly status:
    | "not_evaluated"
    | "insufficient_context"
    | "assets_match"
    | "swap_recommended"
    | "wallet_unfunded_for_pair";
  readonly summary: string;
  readonly recommendedSwapIntent?: {
    readonly action: "swap";
    readonly payload: Pick<
      OnchainosSwapExecutionCommandInput,
      "fromTokenAddress" | "toTokenAddress" | "chain" | "amount" | "slippage"
    > & {
      readonly wallet?: OnchainosSwapExecutionCommandInput["wallet"];
    };
  };
};

export type RebalanceDemoFlowResult = {
  readonly status: "ok" | "omrate_not_completed" | "planner_not_completed";
  readonly omRate: OmRateQueryExecutionResult;
  readonly omRateExecutionEvidence: ExecutionEvidence;
  readonly omRateCandidates: readonly OmRateRebalanceCandidate[];
  readonly planner: UniswapLiquidityPlannerExecutionResult;
  readonly selectedPool?: {
    readonly pairAddress?: string;
    readonly pairLabel?: string;
    readonly version?: string;
    readonly liquidityUsd?: number;
    readonly volumeH24?: number;
    readonly dexId?: string;
  };
  readonly swapPreparation: RebalanceDemoSwapPreparation;
  readonly lpDepositPayloadSeed: Record<string, unknown>;
  readonly summaries: {
    readonly omRate: string;
    readonly planner: string;
  };
};

/** Serializable snapshot for host/runtime events and operator surfaces (install + demo story). */
export type RebalanceDemoLpObserverSnapshot = {
  readonly readyForExecution: boolean;
  readonly missingExecutionFields: readonly string[];
  readonly summary: string;
  readonly action?: string;
  readonly target?: string;
};

export type RebalanceDemoRunMetadata = {
  readonly kind: "rebalance_demo_v1";
  readonly omRatePath: string;
  readonly chain: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly flowStatus: RebalanceDemoFlowResult["status"];
  readonly omRateSummary: string;
  readonly omRateExecutionEvidence: ExecutionEvidence;
  readonly plannerSummary: string;
  readonly selectedPool?: RebalanceDemoFlowResult["selectedPool"];
  readonly swapPreparation: RebalanceDemoSwapPreparation;
  readonly lpDepositPayloadSeed: Record<string, unknown>;
  readonly lpExecution: {
    readonly ready: boolean;
    readonly missingFields: readonly string[];
    readonly observerSummary: string;
    readonly action?: string;
    readonly target?: string;
  };
  readonly pendingApproval?: { readonly approvalId: string };
};

export function buildRebalanceDemoRunMetadata(
  input: Pick<RebalanceDemoFlowInput, "omRatePath" | "chain" | "tokenA" | "tokenB">,
  flow: RebalanceDemoFlowResult,
  observer: RebalanceDemoLpObserverSnapshot | undefined,
  extras?: { readonly pendingApprovalId?: string },
): RebalanceDemoRunMetadata {
  const pendingApproval =
    extras?.pendingApprovalId !== undefined && extras.pendingApprovalId.length > 0
      ? { approvalId: extras.pendingApprovalId }
      : undefined;
  return {
    kind: "rebalance_demo_v1",
    omRatePath: input.omRatePath,
    chain: input.chain,
    tokenA: input.tokenA,
    tokenB: input.tokenB,
    flowStatus: flow.status,
    omRateSummary: flow.omRate.summary,
    omRateExecutionEvidence: flow.omRateExecutionEvidence,
    plannerSummary: flow.planner.summary,
    selectedPool: flow.selectedPool,
    swapPreparation: flow.swapPreparation,
    lpDepositPayloadSeed: flow.lpDepositPayloadSeed,
    lpExecution: {
      ready: observer?.readyForExecution ?? false,
      missingFields: observer ? [...observer.missingExecutionFields] : [],
      observerSummary: observer?.summary ?? "No planner observer was available for this run.",
      action: observer?.action,
      target: observer?.target,
    },
    pendingApproval,
  };
}

function parseBodyPreview(bodyPreview: string | undefined): unknown {
  if (!bodyPreview) {
    return undefined;
  }
  try {
    return JSON.parse(bodyPreview) as unknown;
  } catch {
    return undefined;
  }
}

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function collectCandidateObjects(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (!value || typeof value !== "object" || depth > 6) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidateObjects(item, out, depth + 1);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  out.push(obj);
  for (const key of ["candidates", "pools", "suggestions", "operations", "data", "items", "results"] as const) {
    collectCandidateObjects(obj[key], out, depth + 1);
  }
}

function coerceCandidate(obj: Record<string, unknown>): OmRateRebalanceCandidate | null {
  const tokenA = pickString(obj, ["tokenA", "token0", "base", "from", "assetA"]);
  const tokenB = pickString(obj, ["tokenB", "token1", "quote", "to", "assetB"]);
  if (!tokenA || !tokenB) {
    return null;
  }
  return {
    chain: pickString(obj, ["chain", "network", "chainId"]),
    tokenA,
    tokenB,
    poolAddress: pickString(obj, ["poolAddress", "pool", "pairAddress", "address", "pair"]),
    score: pickNumber(obj, ["score", "priority", "apy", "weight"]),
    label: pickString(obj, ["label", "name", "id"]),
  };
}

export function normalizeOmRatePaidResponseToCandidates(parsed: unknown): OmRateRebalanceCandidate[] {
  const buckets: Record<string, unknown>[] = [];
  collectCandidateObjects(parsed, buckets);
  const seen = new Set<string>();
  const result: OmRateRebalanceCandidate[] = [];
  for (const row of buckets) {
    const candidate = coerceCandidate(row);
    if (!candidate) {
      continue;
    }
    const key = [
      (candidate.chain ?? "").toLowerCase(),
      candidate.tokenA.toLowerCase(),
      candidate.tokenB.toLowerCase(),
      (candidate.poolAddress ?? "").toLowerCase(),
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function pickPrimaryCandidate(
  candidates: readonly OmRateRebalanceCandidate[],
): OmRateRebalanceCandidate | undefined {
  let best: OmRateRebalanceCandidate | undefined;
  for (const candidate of candidates) {
    if (!best) {
      best = candidate;
      continue;
    }
    if (candidate.score !== undefined && (best.score === undefined || candidate.score > best.score)) {
      best = candidate;
    }
  }
  return best;
}

function normalizeEvmAddress(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : undefined;
}

function resolveLpTokenAddresses(input: RebalanceDemoFlowInput): { tokenA: string; tokenB: string } | undefined {
  if (input.lpTokenAddresses) {
    const tokenA = normalizeEvmAddress(input.lpTokenAddresses.tokenA);
    const tokenB = normalizeEvmAddress(input.lpTokenAddresses.tokenB);
    if (tokenA && tokenB) {
      return { tokenA, tokenB };
    }
  }
  const tokenA = normalizeEvmAddress(input.tokenA);
  const tokenB = normalizeEvmAddress(input.tokenB);
  if (tokenA && tokenB) {
    return { tokenA, tokenB };
  }
  return undefined;
}

function buildSwapPreparation(
  input: RebalanceDemoFlowInput,
  lpDepositPayloadSeed: Record<string, unknown>,
): RebalanceDemoSwapPreparation {
  if (input.prepareSwap === false) {
    return {
      kind: "swap_preparation",
      status: "not_evaluated",
      summary: "Swap preparation explicitly skipped for this flow run.",
    };
  }

  const resolved = resolveLpTokenAddresses(input);
  const walletHeld = new Set((input.walletHeldTokenAddresses ?? []).map((value) => value.toLowerCase()));
  const seedToken = normalizeEvmAddress(typeof lpDepositPayloadSeed.token === "string" ? lpDepositPayloadSeed.token : undefined);
  const seedTokenSecondary = normalizeEvmAddress(
    typeof lpDepositPayloadSeed.tokenSecondary === "string" ? lpDepositPayloadSeed.tokenSecondary : undefined,
  );
  const tokenA = resolved?.tokenA ?? seedToken;
  const tokenB = resolved?.tokenB ?? seedTokenSecondary;

  if (!tokenA || !tokenB || walletHeld.size === 0) {
    return {
      kind: "swap_preparation",
      status: "insufficient_context",
      summary: "Swap preparation needs LP token addresses plus current wallet holdings.",
    };
  }

  const hasA = walletHeld.has(tokenA);
  const hasB = walletHeld.has(tokenB);
  if (hasA && hasB) {
    return {
      kind: "swap_preparation",
      status: "assets_match",
      summary: "Wallet already appears aligned with the selected LP token pair.",
    };
  }

  if (!input.swapAmountIn || !input.preparationWalletAddress) {
    return {
      kind: "swap_preparation",
      status: "wallet_unfunded_for_pair",
      summary: "Wallet is not aligned with the LP pair and no executable swap amount/wallet was provided.",
    };
  }

  const fromTokenAddress = hasA ? tokenA : hasB ? tokenB : tokenA;
  const toTokenAddress = hasA ? tokenB : hasB ? tokenA : tokenB;
  return {
    kind: "swap_preparation",
    status: "swap_recommended",
    summary: "Wallet holdings are only partially aligned; recommend a preparatory swap before LP deposit.",
    recommendedSwapIntent: {
      action: "swap",
      payload: {
        fromTokenAddress,
        toTokenAddress,
        chain: input.chain,
        wallet: input.preparationWalletAddress,
        amount: input.swapAmountIn,
        slippage: "0.5",
      },
    },
  };
}

function buildLpDepositPayloadSeed(params: {
  readonly input: RebalanceDemoFlowInput;
  readonly selectedCandidate?: OmRateRebalanceCandidate;
  readonly planner: UniswapLiquidityPlannerExecutionResult;
}): Record<string, unknown> {
  const template =
    params.planner.runtimeDownstream && "payloadTemplate" in params.planner.runtimeDownstream
      ? params.planner.runtimeDownstream.payloadTemplate
      : undefined;
  return {
    protocol: "uniswap-v3",
    chain: params.input.chain,
    investmentId:
      typeof template?.investmentId === "string" && template.investmentId.length > 0
        ? template.investmentId
        : params.input.investmentIdSeed ?? "",
    token:
      typeof template?.token === "string" && template.token.length > 0
        ? template.token
        : params.selectedCandidate?.tokenA ?? params.input.tokenA,
    tokenSecondary:
      typeof template?.tokenSecondary === "string" && template.tokenSecondary.length > 0
        ? template.tokenSecondary
        : params.selectedCandidate?.tokenB ?? params.input.tokenB,
    amount: typeof template?.amount === "string" ? template.amount : "",
    amountSecondary: typeof template?.amountSecondary === "string" ? template.amountSecondary : "",
    range: typeof template?.range === "string" ? template.range : "",
    poolAddress:
      typeof template?.poolAddress === "string" && template.poolAddress.length > 0
        ? template.poolAddress
        : params.selectedCandidate?.poolAddress,
    positionType: params.input.positionType ?? "v3",
  };
}

function buildOmRateExecutionEvidence(omRate: OmRateQueryExecutionResult): ExecutionEvidence {
  const payment = buildPaymentEvidenceForOmRateHttpCall({
    x402Requested: omRate.x402Requested,
    paymentRequiredByServer: omRate.paymentRequiredByServer,
    queryStatus: omRate.status,
    httpStatus: omRate.httpStatus,
    paymentAttempted: omRate.paymentAttempted ?? false,
    paymentWrapped: omRate.paymentWrapped ?? false,
    paymentSettled: omRate.paymentSettled ?? false,
    fetchSummary: omRate.fetchSummary ?? "omrate_fetch_summary_unavailable",
    baselineReady: omRate.x402BaselineReady,
    receipt: omRate.paymentReceipt,
  });
  return {
    payment,
    milestones: mergeExecutionMilestones(
      milestonesForOmRateHttpCall({
        queryStatus: omRate.status,
        payment,
      }),
    ),
  };
}

export async function runRebalanceDemoFlow(
  input: RebalanceDemoFlowInput,
  deps: RebalanceDemoFlowDeps,
): Promise<RebalanceDemoFlowResult> {
  const omRate = await deps.executeOmRateQuery(
    {
      path: input.omRatePath,
      method: input.omRateMethod ?? "GET",
      bodyJson: input.omRateBodyJson,
      x402Aware: input.x402Aware ?? true,
    } satisfies OmRateQueryPlanInput,
    deps.env,
  );

  const omRateCandidates = normalizeOmRatePaidResponseToCandidates(parseBodyPreview(omRate.bodyPreview));
  const omRateExecutionEvidence = buildOmRateExecutionEvidence(omRate);
  const selectedCandidate = pickPrimaryCandidate(omRateCandidates);
  const plannerInput: UniswapLiquidityPlannerInvocationInput = {
    chain: input.chain,
    tokenA: selectedCandidate?.tokenA ?? input.tokenA,
    tokenB: selectedCandidate?.tokenB ?? input.tokenB,
    positionType: input.positionType ?? "v3",
  };
  const plannerPlan = deps.planUniswapLiquidityPlannerInvocation(plannerInput, deps.env);
  const planner = await deps.executeUniswapLiquidityPlannerInvocation(plannerPlan as never, deps.env);
  const selectedPool =
    planner.runtimeDownstream?.topUniswapPools.find(
      (pool) => pool.pairAddress?.toLowerCase() === selectedCandidate?.poolAddress?.toLowerCase(),
    ) ?? planner.runtimeDownstream?.topUniswapPools[0];
  const lpDepositPayloadSeed = buildLpDepositPayloadSeed({ input, selectedCandidate, planner });
  const swapPreparation = buildSwapPreparation(input, lpDepositPayloadSeed);

  return {
    status:
      omRate.status !== "completed"
        ? "omrate_not_completed"
        : planner.status !== "completed"
          ? "planner_not_completed"
          : "ok",
    omRate,
    omRateExecutionEvidence,
    omRateCandidates,
    planner,
    selectedPool,
    swapPreparation,
    lpDepositPayloadSeed,
    summaries: {
      omRate: omRate.summary,
      planner: planner.summary,
    },
  };
}
