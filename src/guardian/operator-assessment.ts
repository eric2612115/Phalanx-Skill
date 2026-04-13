import type { GuardianCycleResult, GuardianOutcomeKind } from "./cycle.js";

export interface GuardianLastAssessmentItem {
  readonly outcome: GuardianOutcomeKind;
  readonly intentAction?: string;
  readonly detected: string;
  readonly whyItMatters: string;
  readonly whatWeDid: string;
  readonly furtherAction?: string;
}

export interface GuardianLastAssessment {
  readonly assessedAt: string;
  readonly items: readonly GuardianLastAssessmentItem[];
}

export function summarizeGuardianCycleForOperator(result: GuardianCycleResult): GuardianLastAssessment {
  return {
    assessedAt: new Date().toISOString(),
    items: result.items.map((item) => ({
      outcome: item.outcome,
      intentAction: item.intent?.action,
      detected: item.explanation.detected,
      whyItMatters: item.explanation.whyItMatters,
      whatWeDid: item.explanation.whatWeDid,
      furtherAction: item.explanation.furtherAction,
    })),
  };
}
