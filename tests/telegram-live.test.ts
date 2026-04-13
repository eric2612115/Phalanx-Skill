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
    expect(messages[0]).toContain("Tx: 0xpolicy, 0xdeposit");
  });
});
