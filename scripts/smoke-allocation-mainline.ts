import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Bot } from "grammy";

import { createPhalanxHost, type TelegramCallbackResult } from "../src/app/host.js";
import {
  buildRuntimeConfig,
  loadRuntimeConfigValues,
  normalizeFlowProfileId,
  type FlowProfileId,
} from "../src/config/store.js";
import type { AllocationStageOutcome } from "../src/demo/allocation-mainline.js";
import type { RuntimeEvent } from "../src/runtime/events.js";
import type { ExecutionMilestones, PaymentEvidence, WalletEvidence } from "../src/runtime/execution-evidence.js";
import { createTelegramApprovalNotifier } from "../src/telegram/live.js";
import { assertDepositMainlineEnv } from "./smoke-deposit-mainline.js";
import {
  buildTelegramApprovalSmokeConfigValues,
  resolveTelegramApprovalSmokeLifecycle,
} from "./telegram-approval-live-smoke.js";

/** Stable envelope discriminator for recording and contract tests. */
export const ALLOCATION_MAINLINE_SMOKE_MODE = "allocation_mainline_smoke" as const;

/** Increment when the JSON proof shape changes. */
export const ALLOCATION_MAINLINE_SCHEMA_VERSION = 1 as const;

const STRICT_FLOW_PROFILE_ALIASES: Readonly<Record<string, FlowProfileId>> = {
  allocation_mainline: "allocation_mainline",
  "allocation-mainline": "allocation_mainline",
  deposit_only: "deposit_only",
  "deposit-only": "deposit_only",
  roundtrip: "roundtrip",
  rehearsal: "rehearsal",
};

export type GroupedTxRefs = {
  readonly allocation_pool: readonly string[];
  readonly uniswap_lp: readonly string[];
  readonly other: readonly string[];
};

export function collectGroupedTxRefsFromRuntimeEvents(events: readonly RuntimeEvent[]): GroupedTxRefs {
  const allocation_pool: string[] = [];
  const uniswap_lp: string[] = [];
  const other: string[] = [];
  for (const e of events) {
    if (!e.txRefs?.length) {
      continue;
    }
    if (e.target === "pool") {
      allocation_pool.push(...e.txRefs);
    } else if (e.target === "uniswap-v3" || e.action === "depositLpPosition" || e.action === "withdrawLpPosition") {
      uniswap_lp.push(...e.txRefs);
    } else {
      other.push(...e.txRefs);
    }
  }
  const dedupe = (xs: readonly string[]) => [...new Set(xs.filter((x) => x.length > 0))];
  return {
    allocation_pool: dedupe(allocation_pool),
    uniswap_lp: dedupe(uniswap_lp),
    other: dedupe(other),
  };
}

export type AllocationMainlineProof = {
  readonly profile: FlowProfileId;
  readonly walletEvidence: WalletEvidence;
  readonly paymentEvidence: PaymentEvidence;
  readonly executionMilestones: ExecutionMilestones;
  readonly stageTimeline: readonly { readonly stage: string; readonly status: string; readonly summary: string }[];
  readonly groupedTxRefs: GroupedTxRefs;
  readonly humanSummary: string;
};

function defaultPaymentEvidence(): PaymentEvidence {
  return {
    mode: "plain",
    paymentRequired: false,
    baselineReady: false,
    paymentAttempted: false,
    paymentWrapped: false,
    paymentSettled: false,
    summary: "payment_evidence_unavailable",
  };
}

export function buildAllocationMainlineProof(input: {
  readonly profile: FlowProfileId;
  readonly walletEvidence: WalletEvidence;
  readonly payment?: PaymentEvidence;
  readonly milestones?: ExecutionMilestones;
  readonly stages: readonly AllocationStageOutcome[];
  readonly outcomeType: string;
  readonly runtimeEvents: readonly RuntimeEvent[];
}): AllocationMainlineProof {
  const groupedTxRefs = collectGroupedTxRefsFromRuntimeEvents(input.runtimeEvents);
  const stageTimeline = input.stages.map((s) => ({ stage: s.stage, status: s.status, summary: s.summary }));
  const paymentEvidence = input.payment ?? defaultPaymentEvidence();
  const executionMilestones = input.milestones ?? {};
  const milestoneEntries = Object.entries(executionMilestones).filter(([, v]) => Boolean(v));
  const milestoneTokens = milestoneEntries.map(([k]) => k).sort();
  const humanSummary = [
    `profile=${input.profile}`,
    `outcome=${input.outcomeType}`,
    `stages=${input.stages.map((s) => `${s.stage}:${s.status}`).join("|")}`,
    milestoneTokens.length === 0 ? "milestones=" : `milestones=${milestoneTokens.join(",")}`,
    `tx_pool=${groupedTxRefs.allocation_pool.length}`,
    `tx_lp=${groupedTxRefs.uniswap_lp.length}`,
  ].join(";");

  return {
    profile: input.profile,
    walletEvidence: input.walletEvidence,
    paymentEvidence,
    executionMilestones,
    stageTimeline,
    groupedTxRefs,
    humanSummary,
  };
}

/**
 * Validates merged config for the proactive allocation mainline smoke.
 * Reuses deposit-mainline live readiness and Telegram lifecycle, then enforces
 * flow profile + agentic demo gate (typically set from `service.env`).
 */
export function assertAllocationMainlineSmokeEnv(
  values: Readonly<Record<string, string | undefined>>,
): FlowProfileId {
  assertDepositMainlineEnv(values);
  const rawProfile = values.PHALANX_FLOW_PROFILE?.trim();
  if (rawProfile && !(rawProfile.toLowerCase() in STRICT_FLOW_PROFILE_ALIASES)) {
    throw new Error(
      `allocation_mainline_smoke: unknown PHALANX_FLOW_PROFILE \`${rawProfile}\`. Expected one of allocation_mainline, allocation-mainline, rehearsal, deposit_only, deposit-only, roundtrip.`,
    );
  }
  const profile = normalizeFlowProfileId(rawProfile);
  if (profile !== "allocation_mainline" && profile !== "rehearsal") {
    throw new Error(
      `allocation_mainline_smoke: PHALANX_FLOW_PROFILE must be allocation_mainline or rehearsal (got ${profile}). Use smoke:deposit-mainline for deposit-only rehearsal.`,
    );
  }
  if ((values.PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED ?? "").trim() !== "1") {
    throw new Error(
      "allocation_mainline_smoke: PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED must be `1` so the host runs the proactive allocation story.",
    );
  }
  return profile;
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
  const profile = assertAllocationMainlineSmokeEnv(smokeEnv);

  const token = smokeEnv.TELEGRAM_BOT_TOKEN?.trim();
  const ownerChatId = Number(smokeEnv.TELEGRAM_ALLOWED_USER_ID?.trim() ?? "");
  if (!token) {
    throw new Error("allocation_mainline_smoke: Missing TELEGRAM_BOT_TOKEN.");
  }
  if (!Number.isFinite(ownerChatId)) {
    throw new Error("allocation_mainline_smoke: Missing TELEGRAM_ALLOWED_USER_ID.");
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
    console.error("allocation_mainline_smoke: Telegram bot error:", error);
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

    const mainlineResult = await host.runAgenticAllocationMainlineDemo("smoke:allocation-mainline");

    let callbackResult: TelegramCallbackResult | undefined;
    let waitError: string | undefined;
    const timeoutMs = Number(process.env.PHALANX_TELEGRAM_APPROVAL_SMOKE_TIMEOUT_MS ?? "180000");
    const timeout = setTimeout(() => {
      rejectCallback?.(new Error(`Timed out waiting for Telegram approval callback after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      if (mainlineResult.outcome.type === "pending_approval") {
        try {
          callbackResult = await callbackPromise;
        } catch (error) {
          waitError = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const demoRun = host.getLatestRebalanceDemoRunSummary() ?? mainlineResult.demoRun;
    const wallet = host.getOperatorWalletSummary().walletEvidence;
    const events = host.getRuntimeEvents(250);
    const terminalOutcome =
      callbackResult?.runtimeOutcome !== undefined ? callbackResult.runtimeOutcome.type : mainlineResult.outcome.type;

    const proof = buildAllocationMainlineProof({
      profile,
      walletEvidence: wallet,
      payment: demoRun?.omRateExecutionEvidence.payment,
      milestones: demoRun?.omRateExecutionEvidence.milestones,
      stages: mainlineResult.stages,
      outcomeType: terminalOutcome,
      runtimeEvents: events,
    });

    const envelope = {
      mode: ALLOCATION_MAINLINE_SMOKE_MODE,
      schemaVersion: ALLOCATION_MAINLINE_SCHEMA_VERSION,
      profile,
      flowProfileResolved: buildRuntimeConfig(smokeEnv).flow.profile,
      configPath,
      startup: host.getStartupSummary(),
      mainlineResult,
      callbackResult: callbackResult ?? null,
      waitError: waitError ?? null,
      proof,
      instruction:
        "Recording: capture this JSON. When LP approval is required, approve on Telegram so proof shows outcome=executed and grouped tx refs populate.",
    };

    console.log(JSON.stringify(envelope, null, 2));

    const success =
      mainlineResult.outcome.type === "executed" ||
      (mainlineResult.outcome.type === "pending_approval" &&
        callbackResult?.handled === true &&
        callbackResult.decision === "approve" &&
        callbackResult.runtimeOutcome?.type === "executed");

    if (!success || waitError !== undefined) {
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
