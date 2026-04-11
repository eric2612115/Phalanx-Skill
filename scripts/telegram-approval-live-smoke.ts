import { resolve } from "node:path";

import { Bot } from "grammy";

import { createPhalanxHost } from "../src/app/host.js";
import { loadRuntimeConfigValues } from "../src/config/store.js";
import { createTelegramApprovalNotifier } from "../src/telegram/live.js";

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
  const token = runtimeEnv.TELEGRAM_BOT_TOKEN?.trim();
  const ownerChatId = Number(runtimeEnv.TELEGRAM_ALLOWED_USER_ID?.trim() ?? "");
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in config.env");
  }
  if (!Number.isFinite(ownerChatId)) {
    throw new Error("Missing TELEGRAM_ALLOWED_USER_ID in config.env");
  }

  const host = createPhalanxHost({
    configValues: runtimeEnv,
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

  const actionResult = await host.invokeMcp("phalanx_action", {
    action: "deposit",
    payload: { amount: "1" },
    target: "pool",
  });

  console.log(
    JSON.stringify(
      {
        mode: "telegram_approval_live_smoke",
        startup: host.getStartupSummary(),
        actionResult,
        outbox: host.getTelegramApprovalOutbox(),
        instruction: "Click Approve or Reject on Telegram to continue this smoke run.",
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

await main();
