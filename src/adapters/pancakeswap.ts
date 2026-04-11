/**
 * PancakeSwap V3 LP adapter: explicit plan vs execution; viem reads mirror Uniswap V3 NFT manager shape when configured.
 */

import { createPublicClient, http, type Abi, type Address } from "viem";
import { isAddress } from "viem";

export type PancakeSwapLpPlanInput = {
  readonly chain: string;
};

export const PANCAKE_V3_POSITIONS_ABI = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const satisfies Abi;

export type PancakeSwapLpLiveRouting = {
  readonly rpcEnvKey: string;
  readonly rpcUrl?: string;
  readonly positionManagerEnv: string;
  readonly positionManager?: Address;
  readonly tokenIdEnv: string;
  readonly tokenId?: bigint;
};

export type PancakeSwapLpAdapterPlan = {
  readonly provider: "pancakeswap";
  readonly status: "planned" | "unsupported" | "live_ready" | "live_config_missing";
  readonly summary: string;
  readonly chain: string;
  readonly executionNote: string;
  readonly live: PancakeSwapLpLiveRouting;
};

export type PancakeSwapLpReadResult = {
  readonly provider: "pancakeswap";
  readonly status: "skipped" | "completed" | "failed";
  readonly summary: string;
  readonly position?: {
    token0: Address;
    token1: Address;
    fee: number;
    tickLower: number;
    tickUpper: number;
    liquidity: string;
  };
};

function pickPancakeRpc(
  chain: string,
  env: NodeJS.ProcessEnv,
): { url?: string; key: string } {
  const dedicated = (env.PHALANX_PANCAKE_RPC_URL ?? "").trim();
  if (dedicated) return { url: dedicated, key: "PHALANX_PANCAKE_RPC_URL" };
  const c = chain.toLowerCase();
  if (c.includes("xlayer")) {
    const u = (env.XLAYER_RPC_URL ?? "").trim();
    return { url: u || undefined, key: "XLAYER_RPC_URL" };
  }
  const bsc = (env.BSC_RPC_URL ?? env.BNB_RPC_URL ?? "").trim();
  if (bsc) return { url: bsc, key: "BSC_RPC_URL" };
  const base = (env.BASE_RPC_URL ?? "").trim();
  return { url: base || undefined, key: "BASE_RPC_URL" };
}

function parseTokenId(raw: string | undefined): bigint | undefined {
  const t = (raw ?? "").trim();
  if (!t) return undefined;
  try {
    return BigInt(t);
  } catch {
    return undefined;
  }
}

export function resolvePancakeLiveRouting(
  chain: string,
  env: NodeJS.ProcessEnv = process.env,
): PancakeSwapLpLiveRouting {
  const { url, key } = pickPancakeRpc(chain, env);
  const pmRaw = (env.PHALANX_PANCAKE_V3_POSITION_MANAGER ?? "").trim();
  const tokenId = parseTokenId(env.PHALANX_PANCAKE_POSITION_TOKEN_ID);
  const positionManager =
    pmRaw && isAddress(pmRaw) ? (pmRaw as Address) : undefined;

  return {
    rpcEnvKey: key,
    rpcUrl: url,
    positionManagerEnv: "PHALANX_PANCAKE_V3_POSITION_MANAGER",
    positionManager,
    tokenIdEnv: "PHALANX_PANCAKE_POSITION_TOKEN_ID",
    tokenId,
  };
}

export function planPancakeSwapLpRead(
  input: PancakeSwapLpPlanInput,
  env: NodeJS.ProcessEnv = process.env,
): PancakeSwapLpAdapterPlan {
  const chain = input.chain.trim() || "unknown";
  const live = resolvePancakeLiveRouting(chain, env);
  const hasAll = Boolean(live.rpcUrl && live.positionManager && live.tokenId !== undefined);

  return {
    provider: "pancakeswap",
    status: hasAll ? "live_ready" : "live_config_missing",
    summary: hasAll
      ? "PancakeSwap V3 position read plan ready; execution uses viem readContract on the configured manager."
      : "PancakeSwap LP plan recorded; set BSC_RPC_URL / PHALANX_PANCAKE_RPC_URL / BASE_RPC_URL, PHALANX_PANCAKE_V3_POSITION_MANAGER, and PHALANX_PANCAKE_POSITION_TOKEN_ID for live reads.",
    chain,
    executionNote:
      "Planning is synchronous; call executePancakeSwapLpReadPlan after policy, risk, and approval — execution performs RPC reads only.",
    live,
  };
}

export async function executePancakeSwapLpReadPlan(
  plan: PancakeSwapLpAdapterPlan,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PancakeSwapLpReadResult> {
  void env;
  if (plan.status !== "live_ready") {
    return {
      provider: "pancakeswap",
      status: "skipped",
      summary: plan.summary,
    };
  }

  const { rpcUrl, positionManager, tokenId } = plan.live;
  if (!rpcUrl || !positionManager || tokenId === undefined) {
    return {
      provider: "pancakeswap",
      status: "skipped",
      summary: "live routing incomplete",
    };
  }

  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const res = (await client.readContract({
      address: positionManager,
      abi: PANCAKE_V3_POSITIONS_ABI as unknown as Abi,
      functionName: "positions",
      args: [tokenId],
    })) as readonly [
      bigint,
      Address,
      Address,
      Address,
      number,
      number,
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];

    const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = res;
    return {
      provider: "pancakeswap",
      status: "completed",
      summary: "positions(uint256) read succeeded",
      position: {
        token0,
        token1,
        fee: Number(fee),
        tickLower: Number(tickLower),
        tickUpper: Number(tickUpper),
        liquidity: liquidity.toString(),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: "pancakeswap",
      status: "failed",
      summary: msg.replace(/\s+/g, " ").slice(0, 240),
    };
  }
}

/** PancakeSwap V3 Quoter-compatible `quoteExactInputSingle` (read-only). */
export const PANCAKE_V3_QUOTE_EXACT_INPUT_SINGLE_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const satisfies Abi;

export type PancakeSwapSwapQuotePlanInput = {
  readonly chain: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string;
  readonly fee?: number;
};

export type PancakeSwapSwapQuoteLiveRouting = {
  readonly rpcEnvKey: string;
  readonly rpcUrl?: string;
  readonly quoterEnv: string;
  readonly quoter?: Address;
  readonly tokenIn?: Address;
  readonly tokenOut?: Address;
  readonly fee: number;
  readonly amountIn?: bigint;
  readonly sqrtPriceLimitX96: bigint;
};

export type PancakeSwapSwapQuoteAdapterPlan = {
  readonly provider: "pancakeswap";
  readonly lane: "swap_quote";
  readonly status: "live_ready" | "live_config_missing" | "invalid_input";
  readonly summary: string;
  readonly chain: string;
  readonly executionNote: string;
  readonly live: PancakeSwapSwapQuoteLiveRouting;
};

export type PancakeSwapSwapQuoteReadResult = {
  readonly provider: "pancakeswap";
  readonly lane: "swap_quote";
  readonly status: "skipped" | "completed" | "failed";
  readonly summary: string;
  readonly amountOut?: string;
};

function parsePancakeSwapAmountIn(raw: string): bigint | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  try {
    const v = BigInt(t);
    return v >= 0n ? v : undefined;
  } catch {
    return undefined;
  }
}

function pickPancakeQuoterAddress(env: NodeJS.ProcessEnv): string | undefined {
  const q = (env.PHALANX_PANCAKE_V3_QUOTER ?? env.PHALANX_PANCAKE_V3_QUOTER_V2 ?? "").trim();
  return q.length > 0 ? q : undefined;
}

export function resolvePancakeSwapQuoteRouting(
  chain: string,
  input: Pick<PancakeSwapSwapQuotePlanInput, "tokenIn" | "tokenOut" | "amountIn" | "fee">,
  env: NodeJS.ProcessEnv = process.env,
): PancakeSwapSwapQuoteLiveRouting {
  const { url, key } = pickPancakeRpc(chain, env);
  const quoterRaw = pickPancakeQuoterAddress(env);
  const quoter = quoterRaw && isAddress(quoterRaw) ? (quoterRaw as Address) : undefined;
  const t0 = input.tokenIn.trim();
  const t1 = input.tokenOut.trim();
  const tokenIn = isAddress(t0) ? (t0 as Address) : undefined;
  const tokenOut = isAddress(t1) ? (t1 as Address) : undefined;
  const amountIn = parsePancakeSwapAmountIn(input.amountIn);
  const fee = input.fee ?? 2500;

  return {
    rpcEnvKey: key,
    rpcUrl: url,
    quoterEnv: "PHALANX_PANCAKE_V3_QUOTER",
    quoter,
    tokenIn,
    tokenOut,
    fee,
    amountIn,
    sqrtPriceLimitX96: 0n,
  };
}

export function planPancakeSwapSwapQuoteExecution(
  input: PancakeSwapSwapQuotePlanInput,
  env: NodeJS.ProcessEnv = process.env,
): PancakeSwapSwapQuoteAdapterPlan {
  const chain = input.chain.trim() || "unknown";
  const live = resolvePancakeSwapQuoteRouting(chain, input, env);
  if (live.amountIn === undefined) {
    return {
      provider: "pancakeswap",
      lane: "swap_quote",
      status: "invalid_input",
      summary: "amountIn must be a non-negative integer string (wei) for quoting.",
      chain,
      executionNote:
        "Planning is synchronous; execution calls Quoter.quoteExactInputSingle via viem readContract only.",
      live,
    };
  }

  const hasAll = Boolean(live.rpcUrl && live.quoter && live.tokenIn && live.tokenOut);
  return {
    provider: "pancakeswap",
    lane: "swap_quote",
    status: hasAll ? "live_ready" : "live_config_missing",
    summary: hasAll
      ? "PancakeSwap V3 swap quote plan ready; execution performs a quoter static read."
      : "Configure PHALANX_PANCAKE_V3_QUOTER, RPC (BSC_RPC_URL / PHALANX_PANCAKE_RPC_URL), tokenIn, tokenOut, and amountIn for live quotes.",
    chain,
    executionNote:
      "Planning is synchronous; call executePancakeSwapSwapQuotePlan after policy gates — execution is RPC read-only (no swap submission).",
    live,
  };
}

export async function executePancakeSwapSwapQuotePlan(
  plan: PancakeSwapSwapQuoteAdapterPlan,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PancakeSwapSwapQuoteReadResult> {
  void env;
  if (plan.status !== "live_ready") {
    return {
      provider: "pancakeswap",
      lane: "swap_quote",
      status: "skipped",
      summary: plan.summary,
    };
  }

  const { rpcUrl, quoter, tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96 } = plan.live;
  if (!rpcUrl || !quoter || !tokenIn || !tokenOut || amountIn === undefined) {
    return {
      provider: "pancakeswap",
      lane: "swap_quote",
      status: "skipped",
      summary: "swap quote routing incomplete",
    };
  }

  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const amountOut = (await client.readContract({
      address: quoter,
      abi: PANCAKE_V3_QUOTE_EXACT_INPUT_SINGLE_ABI as unknown as Abi,
      functionName: "quoteExactInputSingle",
      args: [tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96],
    })) as bigint;

    return {
      provider: "pancakeswap",
      lane: "swap_quote",
      status: "completed",
      summary: "quoteExactInputSingle succeeded",
      amountOut: amountOut.toString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: "pancakeswap",
      lane: "swap_quote",
      status: "failed",
      summary: msg.replace(/\s+/g, " ").slice(0, 240),
    };
  }
}
