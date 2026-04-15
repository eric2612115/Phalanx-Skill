import { describe, expect, it, vi } from "vitest";

import { createTelegramReportNotifier, registerTelegramBotHandlers } from "../src/telegram/live.ts";
import { createSetupSession } from "../src/telegram/setup.ts";
import { buildPortfolioSnapshot } from "../src/adapters/portfolio.ts";
import { runGuardianCycle } from "../src/guardian/cycle.ts";

describe("telegram live notifier", () => {
  it("renders guardian_detected as a rebalance proposal instead of an execution alert", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-1",
      createdAt: new Date().toISOString(),
      correlationId: "corr-1",
      intentId: "intent-1",
      action: "proposeRebalance",
      entrySource: "guardian",
      target: "uniswap-v3",
      stage: "guardian_detected",
      summary: "Rebalance candidate ready | Pool USDC/ETH | Wallet already aligned.",
      reason: "Bucket allocation drift 3000 bps exceeds allowed 500 bps.",
      riskNotes: ["No swap required."],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Rebalance proposal");
    expect(messages[0]).toContain("Pool USDC/ETH");
    expect(messages[0]).not.toContain("Execution alert");
  });

  it("redacts sensitive text from guardian proposal summaries before sending to Telegram", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-guardian-redact-1",
      createdAt: new Date().toISOString(),
      correlationId: "corr-guardian-redact-1",
      intentId: "intent-guardian-redact-1",
      action: "proposeRebalance",
      entrySource: "guardian",
      stage: "guardian_detected",
      summary: "Retry with operator@example.com and OMRATE_API_KEY=sk_live_abc123",
      reason: "Failed while checking operator@example.com",
      riskNotes: ["Escalate to operator@example.com"],
      demoRun: {
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        swapPreparation: { kind: "swap_preparation", status: "blocked", summary: "operator@example.com needs OTP" },
        lpExecution: { ready: false },
        omRateExecutionEvidence: { milestones: {} },
      },
    });

    const body = messages[0]!;
    expect(body).toContain("[REDACTED]");
    expect(body).not.toContain("operator@example.com");
    expect(body).not.toContain("sk_live_abc123");
  });

  it("formats operator readiness payloads for Telegram", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { runOperatorQuery } = await import("../src/telegram/operator-queries.ts");
    const { formatOperatorQueryPayload } = await import("../src/telegram/operator-formatters.ts");

    const host = createPhalanxHost({ lifecycle: "READY", whitelistTargets: ["pool"] });
    const payload = await runOperatorQuery(host, "readiness_pending");
    const lines = formatOperatorQueryPayload(payload);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n").toLowerCase()).toMatch(/lifecycle|pending|mode/i);
  });

  it("formats queued jobs with sequence numbers and waiting counts", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { runOperatorQuery } = await import("../src/telegram/operator-queries.ts");
    const { formatOperatorQueryPayload } = await import("../src/telegram/operator-formatters.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      configValues: {
        OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
          profiles: [
            {
              profileId: "profile-1",
              email: "alpha@example.com",
              wallets: [{ walletId: "wallet-1", address: "0x1111111111111111111111111111111111111111" }],
            },
          ],
        }),
      },
    });
    host.enqueueTelegramJob("Deposit 8 USDC -> Aave Base");
    host.enqueueTelegramJob("Deposit 8 USDC -> Morpho Base");
    host.enqueueTelegramJob("Mint LP position");

    const payload = await runOperatorQuery(host, "job_queue");
    const body = formatOperatorQueryPayload(payload).join("\n");
    expect(body).toContain("[#1] Deposit 8 USDC -> Aave Base");
    expect(body).toContain("[#2] Deposit 8 USDC -> Morpho Base");
    expect(body).toContain("[#3] Mint LP position");
    expect(body).toContain("waiting... (2 ahead)");
  });

  it("redacts sensitive text from recent-events operator replies", async () => {
    const { formatOperatorQueryPayload } = await import("../src/telegram/operator-formatters.ts");
    const lines = formatOperatorQueryPayload({
      family: "recent_events",
      snapshot: {
        limit: 5,
        items: [
          {
            createdAt: "2026-01-01T00:00:00.000Z",
            stage: "executed",
            action: "deposit",
            entrySource: "telegram",
            summary: "retry with operator@example.com and OMRATE_API_KEY=sk_live_abc123",
          },
        ],
      },
    } as any);
    const body = lines.join("\n");
    expect(body).toContain("[REDACTED]");
    expect(body).not.toContain("operator@example.com");
    expect(body).not.toContain("sk_live_abc123");
  });

  it("keeps executed events as execution reports", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-2",
      createdAt: new Date().toISOString(),
      correlationId: "corr-2",
      intentId: "intent-2",
      action: "depositLpPosition",
      entrySource: "guardian",
      target: "uniswap-v3",
      stage: "executed",
      summary: "Executed depositLpPosition",
      txRefs: ["0xpolicy", "0xdeposit"],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Execution report");
    expect(messages[0]).toContain("Transactions:");
    expect(messages[0]).toContain("1. 0xpolicy");
    expect(messages[0]).not.toContain("https://web3.okx.com");
  });

  it("renders aggregated external explorer links for executable tx hashes", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-3",
      createdAt: new Date().toISOString(),
      correlationId: "corr-3",
      intentId: "intent-3",
      action: "withdrawLpPosition",
      entrySource: "guardian",
      target: "uniswap-v3",
      stage: "executed",
      summary: "Executed withdrawLpPosition",
      txRefs: [
        "0x2469a7620018864619889fece13ed614b27a87a23c85ac05433e03cec5292cff",
        "0x1ec2390273ef1d92ff58d4ce7efe42e4462b872cddfdeb583dd002461ec59fd3",
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Transactions:");
    expect(messages[0]).toContain(
      "https://web3.okx.com/zh-hant/explorer/base/tx/0x2469a7620018864619889fece13ed614b27a87a23c85ac05433e03cec5292cff",
    );
    expect(messages[0]).toContain(
      "https://web3.okx.com/zh-hant/explorer/base/tx/0x1ec2390273ef1d92ff58d4ce7efe42e4462b872cddfdeb583dd002461ec59fd3",
    );
  });

  it("groups completion report with runtime executionEvidence (wallet, payment, result, tx links)", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-evidence-1",
      createdAt: new Date().toISOString(),
      correlationId: "corr-ev-1",
      intentId: "intent-ev-1",
      action: "depositLpPosition",
      entrySource: "mcp",
      target: "uniswap-v3",
      stage: "executed",
      summary: "Executed depositLpPosition",
      executionEvidence: {
        wallet: {
          resolvedAddress: "0x1111111111111111111111111111111111111111",
          source: "managed",
          chain: "base",
          reason: "onchain_os_managed_wallet_selected",
          overrideActive: false,
        },
        payment: {
          mode: "x402_required",
          paymentRequired: true,
          baselineReady: true,
          paymentAttempted: true,
          paymentWrapped: true,
          paymentSettled: true,
          summary: "omrate_http:completed:200;wrap=true",
        },
        milestones: { wallet_resolved: true, uniswap_executed: true },
      },
      txRefs: ["0x2469a7620018864619889fece13ed614b27a87a23c85ac05433e03cec5292cff"],
    });

    expect(messages).toHaveLength(1);
    const body = messages[0]!;
    expect(body).toContain("Execution report");
    expect(body).toContain("Final status: executed");
    expect(body).toContain("Execution context (runtime evidence)");
    expect(body).toContain("0x1111111111111111111111111111111111111111");
    expect(body).toContain("source=managed");
    expect(body).toContain("Payment (runtime evidence)");
    expect(body).toContain("mode=x402_required");
    expect(body).toContain("settled=true");
    expect(body.indexOf("Final status: executed")).toBeLessThan(body.indexOf("Execution context (runtime evidence):"));
    expect(body.indexOf("Execution context (runtime evidence):")).toBeLessThan(body.indexOf("Payment (runtime evidence):"));
    expect(body.indexOf("Payment (runtime evidence):")).toBeLessThan(body.indexOf("Action result:"));
    expect(body).toContain("Action result:");
    expect(body).toContain("Executed depositLpPosition");
    expect(body).toContain("Milestones:");
    expect(body).toContain("uniswap_executed");
    expect(body).toContain("Transactions:");
    expect(body).toContain(
      "https://web3.okx.com/zh-hant/explorer/base/tx/0x2469a7620018864619889fece13ed614b27a87a23c85ac05433e03cec5292cff",
    );
  });

  it("keeps x402 summary visible in Telegram reports when payment evidence lives under demoRun", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-demo-payment-1",
      createdAt: new Date().toISOString(),
      correlationId: "corr-demo-payment-1",
      intentId: "intent-demo-payment-1",
      action: "depositLpPosition",
      entrySource: "guardian",
      target: "uniswap-v3",
      stage: "executed",
      summary: "Executed depositLpPosition",
      demoRun: {
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        swapPreparation: { kind: "swap_preparation", status: "assets_match", summary: "Wallet already aligned." },
        lpExecution: { ready: true, action: "depositLpPosition", target: "uniswap-v3" },
        omRateExecutionEvidence: {
          payment: {
            mode: "x402_required",
            paymentRequired: true,
            baselineReady: true,
            paymentAttempted: true,
            paymentWrapped: true,
            paymentSettled: true,
            summary: "omrate_http:completed:200;wrap=true",
          },
          milestones: {},
        },
      },
    });

    const body = messages[0]!;
    expect(body).toContain("Payment (runtime evidence)");
    expect(body).toContain("mode=x402_required");
    expect(body).toContain("settled=true");
  });

  it("redacts sensitive text from execution-report risk notes", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-risk-redact-1",
      createdAt: new Date().toISOString(),
      correlationId: "corr-risk-redact-1",
      intentId: "intent-risk-redact-1",
      action: "depositLpPosition",
      entrySource: "guardian",
      target: "uniswap-v3",
      stage: "executed",
      summary: "Executed depositLpPosition",
      riskNotes: ["Escalate to operator@example.com with OMRATE_API_KEY=sk_live_abc123"],
    });

    const body = messages[0]!;
    expect(body).toContain("[REDACTED]");
    expect(body).not.toContain("operator@example.com");
    expect(body).not.toContain("sk_live_abc123");
  });

  it("keeps demo context before grouped transactions in completion reports", async () => {
    const messages: string[] = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (_chatId, text) => {
        messages.push(text);
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-demo-order-1",
      createdAt: new Date().toISOString(),
      correlationId: "corr-demo-order-1",
      intentId: "intent-demo-order-1",
      action: "depositLpPosition",
      entrySource: "guardian",
      target: "uniswap-v3",
      stage: "executed",
      summary: "Executed depositLpPosition",
      demoRun: {
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
        selectedPool: { pairLabel: "USDC/ETH" },
        swapPreparation: { kind: "swap_preparation", status: "assets_match", summary: "Wallet already aligned." },
        lpExecution: { ready: true, action: "depositLpPosition", target: "uniswap-v3" },
        omRateExecutionEvidence: { milestones: {} },
      },
      txRefs: ["0x2469a7620018864619889fece13ed614b27a87a23c85ac05433e03cec5292cff"],
    });

    const body = messages[0]!;
    expect(body.indexOf("Demo context:")).toBeGreaterThan(-1);
    expect(body.indexOf("Demo context:")).toBeLessThan(body.indexOf("Transactions:"));
  });

  it("treats missing owner chat as skipped report delivery instead of execution failure", async () => {
    const sendMessage = vi.fn();
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => null,
      sendMessage,
    });

    await expect(
      notifier.sendExecutionReport({
        eventId: "evt-skip-1",
        createdAt: new Date().toISOString(),
        correlationId: "corr-skip-1",
        intentId: "intent-skip-1",
        action: "deposit",
        entrySource: "guardian",
        stage: "executed",
        summary: "Executed deposit",
      }),
    ).resolves.toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("treats report delivery failure as non-execution failure", async () => {
    const failures: Array<{ summary: string }> = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async () => {
        throw new Error("telegram send failed");
      },
      onDeliveryFailure: async ({ errorSummary }) => {
        failures.push({ summary: errorSummary });
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifier.sendExecutionReport({
        eventId: "evt-sendfail-1",
        createdAt: new Date().toISOString(),
        correlationId: "corr-sendfail-1",
        intentId: "intent-sendfail-1",
        action: "deposit",
        entrySource: "guardian",
        stage: "executed",
        summary: "Executed deposit",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.summary.toLowerCase()).toMatch(/telegram send failed/);
    errorSpy.mockRestore();
  });

  it("redacts secret-like content from Telegram report delivery logs", async () => {
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async () => {
        throw new Error("send failed: OKX_AGENTIC_WALLET_LOGIN_EMAIL=operator@example.com OMRATE_API_KEY=sk_live_abc123");
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await notifier.sendExecutionReport({
      eventId: "evt-sendfail-redacted-1",
      createdAt: new Date().toISOString(),
      correlationId: "corr-sendfail-redacted-1",
      intentId: "intent-sendfail-redacted-1",
      action: "deposit",
      entrySource: "guardian",
      stage: "executed",
      summary: "Executed deposit",
    });

    expect(errorSpy).toHaveBeenCalled();
    const joined = errorSpy.mock.calls.flat().join(" ");
    expect(joined).not.toContain("operator@example.com");
    expect(joined).not.toContain("sk_live_abc123");
    expect(joined).toContain("[REDACTED]");
    errorSpy.mockRestore();
  });

  it("auto-sends completion reports only for guardian-origin runtime events", async () => {
    const sentStages: string[] = [];
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      telegramReport: {
        sendExecutionReport: async (event) => {
          sentStages.push(`${event.entrySource}:${event.stage}`);
        },
      },
      executor: {
        execute: async () => ({ provider: "test", summary: "ok" }),
      },
    });

    const portfolio = await host.invokeMcp("phalanx_portfolio", {});
    expect(portfolio.ok).toBe(true);
    expect(sentStages).toEqual([]);

    const cycle = runGuardianCycle({
      now: 5,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        5,
      ),
    });
    await host.handleGuardianCycleResult(cycle);

    expect(sentStages.some((row) => row === "guardian:guardian_detected")).toBe(true);
  });

  it("serves static /help in private chat before the READY owner gate", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const session = createSetupSession();
    session.lifecycle = "READY";
    session.ownerUserId = "7";
    session.wizardStep = null;

    const host = createPhalanxHost({
      lifecycle: "READY",
      setupSession: session,
      whitelistTargets: ["pool"],
    });

    const handlers = new Map<string, (ctx: unknown) => Promise<void>>();
    const fakeBot = {
      on(event: string, handler: (ctx: unknown) => Promise<void>) {
        handlers.set(event, handler);
        return this;
      },
      catch() {
        return this;
      },
    };

    registerTelegramBotHandlers(fakeBot as never, host);

    const replies: Array<{ text: string; extra?: { reply_markup?: unknown } }> = [];
    await handlers.get("message:text")?.({
      from: { id: 999 },
      chat: { type: "private" },
      message: { text: "/help" },
      reply: async (text: string, extra?: { reply_markup?: unknown }) => {
        replies.push({ text, extra });
      },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toMatch(/AgentPhalanx/i);
    expect(replies[0]?.text.toLowerCase()).toMatch(/keyword|bounded/);
    expect(replies[0]?.extra?.reply_markup).toBeTruthy();
  });
});
