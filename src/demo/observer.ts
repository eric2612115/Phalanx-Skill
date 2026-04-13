import type { UniswapLiquidityPlannerExecutionResult } from "../adapters/uniswap.js";

export type DemoLpExecutionObserver = {
  readonly target: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly missingExecutionFields: readonly string[];
  readonly readyForExecution: boolean;
  readonly summary: string;
};

export function buildLpExecutionObserver(
  planner: UniswapLiquidityPlannerExecutionResult,
): DemoLpExecutionObserver | undefined {
  const runtimeDownstream = planner.runtimeDownstream;
  if (!runtimeDownstream) {
    return undefined;
  }
  const missingExecutionFields = [...runtimeDownstream.missingExecutionFields];
  const readyForExecution = missingExecutionFields.length === 0;
  return {
    target: runtimeDownstream.executionTarget,
    action: runtimeDownstream.executionAction,
    payload: { ...runtimeDownstream.payloadTemplate },
    missingExecutionFields,
    readyForExecution,
    summary: readyForExecution
      ? "Planner downstream is execution-ready without operator-supplied LP overrides."
      : `Planner downstream still needs runtime/operator completion for: ${missingExecutionFields.join(", ")}.`,
  };
}
