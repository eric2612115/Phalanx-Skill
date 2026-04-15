import {
  buildRebalanceDemoRunMetadata,
  type RebalanceDemoFlowInput,
  type RebalanceDemoFlowResult,
  type RebalanceDemoRunMetadata,
} from "./rebalance-flow.js";
import { buildLpExecutionObserver } from "./observer.js";
import { buildRuntimeEvent, type RuntimeEvent } from "../runtime/events.js";
import type { RuntimeIntent, RuntimeOutcome } from "../runtime/types.js";
import { mergeExecutionMilestones, type ExecutionMilestones } from "../runtime/execution-evidence.js";

export type AllocationMainlineStageKey =
  | "funding_readiness"
  | "omrate_intelligence"
  | "x402_payment_evidence"
  | "allocation_decisions"
  | "aave_execution"
  | "morpho_execution"
  | "uniswap_lp_attempt"
  | "whitelist_approval_pause"
  | "approval_resume"
  | "lp_completion"
  | "grouped_reporting_readiness"
  | "portfolio_push_readiness";

export interface AllocationStageOutcome {
  readonly stage: AllocationMainlineStageKey;
  readonly status: "ok" | "blocked" | "skipped";
  readonly summary: string;
}

export type PhalanxActionBridgeResult =
  | { readonly ok: true; readonly kind: "executed"; readonly adapterResult: unknown }
  | { readonly ok: true; readonly kind: "pending_approval"; readonly approvalId: string; readonly intentId?: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface GuardianAllocationMainlineBridge {
  readonly runRebalanceDemo: (input: RebalanceDemoFlowInput) => Promise<RebalanceDemoFlowResult>;
  readonly publishRuntimeEvent: (event: RuntimeEvent) => Promise<void>;
  readonly invokePhalanxAction: (args: {
    readonly action: string;
    readonly payload: unknown;
    readonly target?: string;
  }) => Promise<PhalanxActionBridgeResult>;
  readonly assessFundingReadiness?: (input: {
    readonly demoInput: RebalanceDemoFlowInput;
    readonly flow: RebalanceDemoFlowResult;
  }) => { readonly ok: boolean; readonly summary: string };
  /**
   * Optional host hook: wrap MCP execution so RuntimeCore MCP events can carry `demoRun` augmentation
   * (matches legacy guardian demo behavior).
   */
  readonly scopeAugmentDemoRun?: <T>(meta: RebalanceDemoRunMetadata, fn: () => Promise<T>) => Promise<T>;
}

export interface GuardianAllocationMainlineInput {
  readonly demoInput: RebalanceDemoFlowInput;
  readonly guardianReason: string;
}

export interface GuardianAllocationMainlineResult {
  readonly stages: readonly AllocationStageOutcome[];
  readonly outcome: RuntimeOutcome;
  readonly demoRun?: RebalanceDemoRunMetadata;
  readonly guardianApprovalContext?: {
    readonly approvalId: string;
    readonly resumedAction: string;
    readonly target?: string;
    readonly demoRun: RebalanceDemoRunMetadata;
  };
}

function pushStage(
  stages: AllocationStageOutcome[],
  stage: AllocationMainlineStageKey,
  status: AllocationStageOutcome["status"],
  summary: string,
): void {
  stages.push({ stage, status, summary });
}

function pickPrimaryToken(seed: Record<string, unknown>): string {
  const raw = seed.token;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "USDC";
}

function buildAllocationRebalancePayload(flow: RebalanceDemoFlowResult, chain: string): Record<string, unknown> {
  const seed = flow.lpDepositPayloadSeed;
  const token = pickPrimaryToken(seed);
  const investmentBase =
    typeof seed.investmentId === "string" && seed.investmentId.length > 0
      ? seed.investmentId
      : `allocation-${chain}`;
  return {
    reason: "allocation_mainline",
    riskNotes: [flow.swapPreparation.summary],
    operations: [
      {
        action: "deposit" as const,
        payload: {
          chain,
          investmentId: `${investmentBase}-aave`,
          token,
          amount: typeof seed.amount === "string" && seed.amount.length > 0 ? seed.amount : "1",
          platformId: "aave-v3",
          _allocationSegment: "aave",
        },
      },
      {
        action: "deposit" as const,
        payload: {
          chain,
          investmentId: `${investmentBase}-morpho`,
          token,
          amount: typeof seed.amount === "string" && seed.amount.length > 0 ? seed.amount : "1",
          platformId: "morpho-vaults",
          _allocationSegment: "morpho",
        },
      },
    ],
  };
}

function readLegSegments(adapterResult: unknown): { readonly aave: boolean; readonly morpho: boolean } {
  if (!adapterResult || typeof adapterResult !== "object") {
    return { aave: false, morpho: false };
  }
  const legs = (adapterResult as { legs?: unknown }).legs;
  if (!Array.isArray(legs)) {
    return { aave: false, morpho: false };
  }
  let aave = false;
  let morpho = false;
  for (const leg of legs) {
    if (leg && typeof leg === "object") {
      const seg = (leg as { allocationSegment?: string }).allocationSegment;
      if (seg === "aave") {
        aave = true;
      }
      if (seg === "morpho") {
        morpho = true;
      }
    }
  }
  return { aave, morpho };
}

function mergeDemoMilestones(
  meta: RebalanceDemoRunMetadata,
  extra: ExecutionMilestones,
): RebalanceDemoRunMetadata {
  return {
    ...meta,
    omRateExecutionEvidence: {
      ...meta.omRateExecutionEvidence,
      milestones: mergeExecutionMilestones(meta.omRateExecutionEvidence.milestones ?? {}, extra),
    },
  };
}

function amountFactPresent(flow: RebalanceDemoFlowResult): boolean {
  const amount = flow.lpDepositPayloadSeed.amount;
  const amountSecondary = flow.lpDepositPayloadSeed.amountSecondary;
  return (
    (typeof amount === "string" && amount.trim().length > 0) ||
    (typeof amountSecondary === "string" && amountSecondary.trim().length > 0)
  );
}

function defaultFundingReadiness(flow: RebalanceDemoFlowResult): { readonly ok: boolean; readonly summary: string } {
  const amountReady = amountFactPresent(flow);
  const swapFundingReady =
    flow.swapPreparation.status !== "wallet_unfunded_for_pair" && flow.swapPreparation.status !== "insufficient_context";
  if (amountReady && swapFundingReady) {
    return {
      ok: true,
      summary: "Funding readiness is supported by planner amounts and current swap-preparation facts.",
    };
  }
  return {
    ok: false,
    summary: "Funding readiness is not established by the available LP amount or swap-preparation facts.",
  };
}

/**
 * Proactive allocation orchestration lane: OmRate + planner context, x402 evidence, lending allocation legs
 * (Aave + Morpho), Uniswap LP attempt, optional whitelist pause, then reporting/portfolio readiness markers.
 */
export async function executeGuardianAllocationMainline(
  input: GuardianAllocationMainlineInput,
  bridge: GuardianAllocationMainlineBridge,
): Promise<GuardianAllocationMainlineResult> {
  const stages: AllocationStageOutcome[] = [];
  const flow = await bridge.runRebalanceDemo(input.demoInput);
  const funding = bridge.assessFundingReadiness?.({ demoInput: input.demoInput, flow }) ?? defaultFundingReadiness(flow);
  pushStage(
    stages,
    "funding_readiness",
    funding.ok ? "ok" : "blocked",
    funding.summary,
  );
  if (!funding.ok) {
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: `guardian-allocation-${Date.now()}`,
        stage: "policy",
        code: "FUNDING_NOT_READY",
        message: funding.summary,
      },
    };
  }

  const demoInput = {
    omRatePath: input.demoInput.omRatePath,
    chain: input.demoInput.chain,
    tokenA: input.demoInput.tokenA,
    tokenB: input.demoInput.tokenB,
  };

  const proposalIntent: RuntimeIntent = {
    id: `guardian-demo-proposal-${Date.now()}`,
    lane: "execution",
    action: "proposeRebalance",
    payload: {
      reason: input.guardianReason,
      riskNotes: [flow.swapPreparation.summary],
    },
    entrySource: "guardian",
    target: "uniswap-v3",
  };

  const observer = buildLpExecutionObserver(flow.planner);
  const demoRunBase = buildRebalanceDemoRunMetadata(
    demoInput,
    flow,
    observer
      ? {
          readyForExecution: observer.readyForExecution,
          missingExecutionFields: observer.missingExecutionFields,
          summary: observer.summary,
          action: observer.action,
          target: observer.target,
        }
      : undefined,
  );

  await bridge.publishRuntimeEvent(
    buildRuntimeEvent(proposalIntent, "guardian_detected", {
      summary: [
        `Rebalance candidate ready (allocation mainline)`,
        flow.selectedPool?.pairLabel ? `Pool ${flow.selectedPool.pairLabel}` : undefined,
        flow.swapPreparation.summary,
      ]
        .filter(Boolean)
        .join(" | "),
      reason: input.guardianReason,
      demoRun: demoRunBase,
    }),
  );

  const omOk = flow.omRate.status === "completed";
  pushStage(
    stages,
    "omrate_intelligence",
    omOk ? "ok" : "blocked",
    omOk ? "OmRate intelligence query completed." : `OmRate query did not complete (${flow.omRate.status}).`,
  );
  if (!omOk) {
    const demoRun = mergeDemoMilestones(demoRunBase, { omrate_requested: true });
    await bridge.publishRuntimeEvent(
      buildRuntimeEvent(proposalIntent, "blocked", {
        summary: stages[stages.length - 1]!.summary,
        reason: "OMRATE_NOT_COMPLETED",
        demoRun,
      }),
    );
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "policy",
        code: "OMRATE_NOT_COMPLETED",
        message: stages[stages.length - 1]!.summary,
      },
      demoRun,
    };
  }

  const pay = flow.omRateExecutionEvidence.payment ?? {
    mode: "plain" as const,
    paymentRequired: false,
    baselineReady: false,
    paymentAttempted: false,
    paymentWrapped: false,
    paymentSettled: false,
    summary: "payment_evidence_missing",
  };
  const x402Ok =
    !pay.paymentRequired ||
    (pay.paymentAttempted && pay.paymentWrapped && pay.paymentSettled && pay.baselineReady);
  pushStage(
    stages,
    "x402_payment_evidence",
    x402Ok ? "ok" : "blocked",
    x402Ok
      ? "x402 / payment evidence satisfies allocation gate."
      : "Paid OmRate path is incomplete; allocation mainline stops before execution.",
  );
  if (!x402Ok) {
    const demoRun = mergeDemoMilestones(demoRunBase, {
      omrate_requested: true,
      x402_required: pay.paymentRequired,
    });
    await bridge.publishRuntimeEvent(
      buildRuntimeEvent(proposalIntent, "blocked", {
        summary: stages[stages.length - 1]!.summary,
        reason: "X402_PAYMENT_INCOMPLETE",
        demoRun,
      }),
    );
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "policy",
        code: "X402_PAYMENT_INCOMPLETE",
        message: stages[stages.length - 1]!.summary,
      },
      demoRun,
    };
  }

  const plannerOk = flow.planner.status === "completed";
  const allocationReady = plannerOk && observer !== undefined && observer.readyForExecution;
  const allocationSummary = !plannerOk
    ? "Planner did not complete."
    : allocationReady
      ? "Planner completed; allocation legs derived from OmRate + planner handoff."
      : [
          observer?.summary ?? "Planner downstream is not execution-ready yet.",
          flow.selectedPool?.pairLabel
            ? `Pool ${flow.selectedPool.pairLabel} (${flow.selectedPool.pairAddress ?? "?"})`
            : undefined,
          `Swap prep: ${flow.swapPreparation.status}`,
        ]
          .filter(Boolean)
          .join(" | ");
  pushStage(stages, "allocation_decisions", allocationReady ? "ok" : "blocked", allocationSummary);
  if (!plannerOk) {
    const demoRun = mergeDemoMilestones(demoRunBase, { allocation_planned: false });
    await bridge.publishRuntimeEvent(
      buildRuntimeEvent(proposalIntent, "blocked", {
        summary: allocationSummary,
        reason: "PLANNER_NOT_COMPLETED",
        demoRun,
      }),
    );
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "policy",
        code: "PLANNER_NOT_COMPLETED",
        message: allocationSummary,
      },
      demoRun,
    };
  }

  if (!allocationReady) {
    const demoRun = mergeDemoMilestones(demoRunBase, { allocation_planned: false });
    await bridge.publishRuntimeEvent(
      buildRuntimeEvent(proposalIntent, "blocked", {
        summary: allocationSummary,
        reason: "DEMO_OBSERVER_NOT_READY",
        demoRun,
      }),
    );
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "approval_class",
        code: "DEMO_OBSERVER_NOT_READY",
        message: observer?.summary ?? "Planner downstream is not execution-ready yet.",
      },
      demoRun,
    };
  }

  const runExecutionWave = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (bridge.scopeAugmentDemoRun) {
      return bridge.scopeAugmentDemoRun(demoRunBase, fn);
    }
    return fn();
  };

  type ExecutionWaveResult =
    | { readonly kind: "swap_blocked"; readonly message: string; readonly code: string }
    | { readonly kind: "mcp_blocked"; readonly message: string; readonly code: string }
    | { readonly kind: "legs_incomplete" }
    | {
        readonly kind: "lp_pending";
        readonly lpOut: PhalanxActionBridgeResult & { readonly ok: true; readonly kind: "pending_approval" };
        readonly demoRunProgress: RebalanceDemoRunMetadata;
      }
    | {
        readonly kind: "lp_executed";
        readonly lpOut: PhalanxActionBridgeResult & { readonly ok: true; readonly kind: "executed" };
        readonly demoRunProgress: RebalanceDemoRunMetadata;
      };

  const wave = await runExecutionWave(async (): Promise<ExecutionWaveResult> => {
    if (flow.swapPreparation.recommendedSwapIntent) {
      const swapOut = await bridge.invokePhalanxAction({
        action: "swap",
        payload: flow.swapPreparation.recommendedSwapIntent.payload,
        target: "pool",
      });
      if (!swapOut.ok || swapOut.kind !== "executed") {
        return {
          kind: "swap_blocked",
          message: swapOut.ok ? "Unexpected swap outcome" : swapOut.message,
          code: swapOut.ok ? "UNEXPECTED_SWAP_OUTCOME" : swapOut.code,
        };
      }
    }

    const rebalancePayload = buildAllocationRebalancePayload(flow, input.demoInput.chain);
    const rebalanceOut = await bridge.invokePhalanxAction({
      action: "executeRebalance",
      payload: rebalancePayload,
      target: "pool",
    });
    if (!rebalanceOut.ok || rebalanceOut.kind !== "executed") {
      return {
        kind: "mcp_blocked",
        message: rebalanceOut.ok ? "Unexpected rebalance outcome" : rebalanceOut.message,
        code: rebalanceOut.ok ? "UNEXPECTED_REBALANCE_OUTCOME" : rebalanceOut.code,
      };
    }

    const segments = readLegSegments(rebalanceOut.adapterResult);
    if (!segments.aave || !segments.morpho) {
      return { kind: "legs_incomplete" };
    }

    const demoRunProgress = mergeDemoMilestones(demoRunBase, {
      funding_ready: true,
      allocation_planned: true,
      aave_executed: true,
      morpho_executed: true,
    });

    const lpOut = await bridge.invokePhalanxAction({
      action: observer.action,
      payload: observer.payload,
      target: observer.target,
    });
    if (!lpOut.ok) {
      return { kind: "mcp_blocked", message: lpOut.message, code: lpOut.code };
    }
    if (lpOut.kind === "pending_approval") {
      return { kind: "lp_pending", lpOut, demoRunProgress };
    }
    return { kind: "lp_executed", lpOut, demoRunProgress };
  });

  if (wave.kind === "swap_blocked") {
    pushStage(stages, "aave_execution", "blocked", wave.message);
    const demoRun = mergeDemoMilestones(demoRunBase, { funding_ready: false });
    const swapIntent: RuntimeIntent = {
      id: proposalIntent.id,
      lane: "execution",
      action: "swap",
      payload: flow.swapPreparation.recommendedSwapIntent!.payload as Record<string, unknown>,
      entrySource: "guardian",
      target: "pool",
    };
    await bridge.publishRuntimeEvent(
      buildRuntimeEvent(swapIntent, "blocked", {
        summary: wave.message,
        reason: wave.code,
        demoRun,
      }),
    );
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "policy",
        code: wave.code,
        message: wave.message,
      },
      demoRun,
    };
  }

  if (wave.kind === "mcp_blocked") {
    pushStage(stages, "aave_execution", "blocked", wave.message);
    pushStage(stages, "morpho_execution", "skipped", "Skipped because a prior MCP execution step did not complete.");
    const demoRun = mergeDemoMilestones(demoRunBase, {});
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "policy",
        code: wave.code,
        message: wave.message,
      },
      demoRun,
    };
  }

  if (wave.kind === "legs_incomplete") {
    pushStage(stages, "aave_execution", "blocked", "Aave allocation segment missing from execution results.");
    pushStage(stages, "morpho_execution", "blocked", "Morpho allocation segment missing from execution results.");
    const demoRun = mergeDemoMilestones(demoRunBase, {
      aave_executed: false,
      morpho_executed: false,
    });
    return {
      stages,
      outcome: {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "policy",
        code: "ALLOCATION_LEG_INCOMPLETE",
        message: "Aave and Morpho legs must both be present in the allocation execution bundle.",
      },
      demoRun,
    };
  }

  pushStage(stages, "aave_execution", "ok", "Aave-oriented deposit leg completed.");
  pushStage(stages, "morpho_execution", "ok", "Morpho-oriented deposit leg completed.");

  pushStage(
    stages,
    "uniswap_lp_attempt",
    "ok",
    wave.kind === "lp_executed"
      ? "Uniswap LP deposit executed."
      : "Uniswap LP deposit requires whitelist or operator approval (awaiting human decision).",
  );

  if (wave.kind === "lp_pending") {
    const { lpOut } = wave;
    const demoPending = buildRebalanceDemoRunMetadata(
      demoInput,
      flow,
      {
        readyForExecution: observer.readyForExecution,
        missingExecutionFields: observer.missingExecutionFields,
        summary: observer.summary,
        action: observer.action,
        target: observer.target,
      },
      { pendingApprovalId: lpOut.approvalId },
    );
    const demoRunProgress = mergeDemoMilestones(demoPending, {
      funding_ready: true,
      allocation_planned: true,
      aave_executed: true,
      morpho_executed: true,
      uniswap_blocked_for_approval: true,
      approval_requested: true,
      grouped_reporting_ready: true,
    });
    pushStage(stages, "whitelist_approval_pause", "ok", "Runtime paused for whitelist / LP approval token.");
    pushStage(stages, "approval_resume", "skipped", "Awaiting Telegram decision; resume handled by RuntimeCore.submitApprovalDecision.");
    pushStage(stages, "lp_completion", "skipped", "LP not completed until approval resumes.");
    pushStage(stages, "grouped_reporting_readiness", "ok", "Partial run metadata is suitable for grouped reporting surfaces.");
    pushStage(stages, "portfolio_push_readiness", "skipped", "Portfolio push waits for LP completion.");
    return {
      stages,
      outcome: {
        type: "pending_approval",
        intentId: lpOut.intentId ?? proposalIntent.id,
        approvalId: lpOut.approvalId,
      },
      demoRun: demoRunProgress,
      guardianApprovalContext: {
        approvalId: lpOut.approvalId,
        resumedAction: observer.action,
        target: observer.target,
        demoRun: demoRunProgress,
      },
    };
  }

  if (wave.kind !== "lp_executed") {
    throw new Error("allocation mainline: unexpected execution wave outcome");
  }
  const { lpOut, demoRunProgress: baseProgress } = wave;

  let demoRunProgress = mergeDemoMilestones(baseProgress, {
    uniswap_executed: true,
    approval_resumed: false,
    tx_refs_captured: true,
    grouped_reporting_ready: true,
    portfolio_push_ready: true,
  });
  pushStage(stages, "whitelist_approval_pause", "ok", "No whitelist pause required for this LP target.");
  pushStage(stages, "approval_resume", "ok", "No approval resume required; LP executed inline.");
  pushStage(stages, "lp_completion", "ok", "LP deposit leg completed.");
  pushStage(stages, "grouped_reporting_readiness", "ok", "Execution evidence and demo metadata are ready for grouped reporting.");
  pushStage(stages, "portfolio_push_readiness", "ok", "Portfolio push may proceed using latest execution bundle.");

  return {
    stages,
    outcome: {
      type: "executed",
      intentId: proposalIntent.id,
      adapterResult: lpOut.adapterResult,
    },
    demoRun: demoRunProgress,
  };
}
