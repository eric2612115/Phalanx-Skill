import type { RuntimeIntent } from "../../runtime/types.js";
import type { RuleResult } from "./operational.js";

export function lpRule(intent: RuntimeIntent): RuleResult {
  const inRange = intent.payload.lpInRange;
  const strict = intent.payload.lpStrictRange === true;

  if (strict && inRange === false) {
    return {
      pass: false,
      code: "LP_OUT_OF_RANGE",
      message: "LP position out of range under strict policy",
    };
  }

  const feeWeak = intent.payload.lpWeakFees;
  if (typeof feeWeak === "boolean" && feeWeak) {
    return {
      pass: false,
      code: "LP_WEAK_FEES",
      message: "LP fee generation weak versus policy",
    };
  }

  return { pass: true };
}
