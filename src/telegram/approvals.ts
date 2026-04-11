import type { ApprovalRouter } from "../runtime/approval-router.js";

export type ApprovalCallbackAction = "approve" | "reject";

export interface ResolveApprovalResult {
  readonly ok: boolean;
  readonly decision?: ApprovalCallbackAction;
  readonly code?: string;
  readonly message?: string;
}

const PREFIX = "phx_approval:";

/**
 * Encode approval id into Telegram `callback_data` (keep under 64 bytes when possible).
 */
export function buildApprovalCallbackData(action: ApprovalCallbackAction, approvalId: string): string {
  return `${PREFIX}${action}:${approvalId}`;
}

export function parseApprovalCallbackData(data: string): { action: ApprovalCallbackAction; approvalId: string } | null {
  if (!data.startsWith(PREFIX)) {
    return null;
  }
  const rest = data.slice(PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon <= 0) {
    return null;
  }
  const action = rest.slice(0, colon) as ApprovalCallbackAction;
  const approvalId = rest.slice(colon + 1);
  if (action !== "approve" && action !== "reject") {
    return null;
  }
  if (approvalId.length === 0) {
    return null;
  }
  return { action, approvalId };
}

/**
 * Handles inline-keyboard approval callbacks: removes pending record and returns decision.
 * Downstream execution is out of scope for this task; callers consume {@link ResolveApprovalResult}.
 */
export function resolveApproval(
  router: ApprovalRouter,
  action: ApprovalCallbackAction,
  approvalId: string,
): ResolveApprovalResult {
  const rec = router.get(approvalId);
  if (!rec) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Approval not found or already resolved",
    };
  }
  router.remove(approvalId);
  return { ok: true, decision: action };
}
