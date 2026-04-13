import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Bot } from "grammy";

import { createPhalanxHost } from "../src/app/host.js";
import { buildRuntimeConfig, loadRuntimeConfigValues } from "../src/config/store.js";
import { mergePolicyItemTargets } from "../src/policy/policy-items.js";
import { createTelegramApprovalNotifier } from "../src/telegram/live.js";
import type { RuntimeLifecycleState } from "../src/runtime/types.js";

function callbackSummary(result: Awaited<ReturnType<ReturnType<typeof createPhalanxHost>["handleTelegramCallback"]>>): string {
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
  const token = runtimeEnv.TELEGRAM_BOT_TOKEN?.trim();
  const ownerChatId = Number(runtimeEnv.TELEGRAM_ALLOWED_USER_ID?.trim() ?? "");
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in config.env");
  }
  if (!Number.isFinite(ownerChatId)) {
    throw new Error("Missing TELEGRAM_ALLOWED_USER_ID in config.env");
  }

  const lifecycle = resolveTelegramApprovalSmokeLifecycle(smokeEnv);
  const host = createPhalanxHost({
    lifecycle,
    configValues: smokeEnv,
    approvalNotifyTimeoutMs: Number(process.env.PHALANX_APPROVAL_NOTIFY_TIMEOUT_MS ?? "8000"),
  });
  const bot = new Bot(token);

  let resolveCallback: ((value: unknown) => void) | undefined;
  let rejectCallback: ((reason?: unknown) => void) | undefined;
  const callbackPromise = new Promise<unknown>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  bot.on("message:text", async (ctx) => {
    const result = await host.handleTelegramMessage({
      from: ctx.from ? { id: ctx.from.id } : undefined,
      chat: { type: ctx.chat?.type ?? "private" },
      text: ctx.message?.text,
    });

    console.error(
      JSON.stringify(
        {
          event: "telegram_message",
          from: ctx.from?.id ?? null,
          text: ctx.message?.text ?? "",
          nextState: result.nextState,
          replies: result.messages,
        },
        null,
        2,
      ),
    );

    for (const message of result.messages) {
      await ctx.reply(message);
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const result = await host.handleTelegramCallback(callbackData);
    console.error(
      JSON.stringify(
        {
          event: "telegram_callback",
          callbackData,
          result,
        },
        null,
        2,
      ),
    );
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(callbackSummary(result));
    resolveCallback?.(result);
  });

  bot.catch((error) => {
    console.error("Telegram bot smoke error:", error);
    rejectCallback?.(error);
  });

  const notifier = createTelegramApprovalNotifier({
    getOwnerChatId: () => ownerChatId,
    sendMessage: async (chatId, text, extra) => {
      await bot.api.sendMessage(chatId, text, extra as never);
    },
  });
  host.bindTelegramApprovalNotifier(notifier);

  void bot.start();
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const plannerResult = await host.invokeMcp("phalanx_uniswap_liquidity_plan", {
    chain: "base",
    tokenA: "USDC",
    tokenB: "ETH",
    positionType: "v3",
  });
  if (!plannerResult.ok) {
    throw new Error(`Planner failed before Telegram smoke: ${plannerResult.code} ${plannerResult.message}`);
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

  console.log(
    JSON.stringify(
      {
        mode: "telegram_approval_live_smoke",
        startup: host.getStartupSummary(),
        plannerResult,
        actionResult,
        outbox: host.getTelegramApprovalOutbox(),
        instruction: "Click Approve or Reject on Telegram to continue the blocked Uniswap LP smoke run.",
      },
      null,
      2,
    ),
  );

  const timeoutMs = Number(process.env.PHALANX_TELEGRAM_APPROVAL_SMOKE_TIMEOUT_MS ?? "180000");
  const timeout = setTimeout(() => {
    rejectCallback?.(new Error(`Timed out waiting for Telegram approval callback after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const callbackResult = await callbackPromise;
    console.log(JSON.stringify({ mode: "telegram_approval_live_smoke", callbackResult }, null, 2));
  } finally {
    clearTimeout(timeout);
    bot.stop();
  }
}

export function resolveTelegramApprovalSmokeLifecycle(
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): RuntimeLifecycleState | undefined {
  const cfg = buildRuntimeConfig(runtimeEnv);
  return cfg.mode === "live" && cfg.readiness.operatorReady && cfg.telegram.allowedUserId ? "READY" : undefined;
}

function stripBlockedApprovalTarget(raw: string | undefined): string {
  const filtered =
    raw
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== "uniswap-v3")
      .join(",") ?? "";
  return mergePolicyItemTargets(filtered, ["whitelist-admin"]);
}

export function buildTelegramApprovalSmokeConfigValues(
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return {
    ...runtimeEnv,
    WHITELIST_TARGETS: stripBlockedApprovalTarget(runtimeEnv.WHITELIST_TARGETS ?? runtimeEnv.PHALANX_WHITELIST_TARGETS),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
