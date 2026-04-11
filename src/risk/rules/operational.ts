import type { RuntimeIntent } from "../../runtime/types.js";
import type { RiskEvaluationContext } from "../context.js";

export interface RuleResult {
  readonly pass: boolean;
  readonly code?: string;
  readonly message?: string;
}

export function operationalRule(intent: RuntimeIntent, ctx: RiskEvaluationContext): RuleResult {
  if (typeof intent.payload.adapterCapabilityUnknown === "boolean" && intent.payload.adapterCapabilityUnknown) {
    return {
      pass: false,
      code: "ADAPTER_CAPABILITY_UNKNOWN",
      message: "Adapter capability is unknown; block until probed",
    };
  }

  if (typeof intent.payload.dataStale === "boolean" && intent.payload.dataStale) {
    return {
      pass: false,
      code: "STALE_DATA",
      message: "Underlying data is stale",
    };
  }

  if (ctx.now <= 0) {
    return {
      pass: false,
      code: "INVALID_CLOCK",
      message: "Risk context clock is invalid",
    };
  }

  void intent;
  return { pass: true };
}
