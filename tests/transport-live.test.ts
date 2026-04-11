import { describe, expect, it } from "vitest";

describe("telegram live transport", () => {
  it("sends approval prompts to the configured owner chat", async () => {
    const { createTelegramApprovalNotifier } = await import("../src/telegram/live.ts");

    const sent: Array<{ chatId: number; text: string; extra?: { reply_markup?: unknown } }> = [];
    const notifier = createTelegramApprovalNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (chatId, text, extra) => {
        sent.push({ chatId, text, extra });
      },
    });

    const result = await notifier.sendApprovalRequest({
      approvalId: "approval-1",
      summary: "approve deposit",
    });

    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(42);
    expect(sent[0]?.text).toContain("approve deposit");
    expect(sent[0]?.extra?.reply_markup).toBeTruthy();
  });

  it("registers grammy handlers that route message and callback events through the host", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const claimHost = createPhalanxHost();
    const approvalHost = createPhalanxHost({ lifecycle: "READY", whitelistTargets: ["whitelist-admin"] });
    await approvalHost.invokeMcp("phalanx_action", {
      action: "requestWhitelistExpansion",
      payload: { target: "uniswap-v3" },
      target: "whitelist-admin",
    });
    const approveData = approvalHost.getTelegramApprovalOutbox()[0]?.approveCallbackData;
    if (!approveData) {
      throw new Error("expected pending approval");
    }

    const handlers = new Map<string, (ctx: any) => Promise<void>>();
    const fakeBot = {
      on(event: string, handler: (ctx: any) => Promise<void>) {
        handlers.set(event, handler);
        return this;
      },
      catch() {
        return this;
      },
    };

    registerTelegramBotHandlers(fakeBot as never, claimHost);

    const replies: string[] = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "claim" },
      reply: async (text: string) => {
        replies.push(text);
      },
    });

    let answered = false;
    let edited = "";
    registerTelegramBotHandlers(fakeBot as never, approvalHost);
    await handlers.get("callback_query:data")?.({
      callbackQuery: { data: approveData },
      answerCallbackQuery: async () => {
        answered = true;
      },
      editMessageText: async (text: string) => {
        edited = text;
      },
    });

    expect(replies.join(" ")).toMatch(/confirm/i);
    expect(answered).toBe(true);
    expect(edited.toLowerCase()).toMatch(/approved|executed/);
  });

  it("can bind a real notifier and produce a whitelist-change approval for smoke scripts", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { createTelegramApprovalNotifier } = await import("../src/telegram/live.ts");

    const sent: Array<{ chatId: number; text: string }> = [];
    const host = createPhalanxHost({
      approvalNotifyTimeoutMs: 2_000,
      whitelistTargets: ["whitelist-admin"],
      configValues: {
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
        TELEGRAM_ALLOWED_USER_ID: "42",
        OKX_API_KEY: "okx-key",
        OKX_API_SECRET: "okx-secret",
        OKX_API_PASSPHRASE: "okx-pass",
        OMRATE_API_KEY: "omrate-key",
        OMRATE_API_BASE_URL: "https://omrate.io/api",
        XLAYER_RPC_URL: "https://rpc.example",
      },
    });

    host.bindTelegramApprovalNotifier(
      createTelegramApprovalNotifier({
        getOwnerChatId: () => 42,
        sendMessage: async (chatId, text) => {
          sent.push({ chatId, text });
        },
      }),
    );

    const out = await host.invokeMcp("phalanx_action", {
      action: "requestWhitelistExpansion",
      payload: { target: "uniswap-v3" },
      target: "whitelist-admin",
    });

    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("Approval required");
  });

  it("smoke polling flow should not await bot.start before sending approval", async () => {
    const calls: string[] = [];
    const fakeBot = {
      on() {
        return this;
      },
      catch() {
        return this;
      },
      api: {
        sendMessage: async () => {
          calls.push("sendMessage");
        },
      },
      start: async () => {
        calls.push("start");
        await new Promise(() => {});
      },
      stop: () => {
        calls.push("stop");
      },
    };

    void fakeBot.start();
    await fakeBot.api.sendMessage();

    expect(calls).toEqual(["start", "sendMessage"]);
  });

  it("sends runtime execution reports to the configured owner chat", async () => {
    const { createTelegramReportNotifier } = await import("../src/telegram/live.ts");

    const sent: Array<{ chatId: number; text: string }> = [];
    const notifier = createTelegramReportNotifier({
      getOwnerChatId: () => 42,
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
    });

    await notifier.sendExecutionReport({
      eventId: "evt-1",
      createdAt: new Date().toISOString(),
      correlationId: "intent-1",
      intentId: "intent-1",
      action: "executeRebalance",
      entrySource: "guardian",
      stage: "executed",
      summary: "Executed rebalance",
      reason: "bucket_drift",
      riskNotes: ["single-vault concentration increased"],
      txRefs: ["0xabc"],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(42);
    expect(sent[0]?.text).toContain("executeRebalance");
    expect(sent[0]?.text).toContain("0xabc");
  });
});

describe("mcp live transport", () => {
  it("keeps stdio registration aligned with the shared MCP registry", async () => {
    const { PHALANX_MCP_TOOL_NAMES } = await import("../src/mcp/server.ts");
    const { PHALANX_MCP_TOOL_REGISTRY } = await import("../src/mcp/registry.ts");

    expect(PHALANX_MCP_TOOL_REGISTRY.map((tool) => tool.name)).toEqual(PHALANX_MCP_TOOL_NAMES);
  });

  it("registers Phalanx MCP tools against an MCP server wrapper", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerPhalanxMcpTools } = await import("../src/mcp/stdio.ts");

    const host = createPhalanxHost();
    const calls: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }> = [];
    const fakeServer = {
      registerTool(
        name: string,
        _config: Record<string, unknown>,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) {
        calls.push({ name, handler });
        return {};
      },
    };

    registerPhalanxMcpTools(fakeServer as never, host);

    expect(calls.map((call) => call.name)).toEqual([
      "phalanx_status",
      "phalanx_portfolio",
      "phalanx_action",
      "phalanx_uniswap_liquidity_plan",
    ]);

    const statusResult = await calls[0]!.handler({});
    expect(statusResult).toHaveProperty("content");
  });
});
