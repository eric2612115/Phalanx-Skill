import type { PhalanxHost } from "../../app/host.js";

export interface OperatorExplainSnapshot {
  readonly hasExplanation: boolean;
  readonly stage?: "blocked" | "rejected";
  readonly eventId?: string;
  readonly code?: string;
  readonly whatHappened?: string;
  readonly why?: string;
  readonly whatNext?: string;
}

function nextStepHint(code: string | undefined): string {
  switch (code) {
    case "TARGET_NOT_WHITELISTED":
      return "Use an allowlisted target, request whitelist expansion through governance, or update WHITELIST_TARGETS / PHALANX config.";
    case "NOT_READY":
      return "Finish Telegram setup until lifecycle is READY, then retry the action.";
    case "RUNTIME_PAUSED":
      return "Resume the runtime or use read-only tools until execution is unpaused.";
    case "AUTO_BLOCK":
      return "This action is not permitted by policy; choose a supported action or adjust configuration.";
    case "DEMO_OBSERVER_NOT_READY":
      return "Complete missing LP fields from the planner handoff (amounts, range, pool), then rerun the demo flow or operator LP steps.";
    case "RISK_BLOCK":
    case "STALE_DATA":
      return "Review risk inputs and payload constraints, then retry with corrected parameters.";
    default:
      return "Review the latest runtime events and configuration, resolve the blocking reason, then retry.";
  }
}

export async function fetchOperatorExplainSnapshot(host: PhalanxHost): Promise<OperatorExplainSnapshot> {
  const events = host.getRuntimeEvents(200);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.stage !== "blocked" && e.stage !== "rejected") {
      continue;
    }
    const why = e.reason ?? e.summary;
    const whatNext = nextStepHint(e.reason);
    const demo = e.demoRun;
    const demoHint =
      demo &&
      [
        demo.selectedPool?.pairLabel ? `Pool ${demo.selectedPool.pairLabel}` : undefined,
        `Swap prep: ${demo.swapPreparation.status}`,
        demo.lpExecution.ready ? undefined : `LP missing: ${demo.lpExecution.missingFields.join(", ") || "see observer summary"}`,
      ]
        .filter(Boolean)
        .join(" | ");
    return {
      hasExplanation: true,
      stage: e.stage,
      eventId: e.eventId,
      code: e.reason,
      whatHappened: demoHint ? `${e.summary} (${demoHint})` : e.summary,
      why,
      whatNext,
    };
  }
  return { hasExplanation: false };
}
