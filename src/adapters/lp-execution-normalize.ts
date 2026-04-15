import type { OnchainosExecutionCommandInput } from "./onchainos.js";

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

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveProtocol(
  payload: LpExecutionPayload,
  target?: string,
): SupportedLpProtocol | undefined {
  const candidate = stringField(payload.protocol) ?? stringField(target);
  if (candidate === "uniswap-v3" || candidate === "pancakeswap-v3") {
    return candidate;
  }
  return undefined;
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

  const address = stringField(lpPayload.address) ?? "";
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
