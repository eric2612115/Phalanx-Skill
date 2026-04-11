import { describe, expect, it } from "vitest";
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
      },
    });

    const summary = host.getStartupSummary();
    expect(summary.mode).toBe("live");
    expect(summary.config.liveReady).toBe(true);
    expect(summary.config.masked.TELEGRAM_BOT_TOKEN).not.toContain("telegram-secret-token");
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
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool"],
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
        payloadTemplate?: { protocol?: string; chain?: string };
      };
    };
    expect(ar.officialInvocation?.skillsCliListJson?.matchedLiquidityPlanner).toBe(true);
    expect(ar.dataPlane?.uniswapPools?.[0]?.pairAddress).toBe("0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef");
    expect(ar.runtimeDownstream?.executionTarget).toBe("uniswap-v3");
    expect(ar.runtimeDownstream?.executionAction).toBe("depositLpPosition");
    expect(ar.runtimeDownstream?.payloadTemplate?.protocol).toBe("uniswap-v3");
    expect(ar.runtimeDownstream?.payloadTemplate?.chain).toBe("base");
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
    expect(reports).toEqual(["executed:executeRebalance:0xrebalance"]);
    expect(host.getRuntimeEvents().map((event) => event.stage)).toEqual([
      "guardian_detected",
      "intent_received",
      "executed",
    ]);
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

  it("routes a blocked Uniswap LP deposit through approval then resumes the LP execution lane", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["whitelist-admin"],
      governanceWriteImpl: async () => ({
        status: "completed",
        summary: "whitelist_contract_write_confirmed",
        txHash: "0xpolicy",
      }),
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
    expect(resumed.runtimeOutcome?.type).toBe("executed");
    if (resumed.runtimeOutcome?.type !== "executed") {
      throw new Error("expected execution");
    }
    expect(resumed.runtimeOutcome.adapterResult).toMatchObject({
      mode: "whitelist_governance_completed",
      target: "uniswap-v3",
      resumedAction: "depositLpPosition",
      txRefs: ["0xpolicy", "0xlpdeposit"],
    });
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
});
