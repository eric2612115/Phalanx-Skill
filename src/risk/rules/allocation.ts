import type { RuntimeIntent } from "../../runtime/types.js";
import type { RuleResult } from "./operational.js";

const DEFAULT_MAX_DRIFT_BPS = 500;

export function allocationRule(intent: RuntimeIntent, maxDriftBps: number = DEFAULT_MAX_DRIFT_BPS): RuleResult {
  const drift = intent.payload.allocationDriftBps;
  if (typeof drift === "number" && drift > maxDriftBps) {
    return {
      pass: false,
      code: "ALLOCATION_DRIFT",
      message: `Allocation drift ${drift} bps exceeds ${maxDriftBps} bps`,
    };
  }

  const concentration = intent.payload.protocolConcentrationBps;
  if (typeof concentration === "number" && concentration > 9000) {
    return {
      pass: false,
      code: "OVER_CONCENTRATION",
      message: "Over-concentration in a single protocol",
    };
  }

  return { pass: true };
}
