import { describe, expect, it } from "vitest";
import { createSetupSession } from "../src/telegram/setup.js";

describe("telegram live transport", () => {
  it("live smoke synthetic mode requires TELEGRAM_ALLOWED_USER_ID before runtime work", async () => {
    const { resolveLiveSmokeSyntheticAllowedUserId } = await import("../scripts/live-smoke.ts");

    expect(() =>
      resolveLiveSmokeSyntheticAllowedUserId({
        PHALANX_SMOKE_SYNTHETIC_READY: "1",
      }),
    ).toThrow(/TELEGRAM_ALLOWED_USER_ID/i);

    expect(
      resolveLiveSmokeSyntheticAllowedUserId({
        PHALANX_SMOKE_SYNTHETIC_READY: "1",
        TELEGRAM_ALLOWED_USER_ID: " 42 ",
      }),
    ).toBe("42");

    expect(resolveLiveSmokeSyntheticAllowedUserId({})).toBeUndefined();
  });

  it("telegram approval smoke can force READY from operator-ready live config", async () => {
    const { resolveTelegramApprovalSmokeLifecycle } = await import("../scripts/telegram-approval-live-smoke.ts");

    expect(
      resolveTelegramApprovalSmokeLifecycle({
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
        TELEGRAM_ALLOWED_USER_ID: "42",
        OKX_API_KEY: "okx-key",
        OKX_API_SECRET: "okx-secret",
        OKX_API_PASSPHRASE: "okx-pass",
        TEST_WALLET_ADDRESS: "0xwallet000000000000000000000000000000000001",
      }),
    ).toBe("READY");

    expect(
      resolveTelegramApprovalSmokeLifecycle({
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
        OKX_API_KEY: "okx-key",
        OKX_API_SECRET: "okx-secret",
        OKX_API_PASSPHRASE: "okx-pass",
        TEST_WALLET_ADDRESS: "0xwallet000000000000000000000000000000000001",
      }),
    ).toBeUndefined();
  });

  it("telegram approval smoke strips uniswap-v3 from the allowlist to force the blocked approval lane", async () => {
    const { buildTelegramApprovalSmokeConfigValues } = await import("../scripts/telegram-approval-live-smoke.ts");

    const next = buildTelegramApprovalSmokeConfigValues({
      WHITELIST_TARGETS: "uniswap-v3,pancakeswap-v3",
    });

    expect(next.WHITELIST_TARGETS).toContain("pancakeswap-v3");
    expect(next.WHITELIST_TARGETS).toContain("whitelist-admin");
    expect(next.WHITELIST_TARGETS).not.toContain("uniswap-v3");
  });

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
      summary: "Requested action: deposit\nBlocked target: pancakeswap-v3",
    });

    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(42);
    expect(sent[0]?.text).toContain("Requested action: deposit");
    expect(sent[0]?.text).toContain("Blocked target: pancakeswap-v3");
    expect(sent[0]?.extra?.reply_markup).toBeTruthy();
  });

  it("registers grammy handlers that route message and callback events through the host", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const claimHost = createPhalanxHost({
      setupSession: createSetupSession({ envAllowedUserId: "7" }),
    });
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

  it("routes queue actions and active wallet changes through the live Telegram surface", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      configValues: {
        TELEGRAM_ALLOWED_USER_ID: "7",
        OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
          profiles: [
            {
              profileId: "profile-1",
              email: "alpha@example.com",
              wallets: [
                { walletId: "wallet-1", address: "0x1111111111111111111111111111111111111111" },
                { walletId: "wallet-2", address: "0x2222222222222222222222222222222222222222" },
              ],
            },
          ],
        }),
      },
    });
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
    registerTelegramBotHandlers(fakeBot as never, host);

    const replies: string[] = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "queue Deposit 8 USDC -> Aave Base" },
      reply: async (text: string) => {
        replies.push(text);
      },
    });
    expect(replies[0]).toContain("Queued");
    const jobId = host.getTelegramJobQueue().jobs[0]?.id;
    if (!jobId) {
      throw new Error("expected queue job");
    }

    replies.length = 0;
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "use wallet wallet-2" },
      reply: async (text: string) => {
        replies.push(text);
      },
    });
    expect(replies[0]).toContain("Active wallet set to wallet-2");

    let edited = "";
    await handlers.get("callback_query:data")?.({
      callbackQuery: { data: `phx_job:cancel:${jobId}` },
      answerCallbackQuery: async () => {},
      editMessageText: async (text: string) => {
        edited = text;
      },
    });
    expect(edited).toContain("Cancelled");
    expect(host.getTelegramJobQueue().jobs).toHaveLength(0);
  });

  it("answers private /help before claim without breaking the claim handshake", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const claimHost = createPhalanxHost({
      setupSession: createSetupSession({ envAllowedUserId: "7" }),
    });

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

    const replies: Array<{ text: string; extra?: { reply_markup?: unknown } }> = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "/help" },
      reply: async (text: string, extra?: { reply_markup?: unknown }) => {
        replies.push({ text, extra });
      },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toMatch(/AgentPhalanx/i);
    expect(replies[0]?.text.toLowerCase()).toMatch(/not an open-ended|keyword/);
    expect(replies[0]?.extra?.reply_markup).toBeTruthy();

    replies.length = 0;
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "claim" },
      reply: async (text: string) => {
        replies.push({ text });
      },
    });
    expect(replies.map((entry) => entry.text).join(" ")).toMatch(/confirm/i);
  });

  it("answers private /start before claim with onboarding + FAQ keyboard", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const claimHost = createPhalanxHost({
      setupSession: createSetupSession({ envAllowedUserId: "7" }),
    });

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

    const replies: Array<{ text: string; extra?: { reply_markup?: unknown } }> = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "/start" },
      reply: async (text: string, extra?: { reply_markup?: unknown }) => {
        replies.push({ text, extra });
      },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toMatch(/AgentPhalanx/i);
    expect(replies[0]?.text).toMatch(/\/claim/i);
    expect(replies[0]?.text).toMatch(/FAQ|docs|source/i);
    expect(replies[0]?.extra?.reply_markup).toBeTruthy();
  });

  it("answers supported FAQ prompts before claim using the document-grounded FAQ layer", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const claimHost = createPhalanxHost({
      setupSession: createSetupSession({ envAllowedUserId: "7" }),
    });

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

    const replies: Array<{ text: string; extra?: { reply_markup?: unknown } }> = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "Why is OTP required?" },
      reply: async (text: string, extra?: { reply_markup?: unknown }) => {
        replies.push({ text, extra });
      },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toMatch(/OTP/i);
    expect(replies[0]?.text).toMatch(/wallet/i);
    expect(replies[0]?.text).toMatch(/README\.md|live-demo-runbook/i);
    expect(replies[0]?.extra?.reply_markup).toBeTruthy();
  });

  it("does not treat READY-state operator shortcut buttons as implicit owner-claim text before claim", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const claimHost = createPhalanxHost({
      setupSession: createSetupSession({ envAllowedUserId: "7" }),
    });

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

    const replies: Array<{ text: string; extra?: { reply_markup?: unknown } }> = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "status" },
      reply: async (text: string, extra?: { reply_markup?: unknown }) => {
        replies.push({ text, extra });
      },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toMatch(/\/claim/i);
    expect(replies[0]?.text.toLowerCase()).toMatch(/before ready|finish setup|claim first|not ready/i);
    expect(replies[0]?.text).not.toMatch(/candidate accepted/i);
    expect(replies[0]?.extra?.reply_markup).toBeTruthy();
  });

  it("does not swallow setup-wizard input with pre-ready operator shortcut interception after claim", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");

    const session = createSetupSession({ envAllowedUserId: "7" });
    session.lifecycle = "SETUP_IN_PROGRESS";
    session.ownerUserId = "7";
    session.wizardStep = "collect_omrate";

    const host = createPhalanxHost({ setupSession: session });

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

    registerTelegramBotHandlers(fakeBot as never, host);

    const replies: string[] = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "OMRATE_API_KEY=status-feed" },
      reply: async (text: string) => {
        replies.push(text);
      },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]?.toLowerCase()).toMatch(/step saved|saved/i);
    expect(replies[0]?.toLowerCase()).not.toMatch(/claim first|finish setup before using ready-state/i);
  });

  it("routes READY-state operator text through the bounded catalog", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");
    const { createSetupSession } = await import("../src/telegram/setup.ts");

    const session = createSetupSession();
    session.lifecycle = "READY";
    session.ownerUserId = "7";
    session.wizardStep = null;

    const host = createPhalanxHost({
      lifecycle: "READY",
      setupSession: session,
      whitelistTargets: ["pool"],
    });

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

    registerTelegramBotHandlers(fakeBot as never, host);

    const replies: string[] = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "status" },
      reply: async (text: string) => {
        replies.push(text);
      },
    });

    expect(replies.length).toBeGreaterThan(0);
    expect(replies.join("\n").toLowerCase()).toMatch(/ready|lifecycle|pending|guidance|mode/i);
  });

  it("answers private help alias in READY state without requiring a catalog keyword", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { registerTelegramBotHandlers } = await import("../src/telegram/live.ts");
    const { createSetupSession } = await import("../src/telegram/setup.ts");

    const session = createSetupSession();
    session.lifecycle = "READY";
    session.ownerUserId = "7";
    session.wizardStep = null;

    const host = createPhalanxHost({
      lifecycle: "READY",
      setupSession: session,
      whitelistTargets: ["pool"],
    });

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

    registerTelegramBotHandlers(fakeBot as never, host);

    const replies: Array<{ text: string; extra?: { reply_markup?: unknown } }> = [];
    await handlers.get("message:text")?.({
      from: { id: 7 },
      chat: { id: 7, type: "private" },
      message: { text: "help" },
      reply: async (text: string, extra?: { reply_markup?: unknown }) => {
        replies.push({ text, extra });
      },
    });

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toMatch(/AgentPhalanx/i);
    expect(replies[0]?.extra?.reply_markup).toBeTruthy();
  });

  it("can bind a real notifier and produce a whitelist-change approval for smoke scripts", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { createTelegramApprovalNotifier } = await import("../src/telegram/live.ts");

    const sent: Array<{ chatId: number; text: string }> = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
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
        TEST_WALLET_ADDRESS: "0xwallet000000000000000000000000000000000001",
        POLICY_OWNER_KEY: "0xabc",
        WHITELIST_POLICY_ADDRESS: "0x123",
        PHALANX_OWNER_EVM_ADDRESS: "0xowner",
        BASE_RPC_URL: "https://base.rpc",
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
