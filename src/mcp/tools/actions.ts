import { randomUUID } from "node:crypto";
import type { RuntimeCore } from "../../runtime/core.js";
import type { ApprovalRouter } from "../../runtime/approval-router.js";
import type { PendingOperationsTracker } from "../../runtime/pending-operations.js";
import type { PolicyContext } from "../../runtime/types.js";
import type { RuntimeIntent } from "../../runtime/types.js";
import { isStateChangingAction } from "../../runtime/intents.js";
import { describeRuntimeAction } from "../../runtime/action-labels.js";
import type { McpToolResult, TelegramApprovalNotifier } from "../server.js";
import { asRecord } from "../tool-args.js";
import { toPendingApprovalContract } from "../../contracts/pending-approval.js";

export interface ActionToolDeps {
  readonly core: RuntimeCore;
  readonly approvalRouter: ApprovalRouter;
  readonly pendingOps: PendingOperationsTracker;
  getPolicyContext(): PolicyContext;
  readonly telegramApproval?: TelegramApprovalNotifier;
  /** Max wait for Telegram outbound notify; avoids hanging tool calls. */
  readonly approvalNotifyTimeoutMs: number;
}

class TelegramNotifyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramNotifyTimeoutError";
  }
}

function rollbackPendingApproval(
  router: ApprovalRouter,
  pendingOps: PendingOperationsTracker,
  approvalId: string,
): void {
  const rec = router.get(approvalId);
  if (!rec) {
    return;
  }
  router.deleteOpen(approvalId);
  pendingOps.release(rec.fingerprint);
}

async function withTimeout<T>(start: () => Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TelegramNotifyTimeoutError(`Telegram approval notify exceeded ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(start), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function summarizeIntent(intent: RuntimeIntent): string {
  const target = intent.target ?? "";
  const payloadPreview = JSON.stringify(intent.payload);
  const clipped = payloadPreview.length > 200 ? `${payloadPreview.slice(0, 200)}…` : payloadPreview;
  return [
    `Requested action: ${describeRuntimeAction(intent.action)}`,
    `Target: ${target || "n/a"}`,
    `Payload preview: ${clipped}`,
    "Why approval is needed: this action requires explicit approval before execution continues.",
  ].join("\n");
}

function formatNotifierError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

function preferredExecutionTarget(
  action: string,
  argsTarget: unknown,
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  if (action === "withdrawToOwner" || action === "sweepToOwner") {
    if (typeof argsTarget === "string" && argsTarget.length > 0) {
      return argsTarget;
    }
    return undefined;
  }
  if (typeof argsTarget === "string" && argsTarget.length > 0) {
    return argsTarget;
  }
  for (const key of ["contractAddress", "targetAddress", "executionTarget"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "pool";
}

function preferredContractAddress(
  argsTarget: unknown,
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  for (const key of ["contractAddress", "targetAddress", "executionTarget", "poolAddress"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  if (typeof argsTarget === "string" && /^0x[a-fA-F0-9]{40}$/.test(argsTarget.trim())) {
    return argsTarget.trim();
  }
  return undefined;
}

function asRuntimeIntent(value: unknown): RuntimeIntent | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<RuntimeIntent>;
  if (typeof candidate.action !== "string") {
    return undefined;
  }
  return candidate as RuntimeIntent;
}

function summarizeWhitelistApproval(intent: RuntimeIntent): string {
  const payload = asRecord(intent.payload);
  const originalIntent = asRuntimeIntent(payload.originalIntent);
  const requestedAction = originalIntent?.action ?? intent.action;
  const blockedTarget =
    (typeof payload.target === "string" && payload.target.trim().length > 0
      ? payload.target.trim()
      : originalIntent?.target?.trim()) || intent.target || "target";
  const lines = [
    `Requested action: ${describeRuntimeAction(requestedAction)}`,
    `Blocked target: ${blockedTarget}`,
    "Why approval is needed: this target is not currently allowlisted.",
  ];
  if (typeof payload.contractAddress === "string" && payload.contractAddress.trim().length > 0) {
    lines.push(`Contract address: ${payload.contractAddress.trim()}`);
  }
  lines.push(
    originalIntent
      ? "If approved: add the target to WhitelistPolicy and then resume the original action."
      : "If approved: add the target to WhitelistPolicy.",
  );
  return lines.join("\n");
}

export async function invokeActionTool(args: Record<string, unknown>, deps: ActionToolDeps): Promise<McpToolResult> {
  const ctx = deps.getPolicyContext();
  if (ctx.lifecycle !== "READY") {
    return {
      ok: false,
      code: "NOT_READY",
      message: "Execution actions are disabled until setup completes (lifecycle READY).",
    };
  }

  const action = typeof args.action === "string" ? args.action : "";
  if (action.length === 0) {
    return { ok: false, code: "INVALID_ACTION", message: "Missing string field `action`." };
  }

  if (!isStateChangingAction(action)) {
    return {
      ok: false,
      code: "NOT_STATE_CHANGING",
      message: "Use phalanx_portfolio or other read tools for non-mutating queries.",
    };
  }

  const payload = asRecord(args.payload);
  const intent: RuntimeIntent = {
    id: randomUUID(),
    lane: "execution",
    action,
    payload,
    entrySource: "mcp",
    target: preferredExecutionTarget(action, args.target, payload),
  };

  const out = await deps.core.handleIntent(intent);

  if (out.type === "executed") {
    return {
      ok: true,
      data: {
        kind: "executed" as const,
        adapterResult: out.adapterResult,
      },
    };
  }

  if (out.type === "blocked" && out.code === "TARGET_NOT_WHITELISTED") {
    const governanceIntent: RuntimeIntent = {
      id: randomUUID(),
      lane: "execution",
      action: "requestWhitelistExpansion",
      payload: {
        target: intent.target,
          ...(preferredContractAddress(args.target, payload)
            ? { contractAddress: preferredContractAddress(args.target, payload) }
            : {}),
        originalIntent: intent,
      },
      entrySource: intent.entrySource,
      target: "whitelist-admin",
    };
    const governanceOut = await deps.core.handleIntent(governanceIntent);
    if (governanceOut.type === "executed") {
      return {
        ok: true,
        data: {
          kind: "executed" as const,
          adapterResult: governanceOut.adapterResult,
        },
      };
    }
    if (governanceOut.type === "blocked" || governanceOut.type === "rejected") {
      return { ok: false, code: governanceOut.code, message: governanceOut.message };
    }
    if (governanceOut.type === "pending_approval") {
      const approvalId = governanceOut.approvalId;
      const pendingApproval = deps.approvalRouter.get(approvalId);
      if (!pendingApproval) {
        rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
        return {
          ok: false,
          code: "APPROVAL_STATE_MISSING",
          message: "Pending approval record disappeared before notification could be delivered.",
        };
      }
      if (deps.telegramApproval === undefined) {
        rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
        return {
          ok: false,
          code: "TELEGRAM_UNAVAILABLE",
          message: "Telegram approval notifier is not configured; cannot enqueue cross-channel approval.",
        };
      }
      try {
        const bounded = await withTimeout(
          () =>
            deps.telegramApproval!.sendApprovalRequest({
              approvalId,
              summary: summarizeWhitelistApproval(governanceIntent),
            }),
          deps.approvalNotifyTimeoutMs,
        );
        if (!bounded.ok) {
          rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
          return {
            ok: false,
            code: "TELEGRAM_APPROVAL_NOTIFY_FAILED",
            message: bounded.message ?? bounded.code,
          };
        }
      } catch (error) {
        rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
        if (error instanceof TelegramNotifyTimeoutError) {
          return {
            ok: false,
            code: "TELEGRAM_APPROVAL_NOTIFY_TIMEOUT",
            message: error.message,
          };
        }
        return {
          ok: false,
          code: "TELEGRAM_APPROVAL_NOTIFY_FAILED",
          message: formatNotifierError(error),
        };
      }
      return {
        ok: true,
        data: toPendingApprovalContract(
          pendingApproval,
          "Approval requested via Telegram; whitelist update must complete before execution resumes.",
        ),
      };
    }
  }

  if (out.type === "blocked" || out.type === "rejected") {
    return { ok: false, code: out.code, message: out.message };
  }

  if (out.type !== "pending_approval") {
    return { ok: false, code: "UNEXPECTED_OUTCOME", message: "Unexpected runtime outcome" };
  }

  const approvalId = out.approvalId;
  const pendingApproval = deps.approvalRouter.get(approvalId);
  if (!pendingApproval) {
    rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
    return {
      ok: false,
      code: "APPROVAL_STATE_MISSING",
      message: "Pending approval record disappeared before notification could be delivered.",
    };
  }

  if (deps.telegramApproval === undefined) {
    rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
    return {
      ok: false,
      code: "TELEGRAM_UNAVAILABLE",
      message: "Telegram approval notifier is not configured; cannot enqueue cross-channel approval.",
    };
  }

  try {
    const bounded = await withTimeout(
      () =>
        deps.telegramApproval!.sendApprovalRequest({
          approvalId,
          summary: intent.action === "requestWhitelistExpansion" ? summarizeWhitelistApproval(intent) : summarizeIntent(intent),
        }),
      deps.approvalNotifyTimeoutMs,
    );
    if (!bounded.ok) {
      rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
      return {
        ok: false,
        code: "TELEGRAM_APPROVAL_NOTIFY_FAILED",
        message: bounded.message ?? bounded.code,
      };
    }
  } catch (error) {
    rollbackPendingApproval(deps.approvalRouter, deps.pendingOps, approvalId);
    if (error instanceof TelegramNotifyTimeoutError) {
      return {
        ok: false,
        code: "TELEGRAM_APPROVAL_NOTIFY_TIMEOUT",
        message: error.message,
      };
    }
    return {
      ok: false,
      code: "TELEGRAM_APPROVAL_NOTIFY_FAILED",
      message: formatNotifierError(error),
    };
  }

  return {
    ok: true,
    data: toPendingApprovalContract(
      pendingApproval,
      "Approval requested via Telegram; respond on the bot to continue.",
    ),
  };
}
