import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
} from "viem";

import {
  executeOnchainosDefiExecution,
  executeOnchainosExecutionSteps,
  extractOnchainosDefiPositionIdentifiers,
  parseOnchainosDefiDetail,
  readOnchainosDefiDetail,
  readOnchainosDefiPositionDetail,
  readOnchainosDefiPositions,
  resolveLpNftTokenIdFromIdentifiers,
  resolvePhalanxExecutionWalletAddress,
  type ExecuteOnchainosDefiExecutionHooks,
  type OnchainosDefiDetail,
  type OnchainosDefiDetailInput,
  type OnchainosDefiDetailResult,
  type OnchainosDefiExecutionResult,
  type OnchainosDefiExecutionStep,
  type OnchainosDefiPositionDetailInput,
  type OnchainosDefiPositionDetailResult,
  type OnchainosDefiPositionsInput,
  type OnchainosDefiPositionsResult,
  type OnchainosExecutionCommandInput,
  type ResolvePhalanxExecutionWalletAddressInput,
} from "./onchainos.js";

export type SupportedLpProtocol = "uniswap-v3" | "pancakeswap-v3";

export type LpExecutionAction = "depositLpPosition" | "withdrawLpPosition";

export interface LpExecutionPayload {
  readonly protocol?: unknown;
  readonly investmentId?: unknown;
  readonly address?: unknown;
  readonly chain?: unknown;
  readonly token?: unknown;
  readonly tokenSecondary?: unknown;
  readonly amount?: unknown;
  readonly amountSecondary?: unknown;
  readonly tickLower?: unknown;
  readonly tickUpper?: unknown;
  readonly range?: unknown;
  readonly tokenId?: unknown;
  readonly platformId?: unknown;
  readonly ratio?: unknown;
  readonly slippage?: unknown;
  readonly poolAddress?: unknown;
}

type DirectUniswapPosition = {
  readonly nonce: bigint;
  readonly operator: Address;
  readonly token0: Address;
  readonly token1: Address;
  readonly fee: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  readonly feeGrowthInside0LastX128: bigint;
  readonly feeGrowthInside1LastX128: bigint;
  readonly tokensOwed0: bigint;
  readonly tokensOwed1: bigint;
};

type DirectUniswapExecutionMetadata = {
  readonly contract: Address;
  readonly fee: number;
  readonly currentTick?: number;
  readonly tickSpacing?: number;
  readonly tokens: [
    {
      readonly poolAddress: Address;
      readonly approvalAddress?: Address;
      readonly symbol: string;
      readonly native: boolean;
      readonly originalAddress: string;
    },
    {
      readonly poolAddress: Address;
      readonly approvalAddress?: Address;
      readonly symbol: string;
      readonly native: boolean;
      readonly originalAddress: string;
    },
  ];
};

export type ExecuteLpPositionIntentHooks = ExecuteOnchainosDefiExecutionHooks & {
  readonly readDefiDetailImpl?: (input: OnchainosDefiDetailInput) => Promise<OnchainosDefiDetailResult>;
  readonly readDefiPositionsImpl?: (input: OnchainosDefiPositionsInput) => Promise<OnchainosDefiPositionsResult>;
  readonly readDefiPositionDetailImpl?: (
    input: OnchainosDefiPositionDetailInput,
  ) => Promise<OnchainosDefiPositionDetailResult>;
  readonly readUniswapPoolMetadataImpl?: (input: {
    readonly chain: string;
    readonly poolAddress: string;
    readonly env: NodeJS.ProcessEnv;
  }) => Promise<DirectUniswapExecutionMetadata>;
  readonly readUniswapPositionImpl?: (input: {
    readonly chain: string;
    readonly contract: string;
    readonly tokenId: string;
    readonly env: NodeJS.ProcessEnv;
  }) => Promise<DirectUniswapPosition>;
  readonly nowSecondsImpl?: () => number;
  /** Test hook: replaces only Onchain OS managed lookup; env overrides still win. */
  readonly resolveExecutionWalletAddressImpl?: (input: {
    readonly env: NodeJS.ProcessEnv;
    readonly chain: string;
  }) => Promise<string | undefined>;
};

export type LpExecutionNormalization =
  | {
      readonly ok: true;
      readonly protocol: SupportedLpProtocol;
      readonly command: OnchainosExecutionCommandInput;
    }
  | {
      readonly ok: false;
      readonly code:
        | "UNSUPPORTED_LP_PROTOCOL"
        | "LP_INVESTMENT_ID_REQUIRED"
        | "LP_CHAIN_REQUIRED"
        | "LP_WALLET_UNRESOLVED"
        | "LP_TOKEN_REQUIRED"
        | "LP_AMOUNT_REQUIRED"
        | "LP_SECONDARY_TOKEN_REQUIRED"
        | "LP_RANGE_OR_TICKS_REQUIRED"
        | "LP_TOKEN_ID_OR_RATIO_REQUIRED";
      readonly message: string;
    };

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Sync path after async managed resolution: env override, else dry-run test wallet only. */
function syncFallbackExecutionWalletAddress(env: NodeJS.ProcessEnv): string | undefined {
  const override =
    (env.PHALANX_WALLET_ADDRESS ?? "").trim() || (env.AGENT_WALLET_ADDRESS ?? "").trim() || undefined;
  if (override) {
    return override;
  }
  const runtimeMode = (env.PHALANX_RUNTIME_MODE ?? "").trim().toLowerCase();
  if (runtimeMode === "live") {
    return undefined;
  }
  return (env.TEST_WALLET_ADDRESS ?? "").trim() || undefined;
}

function resolveProtocol(payload: LpExecutionPayload, target?: string): SupportedLpProtocol | undefined {
  const candidate = stringField(payload.protocol) ?? stringField(target);
  if (candidate === "uniswap-v3" || candidate === "pancakeswap-v3") {
    return candidate;
  }
  return undefined;
}

const NATIVE_TOKEN_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const MAX_UINT128 = (2n ** 128n) - 1n;
const DEFAULT_DEADLINE_SECONDS = 10 * 60;

const erc20Abi = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);
const erc20MetadataAbi = parseAbi(["function symbol() view returns (string)"]);
const nonfungiblePositionManagerAbi = parseAbi([
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "function refundETH() payable",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) returns (uint256 amount0,uint256 amount1)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256 amount0,uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
]);
const uniswapV3PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
]);
const DEFAULT_UNISWAP_V3_POSITION_MANAGERS: Readonly<Record<string, Address>> = {
  base: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
};

function isAddressLike(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isNativeTokenCandidate(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "eth" || normalized === "base" || normalized === NATIVE_TOKEN_PLACEHOLDER;
}

function normalizeTokenKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeWrappedNativeAddress(chain: string): Address | undefined {
  switch (chain.trim().toLowerCase()) {
    case "base":
      return "0x4200000000000000000000000000000000000006";
    default:
      return undefined;
  }
}

function nativeAssetSymbol(chain: string): string {
  switch (chain.trim().toLowerCase()) {
    case "base":
      return "ETH";
    default:
      return "NATIVE";
  }
}

function resolveUniswapV3PositionManager(chain: string, env: NodeJS.ProcessEnv): Address | undefined {
  const override = stringField(env.PHALANX_UNISWAP_V3_POSITION_MANAGER);
  if (override && isAddressLike(override)) {
    return override as Address;
  }
  return DEFAULT_UNISWAP_V3_POSITION_MANAGERS[chain.trim().toLowerCase()];
}

function feeRateToUniswapFee(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return undefined;
  }
  if (!trimmed.includes(".")) {
    return Number(trimmed);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = (fraction + "000000").slice(0, 6);
  return Number(`${whole}${padded}`);
}

function parseSignedInt(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+$/.test(value.trim())) {
    return undefined;
  }
  return Number(value);
}

function parseRangePercent(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().replace(/%$/, "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function alignTickDown(value: number, tickSpacing: number): number {
  return Math.floor(value / tickSpacing) * tickSpacing;
}

function alignTickUp(value: number, tickSpacing: number): number {
  return Math.ceil(value / tickSpacing) * tickSpacing;
}

export function deriveTickBoundsFromRange(input: {
  readonly currentTick: number;
  readonly tickSpacing: number;
  readonly range: string;
}): { tickLower: number; tickUpper: number } | undefined {
  const rangePercent = parseRangePercent(input.range);
  if (rangePercent === undefined || !Number.isFinite(input.currentTick) || input.tickSpacing <= 0) {
    return undefined;
  }
  const rawDelta = Math.ceil(Math.log(1 + rangePercent / 100) / Math.log(1.0001));
  const delta = Math.max(input.tickSpacing, rawDelta);
  const tickLower = alignTickDown(input.currentTick - delta, input.tickSpacing);
  let tickUpper = alignTickUp(input.currentTick + delta, input.tickSpacing);
  if (tickUpper <= tickLower) {
    tickUpper = tickLower + input.tickSpacing;
  }
  return { tickLower, tickUpper };
}

function parseRatio(value: string | undefined): { numerator: bigint; denominator: bigint } | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return undefined;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction);
  if (numerator <= 0n || numerator > denominator) {
    return undefined;
  }
  return { numerator, denominator };
}

function matchTokenInput(
  detailToken: { readonly tokenAddress: string; readonly tokenSymbol: string; readonly isBaseToken: boolean },
  request: { readonly token?: string; readonly amount?: string; readonly tokenSecondary?: string; readonly amountSecondary?: string },
): { amount: bigint; isNative: boolean } | null {
  const inputs = [
    { token: request.token, amount: request.amount },
    { token: request.tokenSecondary, amount: request.amountSecondary },
  ];
  for (const input of inputs) {
    if (!input.token || !input.amount) {
      continue;
    }
    const sameSymbol = normalizeTokenKey(detailToken.tokenSymbol) === normalizeTokenKey(input.token);
    const sameAddress =
      isAddressLike(input.token) && normalizeTokenKey(detailToken.tokenAddress) === normalizeTokenKey(input.token);
    const nativeMatch = detailToken.isBaseToken && isNativeTokenCandidate(input.token);
    if (!sameSymbol && !sameAddress && !nativeMatch) {
      continue;
    }
    return {
      amount: BigInt(input.amount),
      isNative: detailToken.isBaseToken,
    };
  }
  return null;
}

function normalizeUniswapDetail(detail: OnchainosDefiDetail, chain: string): DirectUniswapExecutionMetadata | null {
  const contract = stringField(detail.contract);
  const fee = feeRateToUniswapFee(detail.feeRate);
  if (!contract || !isAddressLike(contract) || fee === undefined || detail.underlyingToken.length !== 2) {
    return null;
  }
  const wrappedNative = normalizeWrappedNativeAddress(chain);
  const [raw0, raw1] = detail.underlyingToken;
  if (!raw0 || !raw1) {
    return null;
  }
  const token0Address =
    raw0.isBaseToken && wrappedNative ? wrappedNative : (raw0.tokenAddress as Address | undefined);
  const token1Address =
    raw1.isBaseToken && wrappedNative ? wrappedNative : (raw1.tokenAddress as Address | undefined);
  if (!token0Address || !token1Address || !isAddressLike(token0Address) || !isAddressLike(token1Address)) {
    return null;
  }
  const sorted = [
    {
      poolAddress: token0Address as Address,
      approvalAddress: raw0.isBaseToken ? undefined : (raw0.tokenAddress as Address),
      symbol: raw0.tokenSymbol,
      native: raw0.isBaseToken,
      originalAddress: raw0.tokenAddress,
    },
    {
      poolAddress: token1Address as Address,
      approvalAddress: raw1.isBaseToken ? undefined : (raw1.tokenAddress as Address),
      symbol: raw1.tokenSymbol,
      native: raw1.isBaseToken,
      originalAddress: raw1.tokenAddress,
    },
  ].sort((left, right) => left.poolAddress.toLowerCase().localeCompare(right.poolAddress.toLowerCase())) as [
    {
      readonly poolAddress: Address;
      readonly approvalAddress?: Address;
      readonly symbol: string;
      readonly native: boolean;
      readonly originalAddress: string;
    },
    {
      readonly poolAddress: Address;
      readonly approvalAddress?: Address;
      readonly symbol: string;
      readonly native: boolean;
      readonly originalAddress: string;
    },
  ];
  return {
    contract: contract as Address,
    fee,
    tokens: sorted,
  };
}

async function readDirectUniswapPoolMetadata(input: {
  readonly chain: string;
  readonly poolAddress: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<DirectUniswapExecutionMetadata> {
  const rpcUrl = (input.env.BASE_RPC_URL ?? "").trim();
  const chain = input.chain.trim().toLowerCase();
  if (chain !== "base" || !rpcUrl) {
    throw new Error("Direct Uniswap V3 execution currently requires BASE_RPC_URL and chain=base.");
  }
  if (!isAddressLike(input.poolAddress)) {
    throw new Error("Direct Uniswap V3 execution requires a valid poolAddress.");
  }
  const contract = resolveUniswapV3PositionManager(input.chain, input.env);
  if (!contract) {
    throw new Error(
      "Direct Uniswap V3 execution requires PHALANX_UNISWAP_V3_POSITION_MANAGER or a built-in manager for the selected chain.",
    );
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const [token0, token1, fee, tickSpacing, slot0] = await Promise.all([
    client.readContract({
      address: input.poolAddress as Address,
      abi: uniswapV3PoolAbi,
      functionName: "token0",
      args: [],
    }),
    client.readContract({
      address: input.poolAddress as Address,
      abi: uniswapV3PoolAbi,
      functionName: "token1",
      args: [],
    }),
    client.readContract({
      address: input.poolAddress as Address,
      abi: uniswapV3PoolAbi,
      functionName: "fee",
      args: [],
    }),
    client.readContract({
      address: input.poolAddress as Address,
      abi: uniswapV3PoolAbi,
      functionName: "tickSpacing",
      args: [],
    }),
    client.readContract({
      address: input.poolAddress as Address,
      abi: uniswapV3PoolAbi,
      functionName: "slot0",
      args: [],
    }),
  ]);
  const wrappedNative = normalizeWrappedNativeAddress(input.chain);
  const nativeSymbol = nativeAssetSymbol(input.chain);
  const tokenEntries = await Promise.all(
    [token0, token1].map(async (tokenAddress) => {
      const isNative = wrappedNative !== undefined && tokenAddress.toLowerCase() === wrappedNative.toLowerCase();
      const symbol = isNative
        ? nativeSymbol
        : await client.readContract({
            address: tokenAddress,
            abi: erc20MetadataAbi,
            functionName: "symbol",
            args: [],
          });
      return {
        poolAddress: tokenAddress,
        approvalAddress: isNative ? undefined : tokenAddress,
        symbol,
        native: isNative,
        originalAddress: tokenAddress,
      };
    }),
  );
  const sorted = [...tokenEntries].sort((left, right) =>
    left.poolAddress.toLowerCase().localeCompare(right.poolAddress.toLowerCase()),
  ) as DirectUniswapExecutionMetadata["tokens"];
  return {
    contract,
    fee: Number(fee),
    currentTick: Number(slot0[1]),
    tickSpacing: Number(tickSpacing),
    tokens: sorted,
  };
}

function directExecutionArgv(contract: Address): string[] {
  return ["onchainos", "wallet", "contract-call", "--to", contract];
}

async function readDirectUniswapPosition(input: {
  readonly chain: string;
  readonly contract: string;
  readonly tokenId: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<DirectUniswapPosition> {
  const rpcUrl = (input.env.BASE_RPC_URL ?? "").trim();
  if (input.chain.trim().toLowerCase() !== "base" || !rpcUrl) {
    throw new Error("Direct Uniswap V3 execution currently requires BASE_RPC_URL and chain=base.");
  }
  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const position = await client.readContract({
    address: input.contract as Address,
    abi: nonfungiblePositionManagerAbi,
    functionName: "positions",
    args: [BigInt(input.tokenId)],
  });
  const [
    nonce,
    operator,
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    liquidity,
    feeGrowthInside0LastX128,
    feeGrowthInside1LastX128,
    tokensOwed0,
    tokensOwed1,
  ] = position;
  return {
    nonce,
    operator,
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    liquidity,
    feeGrowthInside0LastX128,
    feeGrowthInside1LastX128,
    tokensOwed0,
    tokensOwed1,
  };
}

async function discoverDirectUniswapWithdrawTokenId(input: {
  readonly address: string;
  readonly chain: string;
  readonly platformId?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly hooks: ExecuteLpPositionIntentHooks;
}): Promise<{ ok: true; tokenId: string } | { ok: false; code: string; summary: string }> {
  const readPositions = input.hooks.readDefiPositionsImpl ?? readOnchainosDefiPositions;
  const readDetail = input.hooks.readDefiPositionDetailImpl ?? readOnchainosDefiPositionDetail;
  if (input.platformId) {
    const detail = await readDetail({
      address: input.address,
      chain: input.chain,
      platformId: input.platformId,
      env: input.env,
    });
    if (detail.status !== "completed") {
      return {
        ok: false,
        code: "LP_TOKEN_ID_DISCOVERY_EMPTY",
        summary:
          detail.summary ||
          "Onchain OS defi position-detail did not complete; cannot discover tokenId for withdraw.",
      };
    }
    const picked = resolveLpNftTokenIdFromIdentifiers(extractOnchainosDefiPositionIdentifiers(detail.stdout ?? ""));
    if (!picked.ok) {
      return { ok: false, code: picked.code, summary: picked.summary };
    }
    return { ok: true, tokenId: picked.tokenId };
  }
  const positions = await readPositions({
    address: input.address,
    chains: [input.chain],
    chain: input.chain,
    env: input.env,
  });
  if (positions.status !== "completed") {
    return {
      ok: false,
      code: "LP_TOKEN_ID_DISCOVERY_EMPTY",
      summary:
        positions.summary || "Onchain OS defi positions did not complete; cannot discover tokenId for withdraw.",
    };
  }
  const picked = resolveLpNftTokenIdFromIdentifiers(
    extractOnchainosDefiPositionIdentifiers(positions.stdout ?? ""),
  );
  if (!picked.ok) {
    return { ok: false, code: picked.code, summary: picked.summary };
  }
  return { ok: true, tokenId: picked.tokenId };
}

async function executeDirectUniswapV3Intent(
  action: LpExecutionAction,
  payload: LpExecutionPayload,
  env: NodeJS.ProcessEnv,
  hooks: ExecuteLpPositionIntentHooks,
): Promise<OnchainosDefiExecutionResult | { mode: "lp_execution_invalid"; code: string; summary: string }> {
  const investmentId = stringField(payload.investmentId);
  const poolAddress = stringField(payload.poolAddress);
  const chain = stringField(payload.chain);
  const address = stringField(payload.address) ?? syncFallbackExecutionWalletAddress(env) ?? "";
  if (!chain || !address) {
    return {
      mode: "lp_execution_invalid",
      code: "LP_CHAIN_REQUIRED",
      summary: "Direct Uniswap V3 execution requires chain and wallet address.",
    };
  }
  let normalizedDetail: DirectUniswapExecutionMetadata | null = null;
  if (poolAddress && isAddressLike(poolAddress)) {
    const readPoolMetadata = hooks.readUniswapPoolMetadataImpl ?? readDirectUniswapPoolMetadata;
    try {
      normalizedDetail = await readPoolMetadata({
        chain,
        poolAddress,
        env,
      });
    } catch (error) {
      return {
        mode: "lp_execution_invalid",
        code: "LP_CHAIN_REQUIRED",
        summary: error instanceof Error ? error.message : "Could not read Uniswap V3 pool metadata.",
      };
    }
  } else if (investmentId) {
    const readDefiDetail = hooks.readDefiDetailImpl ?? readOnchainosDefiDetail;
    const detailResult = await readDefiDetail({
      investmentId,
      chain,
      env,
    });
    if (detailResult.status !== "completed") {
      return {
        provider: "onchainos",
        lane: "defi_execute",
        status: detailResult.status,
        argv: detailResult.argv,
        summary: detailResult.summary,
        stdout: detailResult.stdout,
        stderr: detailResult.stderr,
        exitCode: detailResult.exitCode,
      };
    }
    const detail = parseOnchainosDefiDetail(detailResult.stdout ?? "");
    if (!detail) {
      return {
        mode: "lp_execution_invalid",
        code: "LP_CHAIN_REQUIRED",
        summary: "Could not parse onchainos defi detail output for direct Uniswap V3 execution.",
      };
    }
    normalizedDetail = normalizeUniswapDetail(detail, chain);
  } else {
    return {
      mode: "lp_execution_invalid",
      code: "LP_INVESTMENT_ID_REQUIRED",
      summary: "Direct Uniswap V3 execution requires payload.poolAddress or payload.investmentId.",
    };
  }
  if (!normalizedDetail) {
    return {
      mode: "lp_execution_invalid",
      code: "UNSUPPORTED_LP_PROTOCOL",
      summary: "Direct Uniswap V3 execution requires pool metadata with contract, fee, and two underlying tokens.",
    };
  }

  if (action === "depositLpPosition") {
    const token = stringField(payload.token);
    const amount = stringField(payload.amount);
    const tokenSecondary = stringField(payload.tokenSecondary);
    const amountSecondary = stringField(payload.amountSecondary);
    const range = stringField(payload.range);
    let tickLower = parseSignedInt(stringField(payload.tickLower));
    let tickUpper = parseSignedInt(stringField(payload.tickUpper));
    if ((tickLower === undefined || tickUpper === undefined) && range) {
      const derived = deriveTickBoundsFromRange({
        currentTick: normalizedDetail.currentTick ?? Number.NaN,
        tickSpacing: normalizedDetail.tickSpacing ?? 0,
        range,
      });
      if (tickLower === undefined) {
        tickLower = derived?.tickLower;
      }
      if (tickUpper === undefined) {
        tickUpper = derived?.tickUpper;
      }
    }
    if (!token || !amount || !tokenSecondary || !amountSecondary) {
      return {
        mode: "lp_execution_invalid",
        code: "LP_SECONDARY_TOKEN_REQUIRED",
        summary: "Direct Uniswap V3 deposit requires token, amount, tokenSecondary, and amountSecondary.",
      };
    }
    if (tickLower === undefined || tickUpper === undefined) {
      return {
        mode: "lp_execution_invalid",
        code: "LP_RANGE_OR_TICKS_REQUIRED",
        summary: "Direct Uniswap V3 deposit requires explicit tickLower and tickUpper.",
      };
    }

    const token0Match = matchTokenInput(
      {
        tokenAddress: normalizedDetail.tokens[0].originalAddress,
        tokenSymbol: normalizedDetail.tokens[0].symbol,
        isBaseToken: normalizedDetail.tokens[0].native,
      },
      {
        token,
        amount,
        tokenSecondary,
        amountSecondary,
      },
    );
    const token1Match = matchTokenInput(
      {
        tokenAddress: normalizedDetail.tokens[1].originalAddress,
        tokenSymbol: normalizedDetail.tokens[1].symbol,
        isBaseToken: normalizedDetail.tokens[1].native,
      },
      {
        token,
        amount,
        tokenSecondary,
        amountSecondary,
      },
    );
    if (!token0Match || !token1Match) {
      return {
        mode: "lp_execution_invalid",
        code: "LP_TOKEN_REQUIRED",
        summary: "Direct Uniswap V3 deposit could not align payload tokens with pool underlying tokens.",
      };
    }

    const deadline = BigInt((hooks.nowSecondsImpl?.() ?? Math.floor(Date.now() / 1000)) + DEFAULT_DEADLINE_SECONDS);
    const steps: OnchainosDefiExecutionStep[] = [];
    const nativeValue =
      (token0Match.isNative ? token0Match.amount : 0n) + (token1Match.isNative ? token1Match.amount : 0n);

    if (!token0Match.isNative && normalizedDetail.tokens[0].approvalAddress) {
      steps.push({
        callDataType: "APPROVE",
        from: address,
        to: normalizedDetail.tokens[0].approvalAddress,
        serializedData: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [normalizedDetail.contract, token0Match.amount],
        }),
        value: "0x0",
      });
    }
    if (!token1Match.isNative && normalizedDetail.tokens[1].approvalAddress) {
      steps.push({
        callDataType: "APPROVE",
        from: address,
        to: normalizedDetail.tokens[1].approvalAddress,
        serializedData: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [normalizedDetail.contract, token1Match.amount],
        }),
        value: "0x0",
      });
    }

    const mintCall = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0: normalizedDetail.tokens[0].poolAddress,
          token1: normalizedDetail.tokens[1].poolAddress,
          fee: normalizedDetail.fee,
          tickLower,
          tickUpper,
          amount0Desired: token0Match.amount,
          amount1Desired: token1Match.amount,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: address as Address,
          deadline,
        },
      ],
    });
    const multicallPayload = [mintCall];
    if (nativeValue > 0n) {
      multicallPayload.push(
        encodeFunctionData({
          abi: nonfungiblePositionManagerAbi,
          functionName: "refundETH",
          args: [],
        }),
      );
    }
    steps.push({
      callDataType: "DEPOSIT",
      from: address,
      to: normalizedDetail.contract,
      serializedData: encodeFunctionData({
        abi: nonfungiblePositionManagerAbi,
        functionName: "multicall",
        args: [multicallPayload],
      }),
      value: `0x${nativeValue.toString(16)}`,
    });

    return executeOnchainosExecutionSteps(
      {
        chain,
        argv: directExecutionArgv(normalizedDetail.contract),
        steps,
      },
      env,
      hooks,
    );
  }

  let tokenId = stringField(payload.tokenId);
  const ratio = parseRatio(stringField(payload.ratio) ?? "1");
  if (!ratio) {
    return {
      mode: "lp_execution_invalid",
      code: "LP_TOKEN_ID_OR_RATIO_REQUIRED",
      summary: "Direct Uniswap V3 withdraw requires a ratio between 0 and 1 (defaults to 1 when omitted).",
    };
  }
  if (!tokenId) {
    const platformId = stringField(payload.platformId);
    const discovery = await discoverDirectUniswapWithdrawTokenId({
      address,
      chain,
      platformId,
      env,
      hooks,
    });
    if (!discovery.ok) {
      return {
        mode: "lp_execution_invalid",
        code: discovery.code,
        summary: discovery.summary,
      };
    }
    tokenId = discovery.tokenId;
  }
  const readPosition = hooks.readUniswapPositionImpl ?? readDirectUniswapPosition;
  let position: DirectUniswapPosition;
  try {
    position = await readPosition({
      chain,
      contract: normalizedDetail.contract,
      tokenId,
      env,
    });
  } catch (error) {
    return {
      mode: "lp_execution_invalid",
      code: "LP_CHAIN_REQUIRED",
      summary: error instanceof Error ? error.message : "Could not read Uniswap V3 position liquidity.",
    };
  }
  if (
    position.token0.toLowerCase() !== normalizedDetail.tokens[0].poolAddress.toLowerCase() ||
    position.token1.toLowerCase() !== normalizedDetail.tokens[1].poolAddress.toLowerCase() ||
    position.fee !== normalizedDetail.fee
  ) {
    return {
      mode: "lp_execution_invalid",
      code: "LP_TOKEN_ID_OR_RATIO_REQUIRED",
      summary: "Direct Uniswap V3 withdraw tokenId does not match the requested pool metadata.",
    };
  }
  const liquidityToBurn = (position.liquidity * ratio.numerator) / ratio.denominator;
  if (liquidityToBurn <= 0n) {
    return {
      mode: "lp_execution_invalid",
      code: "LP_TOKEN_ID_OR_RATIO_REQUIRED",
      summary: "Direct Uniswap V3 withdraw ratio resolved to zero liquidity.",
    };
  }
  const deadline = BigInt((hooks.nowSecondsImpl?.() ?? Math.floor(Date.now() / 1000)) + DEFAULT_DEADLINE_SECONDS);
  const withdrawCall = encodeFunctionData({
    abi: nonfungiblePositionManagerAbi,
    functionName: "decreaseLiquidity",
    args: [
      {
        tokenId: BigInt(tokenId),
        liquidity: liquidityToBurn,
        amount0Min: 0n,
        amount1Min: 0n,
        deadline,
      },
    ],
  });
  const collectCall = encodeFunctionData({
    abi: nonfungiblePositionManagerAbi,
    functionName: "collect",
    args: [
      {
        tokenId: BigInt(tokenId),
        recipient: address as Address,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      },
    ],
  });
  return executeOnchainosExecutionSteps(
    {
      chain,
      argv: directExecutionArgv(normalizedDetail.contract),
      steps: [
        {
          callDataType: "WITHDRAW",
          from: address,
          to: normalizedDetail.contract,
          serializedData: encodeFunctionData({
            abi: nonfungiblePositionManagerAbi,
            functionName: "multicall",
            args: [[withdrawCall, collectCall]],
          }),
          value: "0x0",
        },
      ],
    },
    env,
    hooks,
  );
}

export function normalizeLpExecutionRequest(
  action: LpExecutionAction,
  payload: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
  target?: string,
): LpExecutionNormalization {
  const lpPayload = payload as LpExecutionPayload;
  const protocol = resolveProtocol(lpPayload, target);
  if (!protocol) {
    return {
      ok: false,
      code: "UNSUPPORTED_LP_PROTOCOL",
      message: "LP execution currently supports only uniswap-v3 and pancakeswap-v3 targets.",
    };
  }

  const investmentId = stringField(lpPayload.investmentId);
  if (!investmentId) {
    return {
      ok: false,
      code: "LP_INVESTMENT_ID_REQUIRED",
      message: "LP execution requires payload.investmentId.",
    };
  }

  const chain = stringField(lpPayload.chain);
  if (!chain) {
    return {
      ok: false,
      code: "LP_CHAIN_REQUIRED",
      message: "LP execution requires payload.chain.",
    };
  }

  const address = stringField(lpPayload.address) ?? syncFallbackExecutionWalletAddress(env) ?? "";
  const runtimeMode = (env.PHALANX_RUNTIME_MODE ?? "").trim().toLowerCase();
  if (!address && runtimeMode === "live") {
    return {
      ok: false,
      code: "LP_WALLET_UNRESOLVED",
      message:
        "Live LP execution requires an explicit wallet override or a managed Onchain OS wallet address for the requested chain.",
    };
  }

  if (action === "depositLpPosition") {
    const token = stringField(lpPayload.token);
    if (!token) {
      return {
        ok: false,
        code: "LP_TOKEN_REQUIRED",
        message: "LP deposit requires payload.token.",
      };
    }
    const amount = stringField(lpPayload.amount);
    if (!amount) {
      return {
        ok: false,
        code: "LP_AMOUNT_REQUIRED",
        message: "LP deposit requires payload.amount.",
      };
    }
    const amountSecondary = stringField(lpPayload.amountSecondary);
    const tokenSecondary = stringField(lpPayload.tokenSecondary);
    if (amountSecondary && !tokenSecondary) {
      return {
        ok: false,
        code: "LP_SECONDARY_TOKEN_REQUIRED",
        message: "LP deposit requires payload.tokenSecondary when payload.amountSecondary is set.",
      };
    }
    const tickLower = stringField(lpPayload.tickLower);
    const tickUpper = stringField(lpPayload.tickUpper);
    const range = stringField(lpPayload.range);
    const tokenId = stringField(lpPayload.tokenId);
    if (!tokenId && !range && !(tickLower && tickUpper)) {
      return {
        ok: false,
        code: "LP_RANGE_OR_TICKS_REQUIRED",
        message: "LP deposit requires payload.range, both tick bounds, or payload.tokenId for an existing position.",
      };
    }

    return {
      ok: true,
      protocol,
      command: {
        kind: "lp_deposit",
        protocol,
        investmentId,
        address,
        chain,
        token,
        amount,
        tokenSecondary,
        amountSecondary,
        tickLower,
        tickUpper,
        range,
        tokenId,
        slippage: stringField(lpPayload.slippage),
      },
    };
  }

  const tokenId = stringField(lpPayload.tokenId);
  const ratio = stringField(lpPayload.ratio);
  const amount = stringField(lpPayload.amount);
  const platformId = stringField(lpPayload.platformId);
  if (!tokenId && !ratio && !amount && !platformId) {
    return {
      ok: false,
      code: "LP_TOKEN_ID_OR_RATIO_REQUIRED",
      message:
        "LP withdraw requires payload.tokenId, payload.ratio, payload.amount, or payload.platformId (for Onchain OS tokenId discovery).",
    };
  }

  return {
    ok: true,
    protocol,
    command: {
      kind: "lp_withdraw",
      protocol,
      investmentId,
      address,
      chain,
      platformId,
      tokenId,
      ratio,
      amount,
      slippage: stringField(lpPayload.slippage),
    },
  };
}

export async function executeLpPositionIntent(
  action: LpExecutionAction,
  payload: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
  target?: string,
  hooks: ExecuteLpPositionIntentHooks = {},
): Promise<OnchainosDefiExecutionResult | { mode: "lp_execution_invalid"; code: string; summary: string }> {
  const lpPayload = payload as LpExecutionPayload;
  const chain = stringField(lpPayload.chain);
  let effectivePayload: Readonly<Record<string, unknown>> = payload;
  if (!stringField(lpPayload.address) && chain) {
    const managedResolver = hooks.resolveExecutionWalletAddressImpl;
    const resolved = await resolvePhalanxExecutionWalletAddress(
      { env, chain } satisfies ResolvePhalanxExecutionWalletAddressInput,
      managedResolver
        ? {
            readManagedWalletAddress: async (inp) => {
              const fromHook = await managedResolver({ env: inp.env, chain: inp.chain });
              return fromHook ?? null;
            },
          }
        : {},
    );
    if (resolved) {
      effectivePayload = { ...payload, address: resolved };
    }
  }
  const protocol = resolveProtocol(effectivePayload as LpExecutionPayload, target);
  if (protocol === "uniswap-v3") {
    return executeDirectUniswapV3Intent(action, effectivePayload as LpExecutionPayload, env, hooks);
  }
  const normalized = normalizeLpExecutionRequest(action, effectivePayload, env, target);
  if (!normalized.ok) {
    return {
      mode: "lp_execution_invalid",
      code: normalized.code,
      summary: normalized.message,
    };
  }
  return executeOnchainosDefiExecution(normalized.command, env, hooks);
}
