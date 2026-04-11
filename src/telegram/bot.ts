import type { ApprovalRouter } from "../runtime/approval-router.js";
import {
  buildApprovalCallbackData,
  parseApprovalCallbackData,
  resolveApproval,
  type ApprovalCallbackAction,
} from "./approvals.js";
import { handleTelegramUpdate, type TelegramUpdate } from "./setup.js";

export interface TelegramBotDeps {
  readonly approvalRouter: ApprovalRouter;
}

/**
 * Maps inbound message updates to setup / lifecycle handling (no Telegram HTTP client).
 */
export async function routeTelegramMessage(update: TelegramUpdate) {
  return handleTelegramUpdate(update);
}

export interface CallbackRouteResult {
  readonly handled: boolean;
  readonly approval?: ReturnType<typeof resolveApproval>;
}

/**
 * Inline-keyboard callback: `phx_approval:approve:<uuid>` / `phx_approval:reject:<uuid>`.
 */
export function routeTelegramCallback(callbackData: string, deps: TelegramBotDeps): CallbackRouteResult {
  const parsed = parseApprovalCallbackData(callbackData);
  if (!parsed) {
    return { handled: false };
  }
  const approval = resolveApproval(deps.approvalRouter, parsed.action, parsed.approvalId);
  return { handled: true, approval };
}

export function formatApprovalCallback(action: ApprovalCallbackAction, approvalId: string): string {
  return buildApprovalCallbackData(action, approvalId);
}
