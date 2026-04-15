import { describe, expect, it, vi, afterEach } from "vitest";

import { buildPortfolioSnapshot } from "../src/adapters/portfolio.ts";
import { planPancakeSwapLpRead } from "../src/adapters/pancakeswap.ts";
import { planUniswapLpRead } from "../src/adapters/uniswap.ts";
import { runGuardianCycle } from "../src/guardian/cycle.ts";
import {
  maybeStartGuardianFromEnv,
  resolveGuardianPortfolioInputs,
  startGuardianTicker,
} from "../src/guardian/service.ts";
import { McpMemoryStateStore } from "../src/memory/mcp-memory-store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("adapter contracts (portfolio / LP targets)", () => {
  it("buildPortfolioSnapshot keeps lending and LP buckets explicit", () => {
    const s = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 6_000, targetBps: 5_000 },
        { kind: "lp", currentBps: 4_000, targetBps: 5_000 },
      ],
      42,
    );
    expect(s.asOf).toBe(42);
    expect(s.buckets).toHaveLength(2);
    expect(s.buckets.map((b) => b.kind).sort()).toEqual(["lending", "lp"]);
  });

  it("planUniswapLpRead returns normalized plan; live status reflects env routing", () => {
    const p = planUniswapLpRead({ chain: "base" });
    expect(p.provider).toBe("uniswap");
    expect(["live_ready", "live_config_missing"]).toContain(p.status);
    expect(p.summary.length).toBeGreaterThan(0);
    expect(p.live).toHaveProperty("rpcEnvKey");
  });

  it("planPancakeSwapLpRead returns normalized plan; live status reflects env routing", () => {
    const p = planPancakeSwapLpRead({ chain: "bsc" });
    expect(p.provider).toBe("pancakeswap");
    expect(["live_ready", "live_config_missing"]).toContain(p.status);
    expect(p.summary.length).toBeGreaterThan(0);
    expect(p.live).toHaveProperty("rpcEnvKey");
  });
});

describe("runGuardianCycle", () => {
  it("emits AUTO_EXECUTE with executeRebalance when bucket drift exceeds threshold", () => {
    const portfolio = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
        { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
      ],
      100,
    );
    const r = runGuardianCycle({ now: 1, portfolio, driftThresholdBps: 500 });
    expect(r.items).toHaveLength(1);
    const [item] = r.items;
    expect(item.outcome).toBe("AUTO_EXECUTE");
    expect(item.intent?.action).toBe("executeRebalance");
    expect(item.intent?.entrySource).toBe("guardian");
    expect(item.intent?.lane).toBe("execution");
    expect(item.explanation.detected.toLowerCase()).toMatch(/drift|bucket/i);
  });

  it("classifies severe lending health as AUTO_EXECUTE_EMERGENCY with emergencyExit intent", () => {
    const portfolio = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 5_000, targetBps: 5_000 },
        { kind: "lp", currentBps: 5_000, targetBps: 5_000 },
      ],
      200,
      { lendingHealthScore: 0.15 },
    );
    const r = runGuardianCycle({ now: 2, portfolio, driftThresholdBps: 500 });
    expect(r.items).toHaveLength(1);
    const [item] = r.items;
    expect(item.outcome).toBe("AUTO_EXECUTE_EMERGENCY");
    expect(item.intent?.action).toBe("emergencyExit");
    expect(item.intent?.entrySource).toBe("guardian");
    expect(item.intent?.payload).toMatchObject({
      reason: "lending_health_critical",
    });
  });

  it("prioritizes emergency over drift in the same cycle", () => {
    const portfolio = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 9_000, targetBps: 5_000 },
        { kind: "lp", currentBps: 1_000, targetBps: 5_000 },
      ],
      300,
      { lendingHealthScore: 0.1 },
    );
    const r = runGuardianCycle({ now: 3, portfolio, driftThresholdBps: 500 });
    expect(r.items[0]?.outcome).toBe("AUTO_EXECUTE_EMERGENCY");
  });

  it("emits NOTIFY_ONLY when within drift threshold and no emergency signal", () => {
    const portfolio = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 5_100, targetBps: 5_000 },
        { kind: "lp", currentBps: 4_900, targetBps: 5_000 },
      ],
      400,
    );
    const r = runGuardianCycle({ now: 4, portfolio, driftThresholdBps: 500 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.outcome).toBe("NOTIFY_ONLY");
    expect(r.items[0]?.intent).toBeUndefined();
  });

  it("is deterministic for identical inputs", () => {
    const portfolio = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 7_000, targetBps: 5_000 },
        { kind: "lp", currentBps: 3_000, targetBps: 5_000 },
      ],
      500,
    );
    const a = runGuardianCycle({ now: 99, portfolio, driftThresholdBps: 500 });
    const b = runGuardianCycle({ now: 99, portfolio, driftThresholdBps: 500 });
    expect(a).toEqual(b);
  });
});

describe("guardian service", () => {
  it("prefers canonical explicit override over test wallet for guardian portfolio inputs", async () => {
    await expect(
      resolveGuardianPortfolioInputs({
        TEST_WALLET_ADDRESS: "0xtest",
        AGENT_WALLET_ADDRESS: "0xguardian",
        PHALANX_GUARDIAN_PORTFOLIO_CHAIN: "ethereum",
      } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      address: "0xguardian",
      chain: "ethereum",
    });
  });

  it("uses canonical managed-wallet resolution for guardian portfolio inputs", async () => {
    await expect(
      resolveGuardianPortfolioInputs(
        {
          PHALANX_RUNTIME_MODE: "live",
          PHALANX_GUARDIAN_PORTFOLIO_CHAIN: "base",
        } as NodeJS.ProcessEnv,
        {
          readManagedWalletAddress: async () => "0x1111111111111111111111111111111111111111",
        },
      ),
    ).resolves.toEqual({
      address: "0x1111111111111111111111111111111111111111",
      chain: "base",
    });
  });

  it("maybeStartGuardianFromEnv returns undefined when disabled", () => {
    const prev = process.env.PHALANX_GUARDIAN_ENABLED;
    delete process.env.PHALANX_GUARDIAN_ENABLED;
    expect(maybeStartGuardianFromEnv()).toBeUndefined();
    if (prev !== undefined) process.env.PHALANX_GUARDIAN_ENABLED = prev;
  });

  it("maybeStartGuardianFromEnv honors injected env values from config loading", () => {
    const stop = maybeStartGuardianFromEnv(undefined, {
      PHALANX_GUARDIAN_ENABLED: "1",
      PHALANX_GUARDIAN_INTERVAL_MS: "5000",
    });
    expect(typeof stop).toBe("function");
    stop?.();
  });

  it("maybeStartGuardianFromEnv uses the injected official portfolio loader instead of the stub snapshot", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const stop = maybeStartGuardianFromEnv(
      undefined,
      {
        PHALANX_GUARDIAN_ENABLED: "1",
        PHALANX_GUARDIAN_INTERVAL_MS: "5000",
      } as NodeJS.ProcessEnv,
      {
        loadPortfolioImpl: async () =>
          buildPortfolioSnapshot(
            [
              { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
              { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
            ],
            1,
          ),
        logImpl: (line) => {
          lines.push(line);
        },
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(lines.join("\n")).toMatch(/AUTO_EXECUTE/);
    stop?.();
  });

  it("startGuardianTicker invokes runGuardianCycle on interval", async () => {
    vi.useFakeTimers();
    const portfolio = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 5_000, targetBps: 5_000 },
        { kind: "lp", currentBps: 5_000, targetBps: 5_000 },
      ],
      1,
    );
    const results: string[] = [];
    const stop = startGuardianTicker(
      {
        intervalMs: 1_000,
        driftThresholdBps: 500,
        getPortfolio: async () => portfolio,
        now: () => 10,
      },
      (r) => {
        results.push(r.items[0]?.outcome ?? "");
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual(["NOTIFY_ONLY"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(results).toEqual(["NOTIFY_ONLY", "NOTIFY_ONLY"]);
    stop();
  });

  it("persists portfolio_state after a guardian cycle and restores it on restart", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "phalanx-guardian-memory-"));
    const store = new McpMemoryStateStore(join(dir, "memory.json"));
    const { createPhalanxHost } = await import("../src/app/host.ts");

    const portfolio = buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: 8_000, targetBps: 5_000 },
        { kind: "lp", currentBps: 2_000, targetBps: 5_000 },
      ],
      1,
    );
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

    const stop = maybeStartGuardianFromEnv(
      host,
      {
        PHALANX_GUARDIAN_ENABLED: "1",
        PHALANX_GUARDIAN_INTERVAL_MS: "5000",
      } as NodeJS.ProcessEnv,
      {
        stateStore: store,
        loadPortfolioImpl: async () => portfolio,
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    stop?.();

    const restored = await store.loadLatestState();
    expect(restored?.portfolioState?.buckets).toHaveLength(2);
    expect(restored?.pendingJobs).toHaveLength(1);

    const restarted = createPhalanxHost({
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
      initialMemoryState: restored,
    });
    expect(restarted.getTelegramJobQueue().jobs).toHaveLength(1);
  });
});
