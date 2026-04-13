import { Bot, InlineKeyboard } from "grammy";

import type { PhalanxHost } from "../app/host.js";
import type { TelegramReportNotifier } from "../app/host.js";
import type { RuntimeEvent } from "../runtime/events.js";
import { describeRuntimeAction } from "../runtime/action-labels.js";
import type { TelegramApprovalNotifier, TelegramApprovalNotifierResult } from "../mcp/server.js";
import { buildOperatorFallbackReply } from "./fallback.js";
import { formatOperatorQueryPayload } from "./operator-formatters.js";
import { runOperatorQuery } from "./operator-queries.js";
import { classifyOperatorTelegramText } from "./operator-router.js";

type SendMessageExtra = {
  reply_markup?: unknown;
};

export interface TelegramMessageSender {
  sendMessage(chatId: number, text: string, extra?: SendMessageExtra): Promise<unknown>;
}

export interface TelegramApprovalNotifierDeps {
  getOwnerChatId(): number | null;
  sendMessage(chatId: number, text: string, extra?: SendMessageExtra): Promise<unknown>;
}

export interface TelegramReportNotifierDeps extends TelegramApprovalNotifierDeps {}

export type GrammyLikeBot = {
  on(event: "message:text" | "callback_query:data", handler: (ctx: any) => Promise<void>): GrammyLikeBot;
  catch(handler: (error: unknown) => void): GrammyLikeBot;
};

export function buildApprovalKeyboard(approvalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve", `phx_approval:approve:${approvalId}`)
    .text("Reject", `phx_approval:reject:${approvalId}`);
}

export function createTelegramApprovalNotifier(
  deps: TelegramApprovalNotifierDeps,
): TelegramApprovalNotifier {
  return {
    async sendApprovalRequest({ approvalId, summary }): Promise<TelegramApprovalNotifierResult> {
      const chatId = deps.getOwnerChatId();
      if (chatId === null) {
        return {
          ok: false,
          code: "OWNER_CHAT_UNAVAILABLE",
          message: "No owner Telegram chat is bound yet; cannot deliver approval request.",
        };
      }

      await deps.sendMessage(chatId, `Approval required\n\n${summary}`, {
        reply_markup: buildApprovalKeyboard(approvalId),
      });
      return { ok: true };
    },
  };
}

function appendDemoRunLines(lines: string[], event: RuntimeEvent): void {
  const d = event.demoRun;
  if (!d) {
    return;
  }
  lines.push("", "Demo context:");
  lines.push(`• OmRate path: ${d.omRatePath} (${d.chain} ${d.tokenA}/${d.tokenB})`);
  if (d.selectedPool?.pairLabel || d.selectedPool?.pairAddress) {
    lines.push(
      `• Pool: ${d.selectedPool.pairLabel ?? "n/a"}${d.selectedPool.pairAddress ? ` @ ${d.selectedPool.pairAddress}` : ""}`,
    );
  }
  lines.push(`• Swap prep: ${d.swapPreparation.status} — ${d.swapPreparation.summary}`);
  lines.push(
    `• LP lane: ${d.lpExecution.action ?? "n/a"} @ ${d.lpExecution.target ?? "n/a"} (ready: ${d.lpExecution.ready ? "yes" : "no"})`,
  );
  if (d.pendingApproval?.approvalId) {
    lines.push(`• Pending approval: ${d.pendingApproval.approvalId}`);
  }
}

function renderRuntimeExecutionReport(event: RuntimeEvent): string {
  if (event.stage === "guardian_detected" && event.entrySource === "guardian") {
    const lines = [
      "Rebalance proposal",
      "",
      `Action: ${event.action}`,
      `Intent: ${event.intentId}`,
      `Correlation: ${event.correlationId}`,
      `Summary: ${event.summary}`,
    ];
    if (event.reason) {
      lines.push(`Reason: ${event.reason}`);
    }
    if (event.riskNotes && event.riskNotes.length > 0) {
      lines.push(`Context: ${event.riskNotes.join(" | ")}`);
    }
    appendDemoRunLines(lines, event);
    return lines.join("\n");
  }
  const lines = [
    event.stage === "executed" ? "Execution report" : "Execution alert",
    "",
    `${event.stage === "executed" ? "Status" : "Outcome"}: ${event.stage}`,
    `Action: ${event.action}`,
    `Intent: ${event.intentId}`,
    `Correlation: ${event.correlationId}`,
  ];
  lines.push(`Summary: ${event.summary}`);
  if (event.reason) {
    lines.push(`Reason: ${event.reason}`);
  }
  if (event.riskNotes && event.riskNotes.length > 0) {
    lines.push(`Risk: ${event.riskNotes.join(" | ")}`);
  }
  if (event.txRefs && event.txRefs.length > 0) {
    lines.push(`Tx: ${event.txRefs.join(", ")}`);
  }
  appendDemoRunLines(lines, event);
  return lines.join("\n");
}

export function createTelegramReportNotifier(
  deps: TelegramReportNotifierDeps,
): TelegramReportNotifier {
  return {
    async sendExecutionReport(event) {
      const chatId = deps.getOwnerChatId();
      if (chatId === null) {
        return;
      }
      await deps.sendMessage(chatId, renderRuntimeExecutionReport(event));
    },
  };
}

function callbackSummary(result: Awaited<ReturnType<PhalanxHost["handleTelegramCallback"]>>): string {
  if (!result.handled) {
    return "Approval callback ignored.";
  }
  const outcome = result.runtimeOutcome?.type;
  if (result.decision === "reject") {
    return "Rejected. Pending action was cancelled.";
  }
  if (outcome === "executed") {
    const adapterResult =
      result.runtimeOutcome && "adapterResult" in result.runtimeOutcome
        ? (result.runtimeOutcome.adapterResult as Record<string, unknown>)
        : undefined;
    if (adapterResult?.mode === "whitelist_governance_completed" && typeof adapterResult.resumedAction === "string") {
      return `Approved. Whitelist updated and ${describeRuntimeAction(adapterResult.resumedAction)} resumed.`;
    }
    return "Approved. Action resumed through RuntimeCore and executed.";
  }
  if (outcome) {
    return `Approved, but runtime resumed with outcome: ${outcome}.`;
  }
  return "Approval handled.";
}

export function registerTelegramBotHandlers(bot: GrammyLikeBot, host: PhalanxHost): void {
  bot.on("message:text", async (ctx) => {
    const result = await host.handleTelegramMessage({
      from: ctx.from ? { id: ctx.from.id } : undefined,
      chat: { type: ctx.chat?.type ?? "private" },
      text: ctx.message?.text,
    });

    for (const message of result.messages) {
      await ctx.reply(message);
    }

    if (result.messages.length > 0) {
      return;
    }

    const session = host.getSetupSession();
    if (session.lifecycle !== "READY" || ctx.chat?.type !== "private") {
      return;
    }

    const rawText = ctx.message?.text ?? "";
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      return;
    }

    const operatorId = session.ownerUserId;
    const fromId = ctx.from?.id;
    if (!operatorId || fromId === undefined || String(fromId) !== operatorId) {
      return;
    }

    const route = classifyOperatorTelegramText(trimmed);
    if (route.kind === "fallback") {
      await ctx.reply(buildOperatorFallbackReply());
      return;
    }

    const payload = await runOperatorQuery(host, route.family);
    for (const chunk of formatOperatorQueryPayload(payload)) {
      await ctx.reply(chunk);
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const callbackData = ctx.callbackQuery?.data;
    const result = callbackData
      ? await host.handleTelegramCallback(callbackData)
      : { handled: false as const };
    await ctx.answerCallbackQuery();
    if (ctx.editMessageText) {
      await ctx.editMessageText(callbackSummary(result));
    }
  });

  bot.catch((error) => {
    console.error("Telegram bot error:", error);
  });
}

export interface StartTelegramBotOptions {
  readonly token: string;
  readonly host: PhalanxHost;
  readonly createBot?: (token: string) => Bot;
}

export function startTelegramBotPolling(options: StartTelegramBotOptions): {
  readonly bot: Bot;
  start(): Promise<void>;
  stop(): void;
  readonly approvalNotifier: TelegramApprovalNotifier;
  readonly reportNotifier: TelegramReportNotifier;
} {
  const bot = (options.createBot ?? ((token: string) => new Bot(token)))(options.token);
  registerTelegramBotHandlers(bot as unknown as GrammyLikeBot, options.host);

  const approvalNotifier = createTelegramApprovalNotifier({
    getOwnerChatId: () => {
      const raw = options.host.getSetupSession().ownerUserId;
      return raw ? Number(raw) : null;
    },
    sendMessage: async (chatId, text, extra) => {
      await bot.api.sendMessage(chatId, text, extra as never);
    },
  });
  const reportNotifier = createTelegramReportNotifier({
    getOwnerChatId: () => {
      const raw = options.host.getSetupSession().ownerUserId;
      return raw ? Number(raw) : null;
    },
    sendMessage: async (chatId, text, extra) => {
      await bot.api.sendMessage(chatId, text, extra as never);
    },
  });

  return {
    bot,
    start: async () => {
      await bot.start();
    },
    stop: () => {
      bot.stop();
    },
    approvalNotifier,
    reportNotifier,
  };
}
