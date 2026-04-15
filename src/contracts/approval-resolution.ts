import type { RuntimeOutcome } from "../runtime/types.js";

export interface ApprovalResolutionContract {
  readonly kind: "approval_resolution";
  readonly approvalId: string;
  readonly resumeToken: string;
  readonly status: "executed" | "blocked" | "rejected";
  readonly intentId: string;
  readonly message: string;
  readonly code?: string;
  readonly adapterResult?: unknown;
}

export function toApprovalResolutionContract(
  approvalId: string,
  resumeToken: string,
  outcome: RuntimeOutcome,
): ApprovalResolutionContract {
  if (outcome.type === "executed") {
    return {
      kind: "approval_resolution",
      approvalId,
      resumeToken,
      status: "executed",
      intentId: outcome.intentId,
      message: "Approval accepted and execution resumed successfully.",
      adapterResult: outcome.adapterResult,
    };
  }

  if (outcome.type === "pending_approval") {
    return {
      kind: "approval_resolution",
      approvalId,
      resumeToken,
      status: "blocked",
      intentId: outcome.intentId,
      code: "UNEXPECTED_PENDING_APPROVAL",
      message: "Approval resolution unexpectedly produced another pending approval state.",
    };
  }

  return {
    kind: "approval_resolution",
    approvalId,
    resumeToken,
    status: outcome.type,
    intentId: outcome.intentId,
    code: outcome.code,
    message: outcome.message,
  };
}
