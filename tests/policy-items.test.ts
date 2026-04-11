import { describe, expect, it } from "vitest";

import {
  DEMO_POLICY_ITEM_IDS,
  FUTURE_POLICY_BUNDLE_SCHEMA_VERSION,
  mergePolicyItemTargets,
  seedFuturePolicyBundle,
} from "../src/policy/policy-items.ts";

describe("policy item registry", () => {
  it("exposes the fixed demo policy items used by governance and demo scripts", () => {
    expect(DEMO_POLICY_ITEM_IDS).toEqual([
      "aave-v3",
      "morpho-vaults",
      "uniswap-v3",
      "pancakeswap-v3",
      "whitelist-admin",
    ]);
  });

  it("merges required policy items without duplicating existing entries", () => {
    expect(
      mergePolicyItemTargets("uniswap-v3,whitelist-admin", ["uniswap-v3", "pancakeswap-v3", "whitelist-admin"]),
    ).toBe("pancakeswap-v3,uniswap-v3,whitelist-admin");
  });

  it("pins a schema version for the future bundle-policy upgrade path", () => {
    expect(FUTURE_POLICY_BUNDLE_SCHEMA_VERSION).toBe(1);
  });

  it("can seed a future bundle draft from a fixed policy item without changing governance plumbing", () => {
    expect(seedFuturePolicyBundle("pancakeswap-v3")).toEqual({
      schemaVersion: 1,
      bundleId: "bundle:pancakeswap-v3",
      displayName: "PancakeSwap V3",
      policyItemSeed: "pancakeswap-v3",
      chainScope: [],
      actionScope: ["swap", "depositLpPosition", "withdrawLpPosition"],
      assetScope: [],
      executionTargets: [],
      riskNotes: [],
    });
  });
});
