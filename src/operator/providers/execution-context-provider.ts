import type { PhalanxHost } from "../../app/host.js";
import type { ExecutionEvidence, PaymentEvidence, WalletEvidence } from "../../runtime/execution-evidence.js";

export type OperatorRuntimeExecutionContextSnapshot =
  | {
      readonly status: "ok";
      readonly sourceEventId: string;
      readonly createdAt: string;
      readonly sourceAction: string;
      readonly sourceStage: string;
      readonly wallet?: WalletEvidence;
      readonly payment?: PaymentEvidence;
      readonly milestones?: ExecutionEvidence["milestones"];
    }
  | { readonly status: "empty"; readonly message: string };

/**
 * Latest runtime event that carries wallet or payment evidence (bounded scan).
 * Uses recorded runtime events only; does not synthesize evidence.
 */
export async function fetchOperatorRuntimeExecutionContextSnapshot(
  host: PhalanxHost,
): Promise<OperatorRuntimeExecutionContextSnapshot> {
  const events = host.getRuntimeEvents(80);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const ee = e.executionEvidence;
    if (!ee) {
      continue;
    }
    if (!ee.wallet && !ee.payment) {
      continue;
    }
    return {
      status: "ok",
      sourceEventId: e.eventId,
      createdAt: e.createdAt,
      sourceAction: e.action,
      sourceStage: e.stage,
      wallet: ee.wallet,
      payment: ee.payment,
      milestones: ee.milestones,
    };
  }
  return {
    status: "empty",
    message: "No recent runtime events include wallet or payment executionEvidence.",
  };
}
