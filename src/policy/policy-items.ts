export const DEMO_POLICY_ITEM_IDS = [
  "aave-v3",
  "morpho-vaults",
  "uniswap-v3",
  "pancakeswap-v3",
  "whitelist-admin",
] as const;

export type DemoPolicyItemId = (typeof DEMO_POLICY_ITEM_IDS)[number];

export interface DemoPolicyItem {
  readonly id: DemoPolicyItemId;
  readonly label: string;
  readonly category: "lending" | "lp" | "governance";
  readonly executionActions: readonly string[];
  readonly summary: string;
}

export const DEMO_POLICY_ITEMS: Readonly<Record<DemoPolicyItemId, DemoPolicyItem>> = {
  "aave-v3": {
    id: "aave-v3",
    label: "Aave V3",
    category: "lending",
    executionActions: ["deposit", "withdraw", "executeRebalance"],
    summary: "Fixed demo policy item for Aave lending flows.",
  },
  "morpho-vaults": {
    id: "morpho-vaults",
    label: "Morpho Vaults",
    category: "lending",
    executionActions: ["deposit", "withdraw", "executeRebalance"],
    summary: "Fixed demo policy item for Morpho ERC-4626 vault flows.",
  },
  "uniswap-v3": {
    id: "uniswap-v3",
    label: "Uniswap V3",
    category: "lp",
    executionActions: ["planUniswapLiquidity", "swap", "depositLpPosition", "withdrawLpPosition"],
    summary: "Fixed demo policy item for allowlisted Uniswap V3 planning and execution.",
  },
  "pancakeswap-v3": {
    id: "pancakeswap-v3",
    label: "PancakeSwap V3",
    category: "lp",
    executionActions: ["swap", "depositLpPosition", "withdrawLpPosition"],
    summary: "Fixed demo policy item for non-allowlisted LP governance demo flows.",
  },
  "whitelist-admin": {
    id: "whitelist-admin",
    label: "Whitelist Admin",
    category: "governance",
    executionActions: ["requestWhitelistExpansion"],
    summary: "Fixed governance item that owns Telegram approval and whitelist changes.",
  },
};

export const FUTURE_POLICY_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface FuturePolicyBundleDraft {
  readonly schemaVersion: typeof FUTURE_POLICY_BUNDLE_SCHEMA_VERSION;
  readonly bundleId: string;
  readonly displayName: string;
  readonly policyItemSeed: DemoPolicyItemId;
  readonly chainScope: readonly string[];
  readonly actionScope: readonly string[];
  readonly assetScope: readonly string[];
  readonly executionTargets: readonly string[];
  readonly riskNotes: readonly string[];
}

export function mergePolicyItemTargets(raw: string | undefined, required: readonly string[]): string {
  const parsed = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set([...parsed, ...required])].sort((a, b) => a.localeCompare(b)).join(",");
}

export function seedFuturePolicyBundle(policyItemId: DemoPolicyItemId): FuturePolicyBundleDraft {
  const item = DEMO_POLICY_ITEMS[policyItemId];
  return {
    schemaVersion: FUTURE_POLICY_BUNDLE_SCHEMA_VERSION,
    bundleId: `bundle:${policyItemId}`,
    displayName: item.label,
    policyItemSeed: policyItemId,
    chainScope: [],
    actionScope: [...item.executionActions],
    assetScope: [],
    executionTargets: [],
    riskNotes: [],
  };
}
