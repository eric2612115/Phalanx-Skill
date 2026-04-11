import type { RuntimeIntent } from "../runtime/types.js";
import type { RiskEvaluationContext } from "./context.js";
import { operationalRule } from "./rules/operational.js";
import { allocationRule } from "./rules/allocation.js";
import { lendingRule } from "./rules/lending.js";
import { lpRule } from "./rules/lp.js";

export type { RiskEvaluationContext } from "./context.js";

export type RiskRuleEvaluator = (intent: RuntimeIntent, ctx: RiskEvaluationContext) => {
  pass: boolean;
  code?: string;
  message?: string;
};

export interface RiskRule {
  readonly name: string;
  readonly evaluate: RiskRuleEvaluator;
}

export interface RiskEngineResult {
  readonly ok: boolean;
  readonly failedRule?: string;
  readonly code?: string;
  readonly message?: string;
}

const DEFAULT_RULES: readonly RiskRule[] = [
  {
    name: "operational",
    evaluate: (intent, ctx) => operationalRule(intent, ctx),
  },
  {
    name: "allocation",
    evaluate: (intent) => allocationRule(intent),
  },
  {
    name: "lending",
    evaluate: (intent) => lendingRule(intent),
  },
  {
    name: "lp",
    evaluate: (intent) => lpRule(intent),
  },
];

/**
 * Deterministic risk evaluation: fixed rule order, pure rule functions, no randomness.
 */
export class RiskEngine {
  constructor(private readonly rules: readonly RiskRule[] = DEFAULT_RULES) {}

  evaluate(intent: RuntimeIntent, ctx: RiskEvaluationContext): RiskEngineResult {
    for (const rule of this.rules) {
      const r = rule.evaluate(intent, ctx);
      if (!r.pass) {
        return {
          ok: false,
          failedRule: rule.name,
          code: r.code ?? "RISK_FAIL",
          message: r.message ?? "Risk check failed",
        };
      }
    }
    return { ok: true };
  }
}
