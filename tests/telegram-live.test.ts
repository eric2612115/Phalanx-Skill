import { describe, expect, it } from "vitest";

import { createTelegramReportNotifier } from "../src/telegram/live.ts";

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
});
