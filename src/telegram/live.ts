import { Bot, InlineKeyboard, Keyboard } from "grammy";

import type { PhalanxHost } from "../app/host.js";
import type { TelegramReportNotifier } from "../app/host.js";
import type { RuntimeEvent } from "../runtime/events.js";
import { SecretGuard } from "../security/secret-guard.js";
import { detectionsInString } from "../security/detectors.js";
import { redactString } from "../security/redaction.js";
import { describeRuntimeAction } from "../runtime/action-labels.js";
import type { TelegramApprovalNotifier, TelegramApprovalNotifierResult } from "../mcp/server.js";
import {
  buildOperatorFallbackReply,
  buildOperatorHelpReply,
  buildOperatorStartReply,
  buildPreReadyOperatorShortcutReply,
  buildTelegramFaqReply,
  buildTelegramStartKeyboardRows,
  isOperatorHelpCommand,
  isOperatorStartCommand,
} from "./fallback.js";
import { formatOperatorQueryPayload } from "./operator-formatters.js";
import { runOperatorQuery } from "./operator-queries.js";
import { classifyOperatorTelegramText } from "./operator-router.js";

type SendMessageExtra = {
  reply_markup?: unknown;
};

const TELEGRAM_OUTPUT_GUARD = new SecretGuard("REDACT_AND_CONTINUE");

function redactTelegramText(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  const spans = detectionsInString(value);
  return spans.length > 0 ? redactString(value, spans) : value;
}

function safeTelegramErrorPayload(error: unknown): unknown {
  if (error instanceof Error) {
    return TELEGRAM_OUTPUT_GUARD.safeErrorMessage(error);
  }
  return TELEGRAM_OUTPUT_GUARD.filterOutput(error).output;
}

function summarizeTelegramErrorForRuntime(error: unknown): string {
  const safe = safeTelegramErrorPayload(error);
  if (typeof safe === "string") {
    return safe;
  }
  try {
    return JSON.stringify(safe);
  } catch {
    return "Telegram delivery failed";
  }
}

export interface TelegramMessageSender {
  sendMessage(chatId: number, text: string, extra?: SendMessageExtra): Promise<unknown>;
}

export interface TelegramApprovalNotifierDeps {
  getOwnerChatId(): number | null;
  sendMessage(chatId: number, text: string, extra?: SendMessageExtra): Promise<unknown>;
}

export interface TelegramReportFailureContext {
  readonly event: RuntimeEvent;
  readonly errorSummary: string;
}

export interface TelegramReportNotifierDeps extends TelegramApprovalNotifierDeps {
  readonly onDeliveryFailure?: (ctx: TelegramReportFailureContext) => void | Promise<void>;
}

export type GrammyLikeBot = {
  on(event: "message:text" | "callback_query:data", handler: (ctx: any) => Promise<void>): GrammyLikeBot;
  catch(handler: (error: unknown) => void): GrammyLikeBot;
};

export function buildApprovalKeyboard(approvalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve", `phx_approval:approve:${approvalId}`)
    .text("Reject", `phx_approval:reject:${approvalId}`);
}

export function buildOperatorHelpKeyboard(): Keyboard {
  return new Keyboard()
    .text("status")
    .text("portfolio")
    .row()
    .text("recent events")
    .text("what next")
    .row()
    .text("current whitelist")
    .text("risk summary")
    .row()
    .text("agent wallet")
    .text("x402 summary")
    .resized();
}

export function buildOperatorStartKeyboard(): Keyboard {
  const keyboard = new Keyboard();
  const rows = buildTelegramStartKeyboardRows();
  rows.forEach((row, rowIndex) => {
    row.forEach((label) => {
      keyboard.text(label);
    });
    if (rowIndex < rows.length - 1) {
      keyboard.row();
    }
  });
  return keyboard.resized();
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

const TELEGRAM_EVIDENCE_LINE_MAX = 280;

function truncateTelegramEvidenceLine(value: string, max = TELEGRAM_EVIDENCE_LINE_MAX): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function appendRuntimeExecutionContext(lines: string[], event: RuntimeEvent): void {
  const ee = event.executionEvidence;
  if (!ee) {
    return;
  }
  const hasWallet = Boolean(ee.wallet);
  const milestoneEntries =
    ee.milestones === undefined
      ? []
      : (Object.entries(ee.milestones) as Array<[string, boolean | undefined]>).filter(([, v]) => v === true);
  const hasMilestones = milestoneEntries.length > 0;
  if (!hasWallet && !hasMilestones) {
    return;
  }
  lines.push("", "Execution context (runtime evidence):");
  if (hasWallet && ee.wallet) {
    const w = ee.wallet;
    lines.push(`• Wallet: ${w.resolvedAddress || "<empty>"}`);
    lines.push(`  source=${w.source} chain=${w.chain} override=${w.overrideActive ? "yes" : "no"}`);
    lines.push(`  reason: ${w.reason}`);
  }
  if (hasMilestones) {
    lines.push("", `Milestones: ${milestoneEntries.map(([k]) => k).join(", ")}`);
  }
}

function appendRuntimePaymentSummary(lines: string[], event: RuntimeEvent): void {
  const p = event.executionEvidence?.payment ?? event.demoRun?.omRateExecutionEvidence.payment;
  if (!p) {
    return;
  }
  lines.push("", "Payment (runtime evidence):");
  lines.push(`• mode=${p.mode} required=${p.paymentRequired} baseline=${p.baselineReady}`);
  lines.push(`  attempted=${p.paymentAttempted} wrapped=${p.paymentWrapped} settled=${p.paymentSettled}`);
  lines.push(`  summary: ${truncateTelegramEvidenceLine(redactTelegramText(p.summary) ?? p.summary)}`);
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
  lines.push(
    `• Swap prep: ${d.swapPreparation.status} — ${
      redactTelegramText(d.swapPreparation.summary) ?? d.swapPreparation.summary
    }`,
  );
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
      `Summary: ${redactTelegramText(event.summary) ?? event.summary}`,
    ];
    if (event.reason) {
      lines.push(`Reason: ${redactTelegramText(event.reason) ?? event.reason}`);
    }
    if (event.riskNotes && event.riskNotes.length > 0) {
      lines.push(`Context: ${redactTelegramText(event.riskNotes.join(" | ")) ?? event.riskNotes.join(" | ")}`);
    }
    appendRuntimeExecutionContext(lines, event);
    appendRuntimePaymentSummary(lines, event);
    appendDemoRunLines(lines, event);
    return lines.join("\n");
  }
  const title = event.stage === "executed" ? "Execution report" : "Execution alert";
  const lines = [title, "", `Final status: ${event.stage}`, `Action: ${event.action}`, `Intent: ${event.intentId}`, `Correlation: ${event.correlationId}`];
  if (event.target) {
    lines.push(`Target: ${event.target}`);
  }
  appendRuntimeExecutionContext(lines, event);
  appendRuntimePaymentSummary(lines, event);
  lines.push("", "Action result:");
  lines.push(redactTelegramText(event.summary) ?? event.summary);
  if (event.reason) {
    lines.push(`Reason: ${redactTelegramText(event.reason) ?? event.reason}`);
  }
  if (event.riskNotes && event.riskNotes.length > 0) {
    lines.push(`Risk: ${redactTelegramText(event.riskNotes.join(" | ")) ?? event.riskNotes.join(" | ")}`);
  }
  appendDemoRunLines(lines, event);
  if (event.txRefs && event.txRefs.length > 0) {
    lines.push("", "Transactions:");
    for (const [index, txRef] of event.txRefs.entries()) {
      lines.push(`${index + 1}. ${txRef}`);
      const explorerUrl = buildExplorerTxUrl(event, txRef);
      if (explorerUrl) {
        lines.push(explorerUrl);
      }
    }
  }
  return lines.join("\n");
}

function buildExplorerTxUrl(event: RuntimeEvent, txRef: string): string | undefined {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txRef)) {
    return undefined;
  }
  const chain = inferExplorerChain(event);
  if (!chain) {
    return undefined;
  }
  return `https://web3.okx.com/zh-hant/explorer/${chain}/tx/${txRef}`;
}

function inferExplorerChain(event: RuntimeEvent): string | undefined {
  const demoChain = event.demoRun?.chain?.trim().toLowerCase();
  if (demoChain) {
    return normalizeExplorerChain(demoChain);
  }
  if (event.target === "uniswap-v3" || event.target === "pancakeswap-v3") {
    return "base";
  }
  return undefined;
}

function normalizeExplorerChain(chain: string): string | undefined {
  if (chain === "base") return "base";
  if (chain === "xlayer") return "xlayer";
  if (chain === "bsc" || chain === "bnb") return "bsc";
  return undefined;
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
      try {
        await deps.sendMessage(chatId, renderRuntimeExecutionReport(event));
      } catch (error) {
        console.error("Telegram report delivery failed:", safeTelegramErrorPayload(error));
        await deps.onDeliveryFailure?.({
          event,
          errorSummary: summarizeTelegramErrorForRuntime(error),
        });
      }
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
    if (
      (adapterResult?.mode === "whitelist_governance_completed" ||
        adapterResult?.mode === "whitelist_local_completed") &&
      typeof adapterResult.resumedAction === "string"
    ) {
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
    const rawForHelp = ctx.message?.text ?? "";
    const trimmedForHelp = rawForHelp.trim();
    if (ctx.chat?.type === "private" && isOperatorStartCommand(trimmedForHelp)) {
      await ctx.reply(buildOperatorStartReply(), {
        reply_markup: buildOperatorStartKeyboard(),
      });
      return;
    }
    if (ctx.chat?.type === "private" && isOperatorHelpCommand(trimmedForHelp)) {
      await ctx.reply(buildOperatorHelpReply(), {
        reply_markup: buildOperatorHelpKeyboard(),
      });
      return;
    }
    if (ctx.chat?.type === "private") {
      const session = host.getSetupSession();
      if (session.lifecycle === "UNCLAIMED") {
        const route = classifyOperatorTelegramText(trimmedForHelp);
        if (route.kind === "query") {
          await ctx.reply(buildPreReadyOperatorShortcutReply(), {
            reply_markup: buildOperatorStartKeyboard(),
          });
          return;
        }
      }
      const faqReply = buildTelegramFaqReply(trimmedForHelp);
      if (faqReply) {
        await ctx.reply(faqReply, {
          reply_markup: buildOperatorStartKeyboard(),
        });
        return;
      }
    }

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
    console.error("Telegram bot error:", safeTelegramErrorPayload(error));
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
    onDeliveryFailure: async ({ event, errorSummary }) => {
      await options.host.recordTelegramReportFailure(event, errorSummary);
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
