import { describe, expect, it, vi } from "vitest";
import { buildPortfolioSnapshot } from "../src/adapters/portfolio.ts";
import { runGuardianCycle } from "../src/guardian/cycle.ts";

describe("runtime host integration", () => {
  it("routes whitelist-change approvals back through RuntimeCore on Telegram approve", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
    });

    const out = await host.invokeMcp("phalanx_action", {
      action: "requestWhitelistExpansion",
      payload: { target: "uniswap-v3" },
      target: "whitelist-admin",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("expected MCP action to request approval");
    }

    const queued = host.getTelegramApprovalOutbox();
    expect(queued).toHaveLength(1);

    const callback = queued[0]!.approveCallbackData;
    const resumed = await host.handleTelegramCallback(callback);
    expect(resumed.handled).toBe(true);
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    expect(host.getTelegramApprovalOutbox()).toHaveLength(0);
  });

  it("executes allowlisted actions without queuing Telegram approval", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["uniswap-v3"],
    });

    const out = await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: { amount: "1" },
      target: "uniswap-v3",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("expected allowlisted action to execute");
    }
    expect(out.data.kind).toBe("executed");
    expect(host.getTelegramApprovalOutbox()).toHaveLength(0);
  });

  it("exposes dry-run startup state for MCP and Telegram surfaces", async () => {
    const { createPhalanxHost, buildDryRunStartupSummary } = await import("../src/app/host.ts");

    const host = createPhalanxHost({ configValues: {} });
    const summary = buildDryRunStartupSummary(host);

    expect(summary.lifecycle).toBe("UNCLAIMED");
    expect(summary.surfaces.mcp).toBe("ready");
    expect(summary.surfaces.telegram).toBe("ready");
    expect(summary.pendingApprovals).toBe(0);
    expect(summary.guidance.toLowerCase()).toMatch(/telegram|setup/);
  });

  it("reports live mode readiness when config values are provided", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      configValues: {
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
        TELEGRAM_ALLOWED_USER_ID: "99",
        OKX_API_KEY: "okx-key",
        OKX_API_SECRET: "okx-secret",
        OKX_API_PASSPHRASE: "okx-pass",
        OMRATE_API_KEY: "omrate-key",
        OMRATE_API_BASE_URL: "https://omrate.io/api",
        XLAYER_RPC_URL: "https://rpc.example",
        POLICY_OWNER_KEY: "0xabc",
        WHITELIST_POLICY_ADDRESS: "0x123",
        PHALANX_OWNER_EVM_ADDRESS: "0xowner",
        BASE_RPC_URL: "https://base.rpc",
        TEST_WALLET_ADDRESS: "0xwallet000000000000000000000000000000000001",
      },
    });

    const summary = host.getStartupSummary();
    expect(summary.mode).toBe("live");
    expect(summary.config.liveReady).toBe(true);
    expect(summary.config.masked.TELEGRAM_BOT_TOKEN).not.toContain("telegram-secret-token");
  });

  it("records Telegram report delivery failure as a runtime event without recursive Telegram send", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const sent: string[] = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
      telegramReport: {
        sendExecutionReport: async (event) => {
          sent.push(event.stage);
        },
      },
    });

    await host.recordTelegramReportFailure(
      {
        eventId: "evt-1",
        createdAt: new Date().toISOString(),
        correlationId: "corr-1",
        intentId: "intent-1",
        action: "deposit",
        entrySource: "guardian",
        stage: "executed",
        summary: "Executed deposit",
      },
      "telegram send failed",
    );

    expect(sent).toEqual([]);
    const events = host.getRuntimeEvents();
    expect(events.at(-1)?.stage).toBe("report_failed");
    expect(events.at(-1)?.reason).toContain("telegram send failed");
  });

  it("records report_failed when a guardian Telegram notifier throws from publishRuntimeEvent", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      executor: {
        execute: async () => ({
          provider: "test",
          txRefs: ["0xrebalance"],
          summary: "guardian rebalance executed",
        }),
      },
      telegramReport: {
        sendExecutionReport: async () => {
          throw new Error("guardian notifier failed with operator@example.com");
        },
      },
    });

    const cycle = runGuardianCycle({
      now: 88,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        88,
      ),
    });

    await host.handleGuardianCycleResult(cycle);

    const events = host.getRuntimeEvents();
    expect(events.some((event) => event.stage === "report_failed")).toBe(true);
    const lastReportFailure = [...events].reverse().find((event) => event.stage === "report_failed");
    expect(lastReportFailure?.reason).toContain("[REDACTED]");
    expect(lastReportFailure?.reason).not.toContain("operator@example.com");
    errorSpy.mockRestore();
  });

  it("derives guardian surface status from config values when explicit option is omitted", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      configValues: {
        PHALANX_GUARDIAN_ENABLED: "1",
      },
    });

    expect(host.getStartupSummary().surfaces.guardian).toBe("enabled");
  });

  it("uses whitelist targets from config values when explicit host options are absent", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      configValues: {
        WHITELIST_TARGETS: "uniswap-v3,pancakeswap-v3",
      },
    });

    const out = await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: { amount: "1" },
      target: "pancakeswap-v3",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("expected allowlisted config target to execute");
    }
    expect(out.data.kind).toBe("executed");
  });

  it("can route allowlisted swaps through the skill-backed executor", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      configValues: {
        PHALANX_EXECUTION_BACKEND: "onchainos_skill",
        WHITELIST_TARGETS: "uniswap-v3",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
        PATH: "/definitely/missing",
      },
    });

    const out = await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: {
        fromTokenAddress: "0x1111111111111111111111111111111111111111",
        toTokenAddress: "0x2222222222222222222222222222222222222222",
        readableAmount: "1.5",
        chain: "base",
      },
      target: "uniswap-v3",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("expected skill-backed swap execution result");
    }
    expect(out.data.kind).toBe("executed");
    expect(out.data.adapterResult).toMatchObject({
      provider: "onchainos",
      lane: "swap_execute",
      status: "tool_missing",
    });
  });

  it("skill-backed withdrawLpPosition uses Onchain OS discovery hooks then direct NPM withdraw", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const NPM = "0x03a520b32c04bf3beef7beb72e919cf822ed34f1";

    const host = createPhalanxHost({
      lifecycle: "READY",
      configValues: {
        PHALANX_EXECUTION_BACKEND: "onchainos_skill",
        WHITELIST_TARGETS: "uniswap-v3",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
        PATH: "/definitely/missing",
      },
      lpExecutionHooks: {
        readDefiDetailImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "detail"],
          summary: "detail completed",
          stdout: JSON.stringify({
            ok: true,
            data: {
              investmentId: 326890603,
              contract: NPM,
              feeRate: "0.003",
              underlyingToken: [
                {
                  tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                  tokenSymbol: "USDC",
                  isBaseToken: false,
                },
                {
                  tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                  tokenSymbol: "ETH",
                  isBaseToken: true,
                },
              ],
            },
          }),
        }),
        readDefiPositionDetailImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "position-detail"],
          summary: "ok",
          stdout: JSON.stringify({ ok: true, data: { tokenId: "4942499" } }),
        }),
        readUniswapPositionImpl: async () => ({
          nonce: 0n,
          operator: "0x0000000000000000000000000000000000000000",
          token0: "0x4200000000000000000000000000000000000006",
          token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          fee: 3000,
          tickLower: -199560,
          tickUpper: -199200,
          liquidity: 3180904181569n,
          feeGrowthInside0LastX128: 0n,
          feeGrowthInside1LastX128: 0n,
          tokensOwed0: 0n,
          tokensOwed1: 0n,
        }),
        nowSecondsImpl: () => 1_775_962_100,
        runCmdImpl: async (command, args) => {
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: { txHash: "0xwithdraw" } }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash: "0xwithdraw", txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
      },
    });

    const out = await host.invokeMcp("phalanx_action", {
      action: "withdrawLpPosition",
      payload: {
        protocol: "uniswap-v3",
        investmentId: "326890603",
        chain: "base",
        address: "0x3333333333333333333333333333333333333333",
        platformId: "demo-platform",
        ratio: "1",
      },
      target: "uniswap-v3",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("expected withdraw execution");
    }
    expect(out.data.kind).toBe("executed");
    expect(out.data.adapterResult).toMatchObject({
      provider: "onchainos",
      lane: "defi_execute",
      status: "completed",
    });
  });

  it("restores READY lifecycle from config when live requirements and owner id are present", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      configValues: {
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
        TELEGRAM_ALLOWED_USER_ID: "99",
        OKX_API_KEY: "okx-key",
        OKX_API_SECRET: "okx-secret",
        OKX_API_PASSPHRASE: "okx-pass",
        OMRATE_API_KEY: "omrate-key",
        OMRATE_API_BASE_URL: "https://omrate.io/api",
        XLAYER_RPC_URL: "https://rpc.example",
        POLICY_OWNER_KEY: "0xabc",
        WHITELIST_POLICY_ADDRESS: "0x123",
        PHALANX_OWNER_EVM_ADDRESS: "0xowner",
        BASE_RPC_URL: "https://base.rpc",
        TEST_WALLET_ADDRESS: "0xwallet000000000000000000000000000000000001",
      },
    });

    expect(host.getStartupSummary().lifecycle).toBe("READY");
    expect(host.getSetupSession().ownerUserId).toBe("99");
  });

  it("phalanx_uniswap_liquidity_plan returns NOT_READY before lifecycle READY", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({ lifecycle: "SETUP_IN_PROGRESS" });
    const out = await host.invokeMcp("phalanx_uniswap_liquidity_plan", {
      chain: "base",
      tokenA: "USDC",
      tokenB: "ETH",
    });

    expect(out.ok).toBe(false);
    if (out.ok) {
      throw new Error("expected planner tool to be gated before READY");
    }
    expect(out.code).toBe("NOT_READY");
  });

  it("phalanx_uniswap_liquidity_plan stays outside execution whitelist because it is planning-only", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const isolatedPwd = mkdtempSync(join(tmpdir(), "phalanx-no-uniswap-skill-"));
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      configValues: { PWD: isolatedPwd },
    });

    const out = await host.invokeMcp("phalanx_uniswap_liquidity_plan", {
      chain: "base",
      tokenA: "USDC",
      tokenB: "ETH",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("expected planner MCP tool to succeed");
    }
    expect(out.data.kind).toBe("uniswap_liquidity_plan");
    expect(out.data.adapterResult).toMatchObject({
      provider: "uniswap",
      lane: "liquidity_planner_skill",
    });
    expect(["skipped", "completed"]).toContain(
      (out.data.adapterResult as { status?: string }).status,
    );
  });

  it("phalanx_uniswap_liquidity_plan returns official skills CLI + DexScreener evidence when hooks succeed", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { vi } = await import("vitest");

    const dir = mkdtempSync(join(tmpdir(), "phalanx-host-uniswap-"));
    const skillDir = join(dir, ".agents/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: liquidity-planner",
        "metadata:",
        " author: uniswap",
        " version: '0.2.0'",
        "---",
        "",
        "https://app.uniswap.org/positions/create",
        "",
      ].join("\n"),
      "utf8",
    );

    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ name: "liquidity-planner", path: skillDir, scope: "project" }]),
      stderr: "",
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            dexId: "uniswap",
            pairAddress: "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef",
            labels: ["v3"],
            baseToken: { symbol: "U" },
            quoteToken: { symbol: "E" },
            liquidity: { usd: 100 },
            volume: { h24: 50 },
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { createPhalanxHost } = await import("../src/app/host.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      configValues: { PHALANX_UNISWAP_SKILLS_PROJECT_ROOT: dir },
      uniswapPlannerHooks: {
        execFileImpl: execFile,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    });

    const out = await host.invokeMcp("phalanx_uniswap_liquidity_plan", {
      chain: "base",
      tokenA: "USDC",
      tokenB: "ETH",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) {
      throw new Error("expected planner MCP tool to succeed");
    }
    const ar = out.data.adapterResult as {
      officialInvocation?: { skillsCliListJson?: { matchedLiquidityPlanner?: boolean } };
      dataPlane?: { uniswapPools?: { pairAddress?: string }[] };
      runtimeDownstream?: {
        executionTarget?: string;
        executionAction?: string;
        payloadTemplate?: { protocol?: string; chain?: string; tokenSecondary?: string; range?: string };
      };
    };
    expect(ar.officialInvocation?.skillsCliListJson?.matchedLiquidityPlanner).toBe(true);
    expect(ar.dataPlane?.uniswapPools?.[0]?.pairAddress).toBe("0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef");
    expect(ar.runtimeDownstream?.executionTarget).toBe("uniswap-v3");
    expect(ar.runtimeDownstream?.executionAction).toBe("depositLpPosition");
    expect(ar.runtimeDownstream?.payloadTemplate?.protocol).toBe("uniswap-v3");
    expect(ar.runtimeDownstream?.payloadTemplate?.chain).toBe("base");
    expect(ar.runtimeDownstream?.payloadTemplate?.tokenSecondary).toBe("ETH");
    expect(ar.runtimeDownstream?.payloadTemplate?.range).toBe("");
  });

  it("uses a bound telegram notifier for whitelist-change approval delivery", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const delivered: string[] = [];
    const host = createPhalanxHost({ lifecycle: "READY", whitelistTargets: ["whitelist-admin"] });
    host.bindTelegramApprovalNotifier({
      sendApprovalRequest: async ({ summary }) => {
        delivered.push(summary);
        return { ok: true };
      },
    });

    const out = await host.invokeMcp("phalanx_action", {
      action: "requestWhitelistExpansion",
      payload: { target: "uniswap-v3" },
      target: "whitelist-admin",
    });

    expect(out.ok).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(host.getTelegramApprovalOutbox()).toHaveLength(0);
  });

  it("routes guardian rebalance intents through RuntimeCore and emits a Telegram execution report", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const reports: string[] = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      executor: {
        execute: async () => ({
          provider: "test",
          txRefs: ["0xrebalance"],
          summary: "guardian rebalance executed",
        }),
      },
    });
    host.bindTelegramReportNotifier({
      sendExecutionReport: async (event) => {
        reports.push(`${event.stage}:${event.action}:${event.txRefs?.join(",") ?? ""}`);
      },
    });

    const cycle = runGuardianCycle({
      now: 77,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        77,
      ),
    });

    const outcomes = await host.handleGuardianCycleResult(cycle);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.type).toBe("executed");
    expect(reports).toEqual([
      "guardian_detected:executeRebalance:",
      "executed:executeRebalance:0xrebalance",
    ]);
    expect(host.getRuntimeEvents().map((event) => event.stage)).toEqual([
      "guardian_detected",
      "intent_received",
      "executed",
    ]);
  });

  it("demo mode emits a guardian proposal before queuing LP whitelist approval", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const reports: string[] = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin", "pool"],
      configValues: {
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn(async () => ({
        status: "ok",
        omRate: {
          provider: "omrate",
          status: "completed",
          summary: "http_ok:200",
        },
        omRateExecutionEvidence: {
          payment: {
            mode: "x402_required",
            paymentRequired: true,
            baselineReady: true,
            paymentAttempted: true,
            paymentWrapped: true,
            paymentSettled: true,
            summary: "omrate paid",
          },
          milestones: { omrate_requested: true, x402_required: true, x402_payment_attempted: true, x402_payment_settled: true },
        },
        omRateCandidates: [
          {
            chain: "base",
            tokenA: "USDC",
            tokenB: "ETH",
            poolAddress: "0xpool000000000000000000000000000000000001",
            score: 10,
          },
        ],
        planner: {
          provider: "uniswap",
          lane: "liquidity_planner_skill",
          status: "completed",
          summary: "planner_ok",
          runtimeDownstream: {
            executionTarget: "uniswap-v3",
            executionAction: "depositLpPosition",
            positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
            topUniswapPools: [
              {
                pairAddress: "0xpool000000000000000000000000000000000001",
                pairLabel: "USDC/ETH",
                version: "v3",
                dexId: "uniswap",
              },
            ],
            plannerInput: {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              positionType: "v3",
            },
            payloadTemplate: {
              protocol: "uniswap-v3",
              chain: "base",
              investmentId: "planner-investment-id",
              token: "USDC",
              tokenSecondary: "ETH",
              amount: "1000000",
              amountSecondary: "500000000000000",
              range: "5",
              positionType: "v3",
              poolAddress: "0xpool000000000000000000000000000000000001",
            },
            missingExecutionFields: [],
          },
        },
        selectedPool: {
          pairAddress: "0xpool000000000000000000000000000000000001",
          pairLabel: "USDC/ETH",
          version: "v3",
          dexId: "uniswap",
        },
        swapPreparation: {
          kind: "swap_preparation",
          status: "assets_match",
          summary: "Wallet already aligned.",
        },
        lpDepositPayloadSeed: {
          protocol: "uniswap-v3",
          chain: "base",
          investmentId: "planner-investment-id",
          token: "USDC",
          tokenSecondary: "ETH",
          amount: "1000000",
          amountSecondary: "500000000000000",
          range: "5",
          poolAddress: "0xpool000000000000000000000000000000000001",
        },
        summaries: {
          omRate: "http_ok:200",
          planner: "planner_ok",
        },
      })),
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "whitelist_contract_write_confirmed",
        txHash: "0xpolicy",
      }),
      executor: {
        execute: async (intent) => {
          if (intent.action === "executeRebalance") {
            return {
              mode: "rebalance_executed",
              legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
              txRefs: [],
              summary: "rebalance demo legs",
            };
          }
          return {
            provider: "test",
            action: intent.action,
            txRefs: [`0x${intent.action}`],
            summary: `${intent.action} executed`,
          };
        },
      },
    });
    host.bindTelegramReportNotifier({
      sendExecutionReport: async (event) => {
        reports.push(`${event.stage}:${event.action}:${event.summary}`);
      },
    });

    const cycle = runGuardianCycle({
      now: 77,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        77,
      ),
    });

    const outcomes = await host.handleGuardianCycleResult(cycle);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.type).toBe("pending_approval");
    expect(reports[0]).toContain("guardian_detected:proposeRebalance");
    expect(reports[0]).toContain("USDC/ETH");
    expect(host.getTelegramApprovalOutbox()).toHaveLength(1);

    const latest = host.getLatestRebalanceDemoRunSummary();
    expect(latest?.kind).toBe("rebalance_demo_v1");
    expect(latest?.selectedPool?.pairLabel).toBe("USDC/ETH");
    expect(latest?.lpExecution.ready).toBe(true);
    expect(latest?.lpExecution.action).toBe("depositLpPosition");

    const detected = host.getRuntimeEvents(20).find((e) => e.stage === "guardian_detected");
    expect(detected?.demoRun?.swapPreparation.status).toBe("assets_match");
    expect(detected?.demoRun?.selectedPool?.pairAddress).toBe(
      "0xpool000000000000000000000000000000000001",
    );
    expect(detected?.demoRun?.omRateExecutionEvidence.payment?.paymentRequired).toBe(true);

    const awaiting = host.getRuntimeEvents(20).find((e) => e.stage === "awaiting_approval");
    expect(awaiting?.demoRun?.pendingApproval?.approvalId).toBe(host.getTelegramApprovalOutbox()[0]?.approvalId);
    expect(awaiting?.demoRun?.omRateExecutionEvidence.payment?.paymentSettled).toBe(true);
    expect(outcomes[0]?.intentId).toBe(awaiting?.intentId);
  });

  it("demo mode preserves swap execution metadata before LP approval gating", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "whitelist-admin"],
      configValues: {
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn(async () => ({
        status: "ok",
        omRate: {
          provider: "omrate",
          status: "completed",
          summary: "http_ok:200",
        },
        omRateExecutionEvidence: {
          payment: {
            mode: "x402_optional",
            paymentRequired: false,
            baselineReady: true,
            paymentAttempted: true,
            paymentWrapped: true,
            paymentSettled: true,
            summary: "omrate optional paid path",
          },
          milestones: { omrate_requested: true, x402_payment_attempted: true, x402_payment_settled: true },
        },
        omRateCandidates: [
          {
            chain: "base",
            tokenA: "USDC",
            tokenB: "ETH",
            poolAddress: "0xpool000000000000000000000000000000000001",
            score: 10,
          },
        ],
        planner: {
          provider: "uniswap",
          lane: "liquidity_planner_skill",
          status: "completed",
          summary: "planner_ok",
          runtimeDownstream: {
            executionTarget: "uniswap-v3",
            executionAction: "depositLpPosition",
            positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
            topUniswapPools: [
              {
                pairAddress: "0xpool000000000000000000000000000000000001",
                pairLabel: "USDC/ETH",
                version: "v3",
                dexId: "uniswap",
              },
            ],
            plannerInput: {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              positionType: "v3",
            },
            payloadTemplate: {
              protocol: "uniswap-v3",
              chain: "base",
              investmentId: "planner-investment-id",
              token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              tokenSecondary: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              amount: "1000000",
              amountSecondary: "500000000000000",
              range: "5",
              positionType: "v3",
              poolAddress: "0xpool000000000000000000000000000000000001",
            },
            missingExecutionFields: [],
          },
        },
        selectedPool: {
          pairAddress: "0xpool000000000000000000000000000000000001",
          pairLabel: "USDC/ETH",
          version: "v3",
          dexId: "uniswap",
        },
        swapPreparation: {
          kind: "swap_preparation",
          status: "swap_recommended",
          summary: "Wallet holdings are only partially aligned; recommend a preparatory swap before LP deposit.",
          recommendedSwapIntent: {
            action: "swap",
            payload: {
              chain: "base",
              wallet: "0x1111111111111111111111111111111111111111",
              fromTokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              toTokenAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              amount: "1000000",
              slippage: "0.5",
            },
          },
        },
        lpDepositPayloadSeed: {
          protocol: "uniswap-v3",
          chain: "base",
          investmentId: "planner-investment-id",
          token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenSecondary: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          amount: "1000000",
          amountSecondary: "500000000000000",
          range: "5",
          poolAddress: "0xpool000000000000000000000000000000000001",
        },
        summaries: {
          omRate: "http_ok:200",
          planner: "planner_ok",
        },
      })),
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "whitelist_contract_write_confirmed",
        txHash: "0xpolicy",
      }),
      executor: {
        execute: async (intent) => {
          if (intent.action === "executeRebalance") {
            return {
              mode: "rebalance_executed",
              legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
              txRefs: [],
              summary: "rebalance demo legs",
            };
          }
          return {
            provider: "test",
            action: intent.action,
            txRefs: [`0x${intent.action}`],
            summary: `${intent.action} executed`,
          };
        },
      },
    });

    const cycle = runGuardianCycle({
      now: 79,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        79,
      ),
    });

    const outcomes = await host.handleGuardianCycleResult(cycle);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.type).toBe("pending_approval");

    const events = host.getRuntimeEvents(40);
    const swapExecuted = events.find(
      (e) => e.stage === "executed" && e.action === "swap" && e.entrySource === "mcp",
    );
    expect(swapExecuted?.txRefs).toEqual(["0xswap"]);
    expect(swapExecuted?.demoRun?.swapPreparation.status).toBe("swap_recommended");
    expect(swapExecuted?.demoRun?.selectedPool?.pairLabel).toBe("USDC/ETH");
    expect(swapExecuted?.demoRun?.omRateExecutionEvidence.payment?.paymentWrapped).toBe(true);

    const awaiting = events.find((e) => e.stage === "awaiting_approval");
    expect(awaiting?.demoRun?.pendingApproval?.approvalId).toBe(host.getTelegramApprovalOutbox()[0]?.approvalId);
  });

  it("demo mode publishes a final guardian-style LP result after approval resume", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const reports: string[] = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin", "pool"],
      configValues: {
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn(async () => ({
        status: "ok",
        omRate: {
          provider: "omrate",
          status: "completed",
          summary: "http_ok:200",
        },
        omRateExecutionEvidence: {
          payment: {
            mode: "plain",
            paymentRequired: false,
            baselineReady: false,
            paymentAttempted: false,
            paymentWrapped: false,
            paymentSettled: false,
            summary: "plain omrate",
          },
          milestones: { omrate_requested: true },
        },
        omRateCandidates: [],
        planner: {
          provider: "uniswap",
          lane: "liquidity_planner_skill",
          status: "completed",
          summary: "planner_ok",
          runtimeDownstream: {
            executionTarget: "uniswap-v3",
            executionAction: "depositLpPosition",
            positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
            topUniswapPools: [],
            plannerInput: {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              positionType: "v3",
            },
            payloadTemplate: {
              protocol: "uniswap-v3",
              chain: "base",
              investmentId: "planner-investment-id",
              token: "USDC",
              tokenSecondary: "ETH",
              amount: "1000000",
              amountSecondary: "500000000000000",
              range: "5",
            },
            missingExecutionFields: [],
          },
        },
        selectedPool: {
          pairLabel: "USDC/ETH",
        },
        swapPreparation: {
          kind: "swap_preparation",
          status: "assets_match",
          summary: "Wallet already aligned.",
        },
        lpDepositPayloadSeed: {
          protocol: "uniswap-v3",
          chain: "base",
          investmentId: "planner-investment-id",
          token: "USDC",
          tokenSecondary: "ETH",
          amount: "1000000",
          amountSecondary: "500000000000000",
          range: "5",
        },
        summaries: {
          omRate: "http_ok:200",
          planner: "planner_ok",
        },
      })),
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "whitelist_contract_write_confirmed",
        txHash: "0xpolicy",
      }),
      executor: {
        execute: async (intent) => {
          if (intent.action === "executeRebalance") {
            return {
              mode: "rebalance_executed",
              legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
              txRefs: [],
              summary: "rebalance demo legs",
            };
          }
          return {
            provider: "test",
            action: intent.action,
            txRefs: [`0x${intent.action}`],
            summary: `${intent.action} executed`,
          };
        },
      },
    });
    host.bindTelegramReportNotifier({
      sendExecutionReport: async (event) => {
        reports.push(`${event.stage}:${event.action}:${event.txRefs?.join(",") ?? ""}`);
      },
    });

    const cycle = runGuardianCycle({
      now: 88,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        88,
      ),
    });

    await host.handleGuardianCycleResult(cycle);
    const callback = host.getTelegramApprovalOutbox()[0]?.approveCallbackData;
    expect(callback).toBeTruthy();

    const resumed = await host.handleTelegramCallback(callback!);

    expect(resumed.handled).toBe(true);
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    expect(reports).toContain("guardian_detected:proposeRebalance:");
    expect(reports).toContain("executed:depositLpPosition:0xpolicy,0xdepositLpPosition");
    expect(
      host
        .getRuntimeEvents(80)
        .filter((e) => e.stage === "executed" && e.action === "depositLpPosition" && e.entrySource === "guardian"),
    ).toHaveLength(0);

    // Governance resume completes in one RuntimeCore executed event (requestWhitelistExpansion), while
    // demoRun still describes the LP deposit the demo path intended.
    expect(
      host.getRuntimeEvents(60).some(
        (e) => e.stage === "executed" && e.entrySource === "mcp" && e.demoRun?.lpExecution.action === "depositLpPosition",
      ),
    ).toBe(true);
  });

  it("demo approval callback does not pre-populate completion milestones before a blocked resume", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const reports: { stage: string; demoRun?: { omRateExecutionEvidence?: { milestones?: Record<string, boolean> } } }[] = [];
    const riskContext = { now: 1 };
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin", "pool"],
      configValues: {
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
      riskContext,
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn(async () => ({
        status: "ok",
        omRate: { provider: "omrate", status: "completed", summary: "http_ok:200" },
        omRateExecutionEvidence: {
          payment: {
            mode: "plain",
            paymentRequired: false,
            baselineReady: false,
            paymentAttempted: false,
            paymentWrapped: false,
            paymentSettled: false,
            summary: "plain omrate",
          },
          milestones: { omrate_requested: true },
        },
        omRateCandidates: [],
        planner: {
          provider: "uniswap",
          lane: "liquidity_planner_skill",
          status: "completed",
          summary: "planner_ok",
          runtimeDownstream: {
            executionTarget: "uniswap-v3",
            executionAction: "depositLpPosition",
            positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
            topUniswapPools: [],
            plannerInput: {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              positionType: "v3",
            },
            payloadTemplate: {
              protocol: "uniswap-v3",
              chain: "base",
              investmentId: "planner-investment-id",
              token: "USDC",
              tokenSecondary: "ETH",
              amount: "1000000",
              amountSecondary: "500000000000000",
              range: "5",
            },
            missingExecutionFields: [],
          },
        },
        selectedPool: { pairLabel: "USDC/ETH" },
        swapPreparation: {
          kind: "swap_preparation",
          status: "assets_match",
          summary: "Wallet already aligned.",
        },
        lpDepositPayloadSeed: {
          protocol: "uniswap-v3",
          chain: "base",
          investmentId: "planner-investment-id",
          token: "USDC",
          tokenSecondary: "ETH",
          amount: "1000000",
          amountSecondary: "500000000000000",
          range: "5",
        },
        summaries: {
          omRate: "http_ok:200",
          planner: "planner_ok",
        },
      })),
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "whitelist_contract_write_confirmed",
        txHash: "0xpolicy",
      }),
      executor: {
        execute: async (intent) => {
          if (intent.action === "executeRebalance") {
            return {
              mode: "rebalance_executed",
              legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
              txRefs: [],
              summary: "rebalance demo legs",
            };
          }
          return {
            provider: "test",
            action: intent.action,
            txRefs: [`0x${intent.action}`],
            summary: `${intent.action} executed`,
          };
        },
      },
    });
    host.bindTelegramReportNotifier({
      sendExecutionReport: async (event) => {
        reports.push({ stage: event.stage, demoRun: event.demoRun });
      },
    });

    const cycle = runGuardianCycle({
      now: 91,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        91,
      ),
    });

    await host.handleGuardianCycleResult(cycle);
    const callback = host.getTelegramApprovalOutbox()[0]?.approveCallbackData;
    expect(callback).toBeTruthy();

    riskContext.now = 0;
    const resumed = await host.handleTelegramCallback(callback!);

    expect(resumed.runtimeOutcome?.type).toBe("blocked");
    const blockedReport = reports.find((entry) => entry.stage === "blocked");
    expect(blockedReport).toBeTruthy();
    expect(blockedReport?.demoRun?.omRateExecutionEvidence?.milestones?.approval_resumed).toBeUndefined();
    expect(blockedReport?.demoRun?.omRateExecutionEvidence?.milestones?.uniswap_executed).toBeUndefined();
    expect(blockedReport?.demoRun?.omRateExecutionEvidence?.milestones?.portfolio_push_ready).toBeUndefined();
    expect(
      host
        .getRuntimeEvents(80)
        .filter((e) => e.stage === "blocked" && e.action === "depositLpPosition" && e.entrySource === "guardian"),
    ).toHaveLength(0);
  });

  it("demo approval callback only marks tx_refs_captured when executed outcome actually has tx refs", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const reports: { stage: string; demoRun?: { omRateExecutionEvidence?: { milestones?: Record<string, boolean> } } }[] = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin", "pool"],
      configValues: {
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      },
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn(async () => ({
        status: "ok",
        omRate: { provider: "omrate", status: "completed", summary: "http_ok:200" },
        omRateExecutionEvidence: {
          payment: {
            mode: "plain",
            paymentRequired: false,
            baselineReady: false,
            paymentAttempted: false,
            paymentWrapped: false,
            paymentSettled: false,
            summary: "plain omrate",
          },
          milestones: { omrate_requested: true },
        },
        omRateCandidates: [],
        planner: {
          provider: "uniswap",
          lane: "liquidity_planner_skill",
          status: "completed",
          summary: "planner_ok",
          runtimeDownstream: {
            executionTarget: "uniswap-v3",
            executionAction: "depositLpPosition",
            positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
            topUniswapPools: [],
            plannerInput: {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              positionType: "v3",
            },
            payloadTemplate: {
              protocol: "uniswap-v3",
              chain: "base",
              investmentId: "planner-investment-id",
              token: "USDC",
              tokenSecondary: "ETH",
              amount: "1000000",
              amountSecondary: "500000000000000",
              range: "5",
            },
            missingExecutionFields: [],
          },
        },
        selectedPool: { pairLabel: "USDC/ETH" },
        swapPreparation: {
          kind: "swap_preparation",
          status: "assets_match",
          summary: "Wallet already aligned.",
        },
        lpDepositPayloadSeed: {
          protocol: "uniswap-v3",
          chain: "base",
          investmentId: "planner-investment-id",
          token: "USDC",
          tokenSecondary: "ETH",
          amount: "1000000",
          amountSecondary: "500000000000000",
          range: "5",
        },
        summaries: {
          omRate: "http_ok:200",
          planner: "planner_ok",
        },
      })),
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "whitelist_contract_write_confirmed",
        txHash: undefined,
      }),
      executor: {
        execute: async (intent) => {
          if (intent.action === "executeRebalance") {
            return {
              mode: "rebalance_executed",
              legs: [{ allocationSegment: "aave" }, { allocationSegment: "morpho" }],
              summary: "rebalance demo legs",
            };
          }
          return {
            provider: "test",
            action: intent.action,
            summary: `${intent.action} executed without tx refs`,
          };
        },
      },
    });
    host.bindTelegramReportNotifier({
      sendExecutionReport: async (event) => {
        reports.push({ stage: event.stage, demoRun: event.demoRun });
      },
    });

    const cycle = runGuardianCycle({
      now: 92,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        92,
      ),
    });

    await host.handleGuardianCycleResult(cycle);
    const callback = host.getTelegramApprovalOutbox()[0]?.approveCallbackData;
    expect(callback).toBeTruthy();
    const resumed = await host.handleTelegramCallback(callback!);

    expect(resumed.runtimeOutcome?.type).toBe("executed");
    const executedReport = reports.find((entry) => entry.stage === "executed");
    expect(executedReport?.demoRun?.omRateExecutionEvidence?.milestones?.approval_resumed).toBe(true);
    expect(executedReport?.demoRun?.omRateExecutionEvidence?.milestones?.uniswap_executed).toBe(true);
    expect(executedReport?.demoRun?.omRateExecutionEvidence?.milestones?.tx_refs_captured).toBeUndefined();
  });

  it("demo mode blocks when no wallet signal exists for funding readiness", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "whitelist-admin"],
      configValues: {},
      agenticRebalanceDemo: {
        enabled: true,
        omRatePath: "/rebalance/opportunities",
        chain: "base",
        tokenA: "USDC",
        tokenB: "ETH",
      },
      rebalanceDemoRunner: vi.fn(async () => ({
        status: "ok",
        omRate: { provider: "omrate", status: "completed", summary: "http_ok:200" },
        omRateExecutionEvidence: {
          payment: {
            mode: "plain",
            paymentRequired: false,
            baselineReady: false,
            paymentAttempted: false,
            paymentWrapped: false,
            paymentSettled: false,
            summary: "plain omrate",
          },
          milestones: { omrate_requested: true },
        },
        omRateCandidates: [],
        planner: {
          provider: "uniswap",
          lane: "liquidity_planner_skill",
          status: "completed",
          summary: "planner_ok",
          runtimeDownstream: {
            executionTarget: "uniswap-v3",
            executionAction: "depositLpPosition",
            positionCreateBaseUrl: "https://app.uniswap.org/positions/create",
            topUniswapPools: [],
            plannerInput: {
              chain: "base",
              tokenA: "USDC",
              tokenB: "ETH",
              positionType: "v3",
            },
            payloadTemplate: {
              protocol: "uniswap-v3",
              chain: "base",
              investmentId: "planner-investment-id",
              token: "USDC",
              tokenSecondary: "ETH",
              amount: "1000000",
              amountSecondary: "500000000000000",
              range: "5",
            },
            missingExecutionFields: [],
          },
        },
        selectedPool: { pairLabel: "USDC/ETH" },
        swapPreparation: {
          kind: "swap_preparation",
          status: "assets_match",
          summary: "Wallet already aligned.",
        },
        lpDepositPayloadSeed: {
          protocol: "uniswap-v3",
          chain: "base",
          investmentId: "planner-investment-id",
          token: "USDC",
          tokenSecondary: "ETH",
          amount: "1000000",
          amountSecondary: "500000000000000",
          range: "5",
        },
        summaries: {
          omRate: "http_ok:200",
          planner: "planner_ok",
        },
      })),
      executor: {
        execute: async () => ({ provider: "test", txRefs: ["0xnoop"], summary: "noop" }),
      },
    });

    const cycle = runGuardianCycle({
      now: 90,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        90,
      ),
    });

    const outcomes = await host.handleGuardianCycleResult(cycle);
    expect(outcomes[0]?.type).toBe("blocked");
    expect(host.getTelegramApprovalOutbox()).toHaveLength(0);
  });

  it("auto-routes non-whitelisted actions into governance approval then resumes execution", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const target = "0x1111111111111111111111111111111111111111";
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "whitelist_contract_write_confirmed",
        txHash: "0xgovern",
      }),
      executor: {
        execute: async (intent) => ({
          provider: "test",
          action: intent.action,
          txRefs: ["0xswap"],
          summary: `${intent.action} executed`,
        }),
      },
    });

    const first = await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: { amount: "1" },
      target,
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.data.kind !== "pending_approval") {
      throw new Error("expected pending approval");
    }

    const queued = host.getTelegramApprovalOutbox();
    expect(queued).toHaveLength(1);

    const resumed = await host.handleTelegramCallback(queued[0]!.approveCallbackData);
    expect(resumed.handled).toBe(true);
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    if (resumed.runtimeOutcome?.type !== "executed") {
      throw new Error("expected execution");
    }
    expect(resumed.runtimeOutcome.adapterResult).toMatchObject({
      mode: "whitelist_governance_completed",
      target,
      resumedAction: "swap",
      txRefs: ["0xgovern", "0xswap"],
    });

    const second = await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: { amount: "1" },
      target,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected second execution");
    }
    expect(second.data.kind).toBe("executed");
  });

  it("writes the contract address on governance approval but allowlists the symbolic policy item locally", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const contractAddress = "0x1111111111111111111111111111111111111111";
    const governanceWrites: string[] = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
      governanceWriteImpl: async (target) => {
        governanceWrites.push(target);
        return {
          status: "completed",
          summary: "whitelist_contract_write_confirmed",
          txHash: "0xpolicy",
        };
      },
      executor: {
        execute: async (intent) => ({
          provider: "test",
          action: intent.action,
          target: intent.target,
          txRefs: ["0xswap"],
          summary: `${intent.action} executed`,
        }),
      },
    });

    const first = await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: {
        amount: "1",
        contractAddress,
      },
      target: "pancakeswap-v3",
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.data.kind !== "pending_approval") {
      throw new Error("expected pending approval");
    }

    const queued = host.getTelegramApprovalOutbox();
    expect(queued).toHaveLength(1);

    const resumed = await host.handleTelegramCallback(queued[0]!.approveCallbackData);
    expect(resumed.handled).toBe(true);
    expect(governanceWrites).toEqual([contractAddress]);
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    if (resumed.runtimeOutcome?.type !== "executed") {
      throw new Error("expected execution");
    }
    expect(resumed.runtimeOutcome.adapterResult).toMatchObject({
      mode: "whitelist_governance_completed",
      target: "pancakeswap-v3",
      chainTarget: contractAddress,
      resumedAction: "swap",
    });

    const second = await host.invokeMcp("phalanx_action", {
      action: "swap",
      payload: {
        amount: "1",
        contractAddress,
      },
      target: "pancakeswap-v3",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected allowlisted execution");
    }
    expect(second.data.kind).toBe("executed");
    expect(host.getTelegramApprovalOutbox()).toHaveLength(0);
  });

  it("uses LP poolAddress for whitelist governance but keeps the symbolic target locally", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const poolAddress = "0x1111111111111111111111111111111111111111";
    const governanceWrites: string[] = [];

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
      governanceWriteImpl: async (target) => {
        governanceWrites.push(target);
        return {
          status: "completed",
          summary: "whitelist_contract_write_confirmed",
          txHash: "0xpolicy",
        };
      },
      executor: {
        execute: async (intent) => ({
          provider: "test",
          action: intent.action,
          target: intent.target,
          txRefs: ["0xlpdeposit"],
          summary: `${intent.action} executed`,
        }),
      },
    });

    const first = await host.invokeMcp("phalanx_action", {
      action: "depositLpPosition",
      target: "uniswap-v3",
      payload: {
        protocol: "uniswap-v3",
        investmentId: "uniswap-base-weth-usdc-v3",
        chain: "base",
        poolAddress,
        token: "USDC",
        amount: "1000000",
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.data.kind !== "pending_approval") {
      throw new Error("expected pending approval");
    }

    const queued = host.getTelegramApprovalOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.summary).toContain("Requested action: add liquidity (LP deposit)");
    expect(queued[0]?.summary).toContain("Blocked target: uniswap-v3");

    const resumed = await host.handleTelegramCallback(queued[0]!.approveCallbackData);
    expect(resumed.handled).toBe(true);
    expect(governanceWrites).toEqual([poolAddress]);
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    if (resumed.runtimeOutcome?.type !== "executed") {
      throw new Error("expected execution");
    }
    expect(resumed.runtimeOutcome.adapterResult).toMatchObject({
      mode: "whitelist_governance_completed",
      target: "uniswap-v3",
      chainTarget: poolAddress,
      resumedAction: "depositLpPosition",
      txRefs: ["0xpolicy", "0xlpdeposit"],
    });
  });

  it("falls back to local whitelist persistence when on-chain governance is not configured", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
      executor: {
        execute: async (intent) => ({
          provider: "test",
          action: intent.action,
          target: intent.target,
          txRefs: ["0xlpdeposit"],
          summary: `${intent.action} executed`,
        }),
      },
    });

    const first = await host.invokeMcp("phalanx_action", {
      action: "depositLpPosition",
      target: "uniswap-v3",
      payload: {
        protocol: "uniswap-v3",
        investmentId: "uniswap-base-weth-usdc-v3",
        chain: "base",
        poolAddress: "0x1111111111111111111111111111111111111111",
        token: "USDC",
        amount: "1000000",
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.data.kind !== "pending_approval") {
      throw new Error("expected pending approval");
    }

    const queued = host.getTelegramApprovalOutbox();
    expect(queued).toHaveLength(1);

    const resumed = await host.handleTelegramCallback(queued[0]!.approveCallbackData);
    expect(resumed.handled).toBe(true);
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    if (resumed.runtimeOutcome?.type !== "executed") {
      throw new Error("expected execution");
    }
    expect(resumed.runtimeOutcome.adapterResult).toMatchObject({
      mode: "whitelist_local_completed",
      target: "uniswap-v3",
      chainTarget: "0x1111111111111111111111111111111111111111",
      resumedAction: "depositLpPosition",
      txRefs: ["0xlpdeposit"],
    });

    const second = await host.invokeMcp("phalanx_action", {
      action: "depositLpPosition",
      target: "uniswap-v3",
      payload: {
        protocol: "uniswap-v3",
        investmentId: "uniswap-base-weth-usdc-v3",
        chain: "base",
        poolAddress: "0x1111111111111111111111111111111111111111",
        token: "USDC",
        amount: "1000000",
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected allowlisted execution");
    }
    expect(second.data.kind).toBe("executed");
  });

  it("routes withdrawToOwner through direct approval without whitelist governance", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const governanceWrites: string[] = [];
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
      governanceWriteImpl: async (target) => {
        governanceWrites.push(target);
        return {
          status: "completed",
          summary: "whitelist_contract_write_confirmed",
          txHash: "0xpolicy",
        };
      },
      executor: {
        execute: async (intent) => ({
          provider: "test",
          action: intent.action,
          txRefs: ["0xownerwithdraw"],
          summary: `${intent.action} executed`,
        }),
      },
    });

    const first = await host.invokeMcp("phalanx_action", {
      action: "withdrawToOwner",
      payload: {
        chain: "base",
        token: "USDC",
        amount: "1",
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.data.kind !== "pending_approval") {
      throw new Error("expected pending approval");
    }

    const queued = host.getTelegramApprovalOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.summary).toContain("Requested action: withdraw to owner");

    const resumed = await host.handleTelegramCallback(queued[0]!.approveCallbackData);
    expect(resumed.handled).toBe(true);
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    if (resumed.runtimeOutcome?.type !== "executed") {
      throw new Error("expected execution");
    }
    expect(governanceWrites).toEqual([]);
    expect(resumed.runtimeOutcome.adapterResult).toMatchObject({
      provider: "test",
      action: "withdrawToOwner",
      txRefs: ["0xownerwithdraw"],
    });
  });

  it("exposes bounded operator query accessors without duplicating event source of truth", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
      riskContext: { now: 123 },
      executor: {
        execute: async () => ({ provider: "test", summary: "ok" }),
      },
    });

    expect(host.getPendingApprovalCount()).toBe(0);
    expect(host.getRiskEvaluationContext().now).toBe(123);
    expect(host.getEffectiveWhitelistTargets()).toContain("pool");
    expect(host.getGuardianLastAssessment()).toBeUndefined();

    const cycle = runGuardianCycle({
      now: 123,
      driftThresholdBps: 500,
      portfolio: buildPortfolioSnapshot(
        [
          { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
          { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
        ],
        123,
      ),
    });
    await host.handleGuardianCycleResult(cycle);

    const assessment = host.getGuardianLastAssessment();
    expect(assessment).toBeTruthy();
    expect(assessment?.items).toHaveLength(1);
    expect(assessment?.items[0]?.intentAction).toBe("executeRebalance");
  });
});
