import type { PortfolioSnapshot } from "../adapters/portfolio.js";
import type { RuntimeIntent } from "../runtime/types.js";

export type GuardianOutcomeKind = "NOTIFY_ONLY" | "AUTO_EXECUTE" | "AUTO_EXECUTE_EMERGENCY";

export interface GuardianExplanation {
  readonly detected: string;
  readonly whyItMatters: string;
  readonly whatWeDid: string;
  readonly furtherAction?: string;
}

export interface GuardianCycleItem {
  readonly outcome: GuardianOutcomeKind;
  readonly intent?: RuntimeIntent;
  readonly explanation: GuardianExplanation;
}

export interface GuardianCycleResult {
  readonly items: readonly GuardianCycleItem[];
}

export interface GuardianCycleInput {
  readonly now: number;
  readonly portfolio: PortfolioSnapshot;
  /** When max |current−target| per bucket exceeds this, request approval to rebalance. */
  readonly driftThresholdBps?: number;
  /** Lending health score below this triggers emergency classification (when score is present). */
  readonly lendingHealthEmergencyThreshold?: number;
}

const DEFAULT_DRIFT_BPS = 500;
const DEFAULT_LENDING_HEALTH_MIN = 0.2;

function maxBucketDriftBps(portfolio: PortfolioSnapshot): number {
  let max = 0;
  for (const b of portfolio.buckets) {
    const d = Math.abs(b.currentBps - b.targetBps);
    if (d > max) {
      max = d;
    }
  }
  return max;
}

function buildRebalanceIntent(now: number, portfolio: PortfolioSnapshot): RuntimeIntent {
  return {
    id: `guardian-rebalance-${now}`,
    lane: "execution",
    action: "executeRebalance",
    payload: {
      reason: "bucket_drift",
      asOf: portfolio.asOf,
      buckets: portfolio.buckets.map((b) => ({
        kind: b.kind,
        currentBps: b.currentBps,
        targetBps: b.targetBps,
      })),
      riskNotes: [
        "Autonomous rebalance may temporarily increase single-protocol concentration during execution.",
      ],
    },
    entrySource: "guardian",
    target: "pool",
  };
}

function buildEmergencyIntent(now: number, portfolio: PortfolioSnapshot): RuntimeIntent {
  return {
    id: `guardian-emergency-${now}`,
    lane: "execution",
    action: "emergencyExit",
    payload: {
      reason: "lending_health_critical",
      asOf: portfolio.asOf,
      evidenceRef: `guardian:lending_health:${now}`,
      riskNotes: ["Lending health is below emergency threshold; rapid exit may trade off execution quality for solvency."],
    },
    entrySource: "guardian",
    target: "pool",
  };
}

/**
 * Deterministic Guardian evaluation: emergency health first, then bucket drift, else notify-only.
 */
export function runGuardianCycle(input: GuardianCycleInput): GuardianCycleResult {
  const driftThresholdBps = input.driftThresholdBps ?? DEFAULT_DRIFT_BPS;
  const healthMin = input.lendingHealthEmergencyThreshold ?? DEFAULT_LENDING_HEALTH_MIN;
  const { portfolio, now } = input;

  const health = portfolio.lendingHealthScore;
  if (typeof health === "number" && health < healthMin) {
    return {
      items: [
        {
          outcome: "AUTO_EXECUTE_EMERGENCY",
          intent: buildEmergencyIntent(now, portfolio),
          explanation: {
            detected: `Lending health score ${health} is below emergency threshold ${healthMin}.`,
            whyItMatters: "Low health indicates elevated liquidation or protocol stress risk.",
            whatWeDid: "Classified the cycle as AUTO_EXECUTE_EMERGENCY and prepared an emergencyExit intent for the runtime pipeline.",
            furtherAction: "Runtime should notify when feasible before execution; otherwise notify immediately after with evidence references.",
          },
        },
      ],
    };
  }

  const drift = maxBucketDriftBps(portfolio);
  if (drift > driftThresholdBps) {
    return {
      items: [
        {
          outcome: "AUTO_EXECUTE",
          intent: buildRebalanceIntent(now, portfolio),
          explanation: {
            detected: `Bucket allocation drift ${drift} bps exceeds allowed ${driftThresholdBps} bps.`,
            whyItMatters: "Large drift means the live portfolio no longer matches the strategy targets.",
            whatWeDid: "Prepared an executeRebalance intent for the runtime auto-execution lane.",
            furtherAction: "Telegram should send a post-execution report with reason, risk notes, and tx references.",
          },
        },
      ],
    };
  }

  return {
    items: [
      {
        outcome: "NOTIFY_ONLY",
        explanation: {
          detected: "Portfolio buckets are within drift tolerance and no emergency lending signal was present.",
          whyItMatters: "No automated action is required for allocation or emergency rules on this cycle.",
          whatWeDid: "Recorded a notify-only Guardian outcome with no execution intent.",
        },
      },
    ],
  };
}
