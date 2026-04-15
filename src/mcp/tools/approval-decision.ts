import type { RuntimeCore } from "../../runtime/core.js";
import { toApprovalResolutionContract } from "../../contracts/approval-resolution.js";
import type { McpToolResult } from "../server.js";

export interface ApprovalDecisionToolDeps {
  readonly core: RuntimeCore;
}

export async function invokeApprovalDecisionTool(
  args: Record<string, unknown>,
  deps: ApprovalDecisionToolDeps,
): Promise<McpToolResult> {
  const approvalId = typeof args.approvalId === "string" ? args.approvalId.trim() : "";
  const resumeToken = typeof args.resumeToken === "string" ? args.resumeToken.trim() : "";
  const approved = args.approved === true;

  if (!approvalId) {
    return { ok: false, code: "INVALID_APPROVAL_ID", message: "Missing string field `approvalId`." };
  }
  if (!resumeToken) {
    return { ok: false, code: "INVALID_RESUME_TOKEN", message: "Missing string field `resumeToken`." };
  }
  if (resumeToken !== approvalId) {
    return {
      ok: false,
      code: "INVALID_RESUME_TOKEN",
      message: "Resume token did not match the pending approval contract.",
    };
  }
  if (args.approved !== true && args.approved !== false) {
    return { ok: false, code: "INVALID_APPROVAL_DECISION", message: "Missing boolean field `approved`." };
  }

  const outcome = await deps.core.submitApprovalDecision(approvalId, approved);
  return {
    ok: true,
    data: toApprovalResolutionContract(approvalId, resumeToken, outcome),
  };
}
