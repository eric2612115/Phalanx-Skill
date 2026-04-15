import type { ApprovalInspectResult, ApprovalRouter, PendingApprovalRecord } from "./approval-router.js";
import type { RuntimeIntent } from "./types.js";
import type { PendingOperationsTracker } from "./pending-operations.js";

export type { ApprovalInspectResult } from "./approval-router.js";

/**
 * Classify the execution segment for approval association (audit + resume correlation).
 */
export function inferExecutionSegment(intent: RuntimeIntent): string {
  if (intent.action === "requestWhitelistExpansion") {
    return "whitelist_governance";
  }
  if (intent.action === "withdrawToOwner" || intent.action === "sweepToOwner") {
    return "owner_transfer";
  }
  if (intent.action === "pauseRuntime" || intent.action === "resumeRuntime") {
    return "runtime_lifecycle";
  }
  return "protocol_execution";
}

export function inspectApprovalForResume(
  router: ApprovalRouter,
  approvalId: string,
  nowMs: number,
): ApprovalInspectResult {
  return router.inspectApproval(approvalId, nowMs);
}

export function expireOpenApprovalAndRelease(
  router: ApprovalRouter,
  approvalId: string,
  pendingOps: PendingOperationsTracker,
): PendingApprovalRecord | undefined {
  return router.expireIfNeeded(approvalId, pendingOps);
}
