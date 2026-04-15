import { parseOnchainosDefiPositionsOverview } from "./portfolio.js";
import {
  readOnchainosDefiPositionDetail,
  readOnchainosDefiPositions,
  resolvePhalanxExecutionWalletAddress,
  type OnchainosDefiPositionDetailInput,
  type OnchainosDefiPositionsInput,
  type ResolvePhalanxExecutionWalletAddressInput,
} from "./onchainos.js";
import type { ExecuteLpPositionIntentHooks, LpExecutionPayload } from "./lp-execution.js";

const LP_PLATFORM_HINTS =
  /\b(uniswap|pancakeswap|pancake|aerodrome|curve|sushiswap|velodrome|balancer|kyber|trader\s*joe)\b/i;

type OperatorLpPositionDetail = {
  readonly poolAddress: string;
  readonly tokenId: string;
  readonly token0Symbol?: string;
  readonly token1Symbol?: string;
  readonly feeTier?: string;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly currentTick?: number;
  readonly liquidity: string;
  readonly inRange: boolean;
  readonly protocol?: string;
  readonly withdrawabilitySummary: string;
  readonly withdrawable?: boolean;
  /** Human-readable LP venue label when discovery succeeded (e.g. Uniswap V3). */
  readonly platformLabel?: string;
  readonly lastUpdatedAt?: string;
};

type OperatorLpPositionDetailResult =
  | {
      readonly provider: "onchainos";
      readonly mode: "operator_lp_position_detail";
      readonly chain: string;
      readonly address: string;
      readonly platformId: string;
      readonly protocol?: string;
      readonly lpPositionDetail: OperatorLpPositionDetail;
      readonly summary: string;
    }
  | {
      readonly provider: "onchainos";
      readonly mode: "operator_lp_position_detail_unavailable";
      readonly chain: string;
      readonly address?: string;
      readonly code: string;
      readonly summary: string;
    };

function stringField(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function walkValues(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkValues(item, visit);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  for (const child of Object.values(record)) {
    walkValues(child, visit);
  }
}

function collectStringCandidates(value: unknown, keys: readonly string[]): string[] {
  const out = new Set<string>();
  walkValues(value, (record) => {
    for (const key of keys) {
      const candidate = stringField(record[key]);
      if (candidate) {
        out.add(candidate);
      }
    }
  });
  return [...out];
}

function collectNumberCandidates(value: unknown, keys: readonly string[]): number[] {
  const out = new Set<number>();
  walkValues(value, (record) => {
    for (const key of keys) {
      const candidate = numberField(record[key]);
      if (candidate !== undefined) {
        out.add(candidate);
      }
    }
  });
  return [...out];
}

function collectBooleanCandidates(value: unknown, keys: readonly string[]): boolean[] {
  const out = new Set<boolean>();
  walkValues(value, (record) => {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "boolean") {
        out.add(candidate);
      }
    }
  });
  return [...out];
}

function pickSingleString(value: unknown, keys: readonly string[]): string | undefined {
  const values = collectStringCandidates(value, keys);
  return values.length === 1 ? values[0] : undefined;
}

function pickSingleNumber(value: unknown, keys: readonly string[]): number | undefined {
  const values = collectNumberCandidates(value, keys);
  return values.length === 1 ? values[0] : undefined;
}

function pickDerivedInRange(detailRoot: unknown, tickLower: number, tickUpper: number): boolean | undefined {
  const explicit = collectBooleanCandidates(detailRoot, ["inRange", "in_range"]);
  if (explicit.length === 1) {
    return explicit[0];
  }
  const currentTick = pickSingleNumber(detailRoot, ["currentTick", "tickCurrent", "current_tick"]);
  if (currentTick === undefined) {
    return undefined;
  }
  return currentTick >= tickLower && currentTick < tickUpper;
}

function pickSingleBoolean(value: unknown, keys: readonly string[]): boolean | undefined {
  const values = collectBooleanCandidates(value, keys);
  return values.length === 1 ? values[0] : undefined;
}

function inferLpProtocol(platformLabel: string | undefined, platformId: string): string | undefined {
  const label = (platformLabel ?? "").trim().toLowerCase();
  const id = platformId.trim().toLowerCase();
  const haystack = `${label} ${id}`;
  if (haystack.includes("uniswap")) return "uniswap-v3";
  if (haystack.includes("pancake")) return "pancakeswap-v3";
  if (haystack.includes("aerodrome")) return "aerodrome";
  if (haystack.includes("curve")) return "curve";
  if (haystack.includes("sushi")) return "sushiswap";
  if (haystack.includes("velodrome")) return "velodrome";
  return undefined;
}

function buildWithdrawabilitySummary(inRange: boolean): string {
  return inRange
    ? "Fees may be collectible now; principal still requires decreaseLiquidity."
    : "Out of range; principal still requires decreaseLiquidity, then collect tokens.";
}

async function resolveQueryWalletAddress(
  env: NodeJS.ProcessEnv,
  chain: string,
  hooks: ExecuteLpPositionIntentHooks,
): Promise<string | undefined> {
  const explicit =
    (env.PHALANX_WALLET_ADDRESS ?? "").trim() || (env.AGENT_WALLET_ADDRESS ?? "").trim() || undefined;
  if (explicit) {
    return explicit;
  }
  const managedResolver = hooks.resolveExecutionWalletAddressImpl;
  return resolvePhalanxExecutionWalletAddress(
    { env, chain } satisfies ResolvePhalanxExecutionWalletAddressInput,
    managedResolver
      ? {
          readManagedWalletAddress: async (input) => {
            const resolved = await managedResolver({ env: input.env, chain: input.chain });
            return resolved ?? null;
          },
        }
      : {},
  );
}

export async function readOperatorLpPositionDetail(
  payload: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
  hooks: ExecuteLpPositionIntentHooks = {},
): Promise<OperatorLpPositionDetailResult> {
  const lpPayload = payload as LpExecutionPayload;
  const chain = stringField(lpPayload.chain) ?? ((env.PHALANX_DEFAULT_CHAIN ?? "").trim() || "base");
  const address = stringField(lpPayload.address) ?? (await resolveQueryWalletAddress(env, chain, hooks));
  if (!address) {
    return {
      provider: "onchainos",
      mode: "operator_lp_position_detail_unavailable",
      chain,
      code: "EXECUTION_WALLET_UNRESOLVED",
      summary: "No execution wallet could be resolved for LP detail query.",
    };
  }

  const readPositions = hooks.readDefiPositionsImpl ?? readOnchainosDefiPositions;
  const positions = await readPositions({
    address,
    chains: [chain],
    chain,
    env,
  } satisfies OnchainosDefiPositionsInput);
  if (positions.status !== "completed" || !positions.stdout) {
    return {
      provider: "onchainos",
      mode: "operator_lp_position_detail_unavailable",
      chain,
      address,
      code: "LP_POSITION_DISCOVERY_FAILED",
      summary: positions.summary,
    };
  }

  const explicitPlatformId = stringField(lpPayload.platformId);
  const platforms = parseOnchainosDefiPositionsOverview(positions.stdout);
  const lpPlatforms = explicitPlatformId
    ? platforms.filter((platform) => platform.analysisPlatformId === explicitPlatformId)
    : platforms.filter((platform) => LP_PLATFORM_HINTS.test(platform.platformName));
  if (lpPlatforms.length === 0) {
    return {
      provider: "onchainos",
      mode: "operator_lp_position_detail_unavailable",
      chain,
      address,
      code: "LP_POSITION_DISCOVERY_EMPTY",
      summary: explicitPlatformId
        ? `No LP position matched platformId ${explicitPlatformId}.`
        : "No LP position platform was discoverable from Onchain OS positions output.",
    };
  }
  if (lpPlatforms.length > 1) {
    return {
      provider: "onchainos",
      mode: "operator_lp_position_detail_unavailable",
      chain,
      address,
      code: "LP_POSITION_DISCOVERY_AMBIGUOUS",
      summary: `Multiple LP platforms found (${lpPlatforms.map((platform) => platform.platformName).join(", ")}).`,
    };
  }

  const chosenPlatform = lpPlatforms[0]!;
  const platformId = chosenPlatform.analysisPlatformId;
  const readPositionDetail = hooks.readDefiPositionDetailImpl ?? readOnchainosDefiPositionDetail;
  const detail = await readPositionDetail({
    address,
    chain,
    platformId,
    env,
  } satisfies OnchainosDefiPositionDetailInput);
  if (detail.status !== "completed" || !detail.stdout) {
    return {
      provider: "onchainos",
      mode: "operator_lp_position_detail_unavailable",
      chain,
      address,
      code: "LP_POSITION_DETAIL_FAILED",
      summary: detail.summary,
    };
  }

  let detailRoot: unknown;
  try {
    detailRoot = JSON.parse(detail.stdout);
  } catch {
    return {
      provider: "onchainos",
      mode: "operator_lp_position_detail_unavailable",
      chain,
      address,
      code: "LP_POSITION_DETAIL_INVALID_JSON",
      summary: "Onchain OS position-detail output was not valid JSON.",
    };
  }

  const poolAddress = pickSingleString(detailRoot, ["poolAddress", "pairAddress", "pool"]);
  const tokenId = pickSingleString(detailRoot, ["tokenId", "nftTokenId"]);
  const token0Symbol = pickSingleString(detailRoot, ["token0Symbol", "token0", "tokenASymbol", "baseTokenSymbol"]);
  const token1Symbol = pickSingleString(detailRoot, ["token1Symbol", "token1", "tokenBSymbol", "quoteTokenSymbol"]);
  const feeTier = pickSingleString(detailRoot, ["feeTier", "fee", "poolFee"]);
  const tickLower = pickSingleNumber(detailRoot, ["tickLower", "tick_lower"]);
  const tickUpper = pickSingleNumber(detailRoot, ["tickUpper", "tick_upper"]);
  const currentTick = pickSingleNumber(detailRoot, ["currentTick", "tickCurrent", "current_tick"]);
  const liquidity = pickSingleString(detailRoot, ["liquidity", "positionLiquidity"]);
  const withdrawable =
    pickSingleBoolean(detailRoot, ["withdrawable", "canWithdraw", "canRemoveLiquidity", "removable"]) ?? true;
  const lastUpdatedAt = pickSingleString(detailRoot, ["lastUpdatedAt", "updatedAt", "updateTime", "asOf"]);
  const inRange =
    tickLower !== undefined && tickUpper !== undefined ? pickDerivedInRange(detailRoot, tickLower, tickUpper) : undefined;
  if (
    !poolAddress ||
    !tokenId ||
    tickLower === undefined ||
    tickUpper === undefined ||
    !liquidity ||
    inRange === undefined
  ) {
    return {
      provider: "onchainos",
      mode: "operator_lp_position_detail_unavailable",
      chain,
      address,
      code: "LP_POSITION_DETAIL_INCOMPLETE",
      summary:
        "Onchain OS position-detail output did not expose a single poolAddress/tokenId/tick range/liquidity/inRange tuple.",
    };
  }

  const platformLabelRaw = stringField(chosenPlatform.platformName);
  const protocol = stringField(lpPayload.protocol) ?? inferLpProtocol(platformLabelRaw, platformId);
  return {
    provider: "onchainos",
    mode: "operator_lp_position_detail",
    chain,
    address,
    platformId,
    ...(protocol ? { protocol } : {}),
    lpPositionDetail: {
      poolAddress,
      tokenId,
      ...(token0Symbol ? { token0Symbol } : {}),
      ...(token1Symbol ? { token1Symbol } : {}),
      ...(feeTier ? { feeTier } : {}),
      tickLower,
      tickUpper,
      ...(currentTick !== undefined ? { currentTick } : {}),
      liquidity,
      inRange,
      ...(protocol ? { protocol } : {}),
      withdrawabilitySummary: buildWithdrawabilitySummary(inRange),
      withdrawable,
      ...(platformLabelRaw ? { platformLabel: platformLabelRaw } : {}),
      ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
    },
    summary: `Resolved LP position detail for ${platformId}.`,
  };
}
