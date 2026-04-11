import {
  executeOnchainosDefiExecution,
  type ExecuteOnchainosDefiExecutionHooks,
  type OnchainosDefiExecutionResult,
  type OnchainosExecutionCommandInput,
} from "./onchainos.js";

export type SupportedLpProtocol = "uniswap-v3" | "pancakeswap-v3";

export type LpExecutionAction = "depositLpPosition" | "withdrawLpPosition";

export interface LpExecutionPayload {
  readonly protocol?: unknown;
  readonly investmentId?: unknown;
  readonly address?: unknown;
  readonly chain?: unknown;
  readonly token?: unknown;
  readonly amount?: unknown;
  readonly amountSecondary?: unknown;
  readonly feeTier?: unknown;
  readonly tickLower?: unknown;
  readonly tickUpper?: unknown;
  readonly tokenId?: unknown;
  readonly ratio?: unknown;
  readonly slippage?: unknown;
  readonly poolAddress?: unknown;
  readonly collectFees?: unknown;
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
        | "LP_TOKEN_REQUIRED"
        | "LP_AMOUNT_REQUIRED"
        | "LP_TOKEN_ID_OR_RATIO_REQUIRED";
      readonly message: string;
    };

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function defaultExecutionWalletAddress(env: NodeJS.ProcessEnv): string | undefined {
  const runtimeMode = (env.PHALANX_RUNTIME_MODE ?? "").trim().toLowerCase();
  const livePrimary = (env.PHALANX_WALLET_ADDRESS ?? env.AGENT_WALLET_ADDRESS ?? "").trim();
  if (runtimeMode === "live") {
    return livePrimary || undefined;
  }
  return livePrimary || (env.TEST_WALLET_ADDRESS ?? "").trim() || undefined;
}

function resolveProtocol(payload: LpExecutionPayload, target?: string): SupportedLpProtocol | undefined {
  const candidate = stringField(payload.protocol) ?? stringField(target);
  if (candidate === "uniswap-v3" || candidate === "pancakeswap-v3") {
    return candidate;
  }
  return undefined;
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

  const address = stringField(lpPayload.address) ?? defaultExecutionWalletAddress(env) ?? "";

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
        amountSecondary: stringField(lpPayload.amountSecondary),
        feeTier: stringField(lpPayload.feeTier),
        tickLower: stringField(lpPayload.tickLower),
        tickUpper: stringField(lpPayload.tickUpper),
        poolAddress: stringField(lpPayload.poolAddress),
        slippage: stringField(lpPayload.slippage),
      },
    };
  }

  const tokenId = stringField(lpPayload.tokenId);
  const ratio = stringField(lpPayload.ratio);
  const amount = stringField(lpPayload.amount);
  if (!tokenId && !ratio && !amount) {
    return {
      ok: false,
      code: "LP_TOKEN_ID_OR_RATIO_REQUIRED",
      message: "LP withdraw requires payload.tokenId, payload.ratio, or payload.amount.",
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
      tokenId,
      ratio,
      amount,
      slippage: stringField(lpPayload.slippage),
      poolAddress: stringField(lpPayload.poolAddress),
      collectFees: booleanField(lpPayload.collectFees),
    },
  };
}

export async function executeLpPositionIntent(
  action: LpExecutionAction,
  payload: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
  target?: string,
  hooks: ExecuteOnchainosDefiExecutionHooks = {},
): Promise<OnchainosDefiExecutionResult | { mode: "lp_execution_invalid"; code: string; summary: string }> {
  const normalized = normalizeLpExecutionRequest(action, payload, env, target);
  if (!normalized.ok) {
    return {
      mode: "lp_execution_invalid",
      code: normalized.code,
      summary: normalized.message,
    };
  }
  return executeOnchainosDefiExecution(normalized.command, env, hooks);
}
