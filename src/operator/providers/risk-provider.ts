import type { PhalanxHost } from "../../app/host.js";
import type { GuardianLastAssessment } from "../../guardian/operator-assessment.js";

export interface OperatorRiskSnapshot {
  readonly engineRuleOrder: readonly string[];
  readonly riskContext: ReturnType<PhalanxHost["getRiskEvaluationContext"]>;
  readonly guardianLastAssessment: GuardianLastAssessment | undefined;
}

export async function fetchOperatorRiskSnapshot(host: PhalanxHost): Promise<OperatorRiskSnapshot> {
  return {
    engineRuleOrder: host.getRiskRuleOrder(),
    riskContext: host.getRiskEvaluationContext(),
    guardianLastAssessment: host.getGuardianLastAssessment(),
  };
}
