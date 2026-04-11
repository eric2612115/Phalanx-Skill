export interface RiskEvaluationContext {
  /** Wall-clock ms; inject fixed value in tests for determinism. */
  readonly now: number;
}
