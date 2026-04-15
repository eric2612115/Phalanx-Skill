import { describe, expect, it } from "vitest";

import {
  normalizeAgenticWalletRegistry,
  resolveActiveAgenticWallet,
  type AgenticWalletRegistry,
} from "../src/config/agentic-wallet-registry";

describe("agentic wallet registry", () => {
  it("migrates legacy single-email and address fields into a registry", () => {
    const registry = normalizeAgenticWalletRegistry({
      OKX_AGENTIC_WALLET_LOGIN_EMAIL: "alpha@example.com",
      OKX_AGENTIC_WALLET_CURRENT_ADDRESS: "0x1111111111111111111111111111111111111111",
      OKX_AGENTIC_WALLET_ADDRESS_HISTORY:
        "0x1111111111111111111111111111111111111111,0x2222222222222222222222222222222222222222",
    });

    expect(registry.profiles).toHaveLength(1);
    expect(registry.profiles[0]?.email).toBe("alpha@example.com");
    expect(registry.profiles[0]?.wallets.map((wallet) => wallet.address)).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);
    expect(registry.activeProfileId).toBe(registry.profiles[0]?.profileId);
    expect(registry.activeWalletId).toBe(registry.profiles[0]?.wallets[0]?.walletId);
  });

  it("keeps multiple profiles and resolves the configured active wallet", () => {
    const raw: AgenticWalletRegistry = {
      activeProfileId: "profile-b",
      activeWalletId: "wallet-b2",
      profiles: [
        {
          profileId: "profile-a",
          email: "alpha@example.com",
          wallets: [{ walletId: "wallet-a1", address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
        },
        {
          profileId: "profile-b",
          email: "beta@example.com",
          wallets: [
            { walletId: "wallet-b1", address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
            { walletId: "wallet-b2", address: "0xcccccccccccccccccccccccccccccccccccccccc" },
          ],
        },
      ],
    };

    const registry = normalizeAgenticWalletRegistry({
      OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify(raw),
    });
    const active = resolveActiveAgenticWallet(registry);
    expect(active.profile?.email).toBe("beta@example.com");
    expect(active.wallet?.address).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
  });

  it("falls back to the first available wallet when active ids are missing or stale", () => {
    const registry = normalizeAgenticWalletRegistry({
      OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
        activeProfileId: "missing-profile",
        activeWalletId: "missing-wallet",
        profiles: [
          {
            profileId: "profile-a",
            email: "alpha@example.com",
            wallets: [
              { walletId: "wallet-a1", address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
              { walletId: "wallet-a2", address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
            ],
          },
        ],
      } satisfies AgenticWalletRegistry),
    });

    const active = resolveActiveAgenticWallet(registry);
    expect(active.profile?.profileId).toBe("profile-a");
    expect(active.wallet?.walletId).toBe("wallet-a1");
  });
});
