import type { RuntimeIntent } from "../../runtime/types.js";
import type { RuleResult } from "./operational.js";

export function lendingRule(intent: RuntimeIntent): RuleResult {
  const health = intent.payload.lendingHealthScore;
  if (typeof health === "number" && health < 0.2) {
    return {
      pass: false,
      code: "LENDING_HEALTH",
      message: "Lending health score below threshold",
    };
  }

  const apyAnomaly = intent.payload.lendingApyAnomaly;
  if (typeof apyAnomaly === "boolean" && apyAnomaly) {
    return {
      pass: false,
      code: "LENDING_APY_ANOMALY",
      message: "Lending APY anomaly detected",
    };
  }

  return { pass: true };
}
