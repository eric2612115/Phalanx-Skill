import { extractRuntimeTxRefs } from "../runtime/events.js";
import { mergeExecutionMilestones } from "../runtime/execution-evidence.js";
import type { RuntimeOutcome } from "../runtime/types.js";
import type { GuardianCycleResult } from "../guardian/cycle.js";
import type { RebalanceDemoRunMetadata } from "../demo/rebalance-flow.js";

export type GuardianDemoApprovalContext = {
  readonly resumedAction: string;
  readonly target?: string;
  readonly demoRun?: RebalanceDemoRunMetadata;
};

export function finalizeGuardianDemoRunForOutcome(
  demoRun: RebalanceDemoRunMetadata | undefined,
  outcome: RuntimeOutcome,
  approved: boolean,
): RebalanceDemoRunMetadata | undefined {
  if (!demoRun || !approved || outcome.type !== "executed") {
    return demoRun;
  }
  const txRefs = extractRuntimeTxRefs(outcome.adapterResult) ?? [];
  return {
    ...demoRun,
    omRateExecutionEvidence: {
      ...demoRun.omRateExecutionEvidence,
      milestones: mergeExecutionMilestones(demoRun.omRateExecutionEvidence.milestones ?? {}, {
        approval_resumed: true,
        uniswap_executed: true,
        tx_refs_captured: txRefs.length > 0 ? true : undefined,
        grouped_reporting_ready: true,
        portfolio_push_ready: true,
      }),
    },
  };
}

export function buildSyntheticGuardianRebalanceItem(
  detected: string,
): GuardianCycleResult["items"][number] {
  const now = Date.now();
  return {
    outcome: "AUTO_EXECUTE",
    intent: {
      id: `smoke-agentic-allocation-${now}`,
      lane: "execution",
      action: "executeRebalance",
      payload: {
        reason: "smoke_allocation_mainline",
        asOf: new Date().toISOString(),
        buckets: [],
        riskNotes: ["Synthetic guardian item for allocation mainline smoke."],
      },
      entrySource: "guardian",
      target: "pool",
    },
    explanation: {
      detected,
      whyItMatters: "Operator allocation smoke proof",
      whatWeDid: "Prepared executeRebalance intent for agentic allocation mainline demo lane.",
    },
  };
}
