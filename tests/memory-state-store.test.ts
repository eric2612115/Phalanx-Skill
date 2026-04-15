import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPortfolioSnapshot } from "../src/adapters/portfolio.js";
import { McpMemoryStateStore } from "../src/memory/mcp-memory-store.js";

describe("memory state store", () => {
  it("persists cycle state and restores the latest snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-memory-"));
    const store = new McpMemoryStateStore(join(dir, "memory.json"));

    await store.persistCycleState({
      updatedAt: "2026-04-15T00:00:00.000Z",
      source: "guardian_cycle",
      portfolioState: buildPortfolioSnapshot([{ kind: "lending", currentBps: 5_000, targetBps: 5_000 }], 1),
      activeProfileId: "profile-1",
      activeWalletId: "wallet-1",
      pendingJobs: [{ id: "j1", summary: "Deposit 8 USDC -> Aave Base", status: "queued" }],
    });

    const restored = await store.loadLatestState();
    expect(restored?.portfolioState?.buckets).toHaveLength(1);
    expect(restored?.activeProfileId).toBe("profile-1");
    expect(restored?.pendingJobs).toHaveLength(1);
  });

  it("keeps confirmed preferences separate and returns a minimal reasoning slice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-memory-"));
    const store = new McpMemoryStateStore(join(dir, "memory.json"));

    await store.persistCycleState({
      updatedAt: "2026-04-15T00:00:00.000Z",
      source: "guardian_cycle",
      activeProfileId: "profile-1",
      activeWalletId: "wallet-2",
      pendingJobs: [{ id: "j2", summary: "Mint LP position", status: "editing" }],
    });
    await store.persistConfirmedPreferencePatch({ riskTolerance: "balanced" });

    const context = await store.loadReasoningContext({ purpose: "guardian" });
    expect(context.activeProfileId).toBe("profile-1");
    expect(context.activeWalletId).toBe("wallet-2");
    expect(context.pendingJobs[0]?.id).toBe("j2");
    const restored = await store.loadLatestState();
    expect(restored?.userPreferences).toMatchObject({ riskTolerance: "balanced" });
  });
});
