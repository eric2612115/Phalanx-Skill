import type { PendingApprovalRecord } from "../runtime/approval-router.js";

export interface PendingApprovalContract {
  readonly kind: "pending_approval";
  readonly approvalId: string;
  readonly resumeToken: string;
  readonly intentId: string;
  readonly originatingIntentId: string;
  readonly executionSegment: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly message: string;
}

export function toPendingApprovalContract(
  record: PendingApprovalRecord,
  message: string,
): PendingApprovalContract {
  return {
    kind: "pending_approval",
    approvalId: record.id,
    resumeToken: record.id,
    intentId: record.intent.id,
    originatingIntentId: record.originatingIntentId,
    executionSegment: record.executionSegment,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    message,
  };
}
