import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Bot } from "grammy";

import { createPhalanxHost, type TelegramCallbackResult } from "../src/app/host.js";
import { buildRuntimeConfig, loadRuntimeConfigValues } from "../src/config/store.js";
import type { McpToolResult } from "../src/mcp/server.js";
import { extractRuntimeTxRefs } from "../src/runtime/events.js";
import { createTelegramApprovalNotifier } from "../src/telegram/live.js";
import {
  buildTelegramApprovalSmokeConfigValues,
  resolveTelegramApprovalSmokeLifecycle,
} from "./telegram-approval-live-smoke.js";

/** Stable envelope discriminator for recording and contract tests. */
export const DEPOSIT_MAINLINE_SMOKE_MODE = "deposit_mainline_smoke" as const;

/** Increment when the JSON proof shape changes. */
export const DEPOSIT_MAINLINE_SCHEMA_VERSION = 1 as const;

export type DepositMainlineMilestones = {
  readonly approvalRequested: boolean;
  readonly approvalResumed: boolean;
  readonly depositAttempted: boolean;
  readonly depositCompleted: boolean;
  readonly txRefsCaptured: boolean;
};

export type DepositMainlineProof = {
  readonly milestones: DepositMainlineMilestones;
  readonly txRefs: readonly string[];
  readonly humanSummary: string;
};

function milestoneSummary(m: DepositMainlineMilestones): string {
  return [
    `approval_requested=${m.approvalRequested ? 1 : 0}`,
    `approval_resumed=${m.approvalResumed ? 1 : 0}`,
    `deposit_attempted=${m.depositAttempted ? 1 : 0}`,
    `deposit_completed=${m.depositCompleted ? 1 : 0}`,
    `tx_refs_captured=${m.txRefsCaptured ? 1 : 0}`,
  ].join("|");
}

function collectTxRefsFromExecutedAdapter(adapterResult: unknown): readonly string[] {
  return extractRuntimeTxRefs(adapterResult) ?? [];
}

/**
 * Validates merged config for the live deposit rehearsal that reuses the same
 * host path and Telegram approval readiness helpers as
 * `telegram-approval-live-smoke.ts`.
 */
export function assertDepositMainlineEnv(values: Readonly<Record<string, string | undefined>>): void {
  const cfg = buildRuntimeConfig(values);
  if (cfg.mode !== "live") {
    throw new Error("deposit_mainline: PHALANX_RUNTIME_MODE must be `live`.");
  }
  if (!cfg.readiness.operatorReady) {
    throw new Error(
      `deposit_mainline: operator tier incomplete (missing: ${cfg.readiness.operatorMissing.join(", ") || "unknown"}).`,
    );
  }
  if (!cfg.readiness.demoReady) {
    throw new Error(
      `deposit_mainline: demo execution tier incomplete (missing: ${cfg.readiness.demoMissing.join(", ") || "unknown"}).`,
    );
  }
  if (!resolveTelegramApprovalSmokeLifecycle(values)) {
    throw new Error(
      "deposit_mainline: Telegram approval lifecycle is not READY (need live mode, operator readiness, TELEGRAM_ALLOWED_USER_ID).",
    );
  }
}

function isMcpPendingApproval(result: McpToolResult): boolean {
  return Boolean(result.ok && result.data && typeof result.data === "object" && result.data.kind === "pending_approval");
}

function isMcpExecuted(result: McpToolResult): boolean {
  return Boolean(result.ok && result.data && typeof result.data === "object" && result.data.kind === "executed");
}

/**
 * Deterministic milestone flags for recording; driven only by MCP action and Telegram callback outcomes.
 */
export function buildDepositMainlineProof(input: {
  readonly plannerOk: boolean;
  readonly actionResult?: McpToolResult;
  readonly callbackResult?: TelegramCallbackResult;
}): DepositMainlineProof {
  const depositAttempted = input.plannerOk && input.actionResult !== undefined;

  let approvalRequested = false;
  let approvalResumed = false;
  let depositCompleted = false;
  const txAccum: string[] = [];

  if (input.actionResult) {
    const ar = input.actionResult;
    if (isMcpPendingApproval(ar)) {
      approvalRequested = true;
    }
    if (isMcpExecuted(ar) && ar.ok && "adapterResult" in ar.data) {
      depositCompleted = true;
      txAccum.push(...collectTxRefsFromExecutedAdapter(ar.data.adapterResult));
    }
  }

  const cb = input.callbackResult;
  if (cb?.handled && cb.decision === "approve") {
    approvalResumed = true;
    const ro = cb.runtimeOutcome;
    if (ro?.type === "executed") {
      depositCompleted = true;
      txAccum.push(...collectTxRefsFromExecutedAdapter(ro.adapterResult));
    }
  }

  const txRefs = [...new Set(txAccum.filter((t) => t.length > 0))];
  const milestones: DepositMainlineMilestones = {
    approvalRequested,
    approvalResumed,
    depositAttempted,
    depositCompleted,
    txRefsCaptured: txRefs.length > 0,
  };

  return {
    milestones,
    txRefs,
    humanSummary: milestoneSummary(milestones),
  };
}

function callbackUiSummary(result: TelegramCallbackResult): string {
  if (!result.handled) {
    return "Approval callback ignored.";
  }
  if (result.decision === "reject") {
    return "Rejected. Pending action was cancelled.";
  }
  if (result.runtimeOutcome?.type === "executed") {
    return "Approved. Action resumed through RuntimeCore and executed.";
  }
  return "Approval handled.";
}

async function main(): Promise<void> {
  const configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env");
  const runtimeEnv = loadRuntimeConfigValues(configPath, process.env);
  const smokeEnv = buildTelegramApprovalSmokeConfigValues(runtimeEnv);
  assertDepositMainlineEnv(smokeEnv);

  const token = smokeEnv.TELEGRAM_BOT_TOKEN?.trim();
  const ownerChatId = Number(smokeEnv.TELEGRAM_ALLOWED_USER_ID?.trim() ?? "");
  if (!token) {
    throw new Error("deposit_mainline: Missing TELEGRAM_BOT_TOKEN.");
  }
  if (!Number.isFinite(ownerChatId)) {
    throw new Error("deposit_mainline: Missing TELEGRAM_ALLOWED_USER_ID.");
  }

  const lifecycle = resolveTelegramApprovalSmokeLifecycle(smokeEnv);
  const host = createPhalanxHost({
    lifecycle,
    configValues: smokeEnv,
    approvalNotifyTimeoutMs: Number(process.env.PHALANX_APPROVAL_NOTIFY_TIMEOUT_MS ?? "8000"),
  });
  const bot = new Bot(token);
  let botStarted = false;

  let resolveCallback: ((value: TelegramCallbackResult) => void) | undefined;
  let rejectCallback: ((reason?: unknown) => void) | undefined;
  const callbackPromise = new Promise<TelegramCallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  bot.on("callback_query:data", async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const result = await host.handleTelegramCallback(callbackData);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(callbackUiSummary(result));
    resolveCallback?.(result);
  });

  bot.catch((error) => {
    console.error("deposit_mainline: Telegram bot error:", error);
    rejectCallback?.(error);
  });

  const notifier = createTelegramApprovalNotifier({
    getOwnerChatId: () => ownerChatId,
    sendMessage: async (chatId, text, extra) => {
      await bot.api.sendMessage(chatId, text, extra as never);
    },
  });
  host.bindTelegramApprovalNotifier(notifier);

  try {
    void bot.start();
    botStarted = true;
    await new Promise((r) => setTimeout(r, 1500));

    const plannerResult = await host.invokeMcp("phalanx_uniswap_liquidity_plan", {
      chain: "base",
      tokenA: "USDC",
      tokenB: "ETH",
      positionType: "v3",
    });
    if (!plannerResult.ok) {
      const envelope = {
        mode: DEPOSIT_MAINLINE_SMOKE_MODE,
        schemaVersion: DEPOSIT_MAINLINE_SCHEMA_VERSION,
        configPath,
        startup: host.getStartupSummary(),
        plannerResult,
        proof: buildDepositMainlineProof({ plannerOk: false }),
        instruction: "Planner failed before deposit; fix config, RPC, or planner prerequisites.",
      };
      console.log(JSON.stringify(envelope, null, 2));
      process.exitCode = 1;
      return;
    }

    const downstream =
      (
        plannerResult.data.adapterResult as {
          runtimeDownstream?: {
            executionTarget?: string;
            executionAction?: string;
            payloadTemplate?: Record<string, unknown>;
          };
        }
      ).runtimeDownstream ?? {};
    const action = downstream.executionAction ?? "depositLpPosition";
    const target = downstream.executionTarget ?? "uniswap-v3";
    const payload = {
      ...(downstream.payloadTemplate ?? {}),
      investmentId:
        process.env.PHALANX_LP_INVESTMENT_ID ??
        process.env.PHALANX_SMOKE_LP_INVESTMENT_ID ??
        ((downstream.payloadTemplate?.investmentId as string | undefined) || "uniswap-base-weth-usdc-v3"),
      amount:
        process.env.PHALANX_LP_AMOUNT ??
        process.env.PHALANX_SMOKE_LP_AMOUNT ??
        ((downstream.payloadTemplate?.amount as string | undefined) || "1000000"),
      amountSecondary:
        process.env.PHALANX_LP_AMOUNT_SECONDARY ??
        process.env.PHALANX_SMOKE_LP_AMOUNT_SECONDARY ??
        ((downstream.payloadTemplate?.amountSecondary as string | undefined) || "500000000000000"),
      tokenSecondary:
        process.env.PHALANX_LP_TOKEN_SECONDARY ??
        process.env.PHALANX_SMOKE_LP_TOKEN_SECONDARY ??
        ((downstream.payloadTemplate?.tokenSecondary as string | undefined) || "ETH"),
      range:
        process.env.PHALANX_LP_RANGE ??
        process.env.PHALANX_SMOKE_LP_RANGE ??
        ((downstream.payloadTemplate?.range as string | undefined) || "5"),
    };

    const actionResult = await host.invokeMcp("phalanx_action", {
      action,
      payload,
      target,
    });

    let callbackResult: TelegramCallbackResult | undefined;
    let waitError: string | undefined;
    const timeoutMs = Number(process.env.PHALANX_TELEGRAM_APPROVAL_SMOKE_TIMEOUT_MS ?? "180000");
    const timeout = setTimeout(() => {
      rejectCallback?.(new Error(`Timed out waiting for Telegram approval callback after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      if (isMcpPendingApproval(actionResult)) {
        try {
          callbackResult = await callbackPromise;
        } catch (error) {
          waitError = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const proof = buildDepositMainlineProof({
      plannerOk: true,
      actionResult,
      callbackResult,
    });

    const envelope = {
      mode: DEPOSIT_MAINLINE_SMOKE_MODE,
      schemaVersion: DEPOSIT_MAINLINE_SCHEMA_VERSION,
      configPath,
      startup: host.getStartupSummary(),
      plannerOk: true,
      depositAction: { action, target },
      plannerResult,
      actionResult,
      callbackResult: callbackResult ?? null,
      waitError: waitError ?? null,
      proof,
      instruction:
        "Recording: capture this JSON. Approve on Telegram when prompted so milestones show approval_resumed and deposit_completed.",
    };

    console.log(JSON.stringify(envelope, null, 2));

    const incompleteDeposit =
      proof.milestones.depositAttempted && (!proof.milestones.depositCompleted || waitError !== undefined);
    if (!actionResult.ok || waitError !== undefined || incompleteDeposit) {
      process.exitCode = 1;
    }
  } finally {
    if (botStarted) {
      bot.stop();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
