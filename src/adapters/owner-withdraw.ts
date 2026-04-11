import { isAddress } from "viem";
import {
  executeOnchainosWalletSend,
  readOnchainosWalletBalance,
  type OnchainosWalletBalanceResult,
  type OnchainosWalletSendResult,
} from "./onchainos.js";

export interface OwnerWithdrawConfig {
  readonly ownerAddress: string;
  readonly baseGasReserveWei: string;
  readonly xlayerGasReserveWei: string;
}

export type OwnerWithdrawConfigResult =
  | {
      readonly ready: true;
      readonly config: OwnerWithdrawConfig;
    }
  | {
      readonly ready: false;
      readonly reason: "missing_owner_address" | "invalid_owner_address";
    };

export interface SweepAssetBalance {
  readonly chainId: string;
  readonly symbol: string;
  readonly tokenAddress: string;
  readonly rawBalance: string;
  readonly decimal: string;
}

export interface SweepPlanInput {
  readonly chain: string;
  readonly ownerAddress: string;
  readonly gasReserveWei: string;
}

export interface OwnerSweepTransfer {
  readonly chain: string;
  readonly recipient: string;
  readonly amt: string;
  readonly contractToken?: string;
  readonly assetKind: "native" | "erc20";
}

export type SweepPlanResult =
  | {
      readonly status: "planned";
      readonly transfers: readonly OwnerSweepTransfer[];
      readonly summary: string;
    }
  | {
      readonly status: "invalid_config";
      readonly summary: string;
    };

export type OwnerWithdrawExecutionResult =
  | OnchainosWalletSendResult
  | {
      readonly mode: "owner_withdraw_invalid";
      readonly code: string;
      readonly summary: string;
    };

export type OwnerSweepExecutionResult =
  | {
      readonly provider: "onchainos";
      readonly lane: "owner_sweep";
      readonly status: "completed" | "failed" | "tool_missing";
      readonly summary: string;
      readonly txRefs?: readonly string[];
      readonly steps?: readonly OnchainosWalletSendResult[];
      readonly argv?: readonly string[];
    }
  | {
      readonly mode: "owner_withdraw_invalid";
      readonly code: string;
      readonly summary: string;
    };

function stringEnv(value: string | undefined): string {
  return (value ?? "").trim();
}

export function resolveOwnerWithdrawConfig(
  env: NodeJS.ProcessEnv = process.env,
): OwnerWithdrawConfigResult {
  const ownerAddress = stringEnv(env.PHALANX_OWNER_EVM_ADDRESS);
  if (!ownerAddress) {
    return { ready: false, reason: "missing_owner_address" };
  }
  if (!isAddress(ownerAddress)) {
    return { ready: false, reason: "invalid_owner_address" };
  }
  return {
    ready: true,
    config: {
      ownerAddress,
      baseGasReserveWei: stringEnv(env.PHALANX_BASE_GAS_RESERVE_WEI) || "0",
      xlayerGasReserveWei: stringEnv(env.PHALANX_XLAYER_GAS_RESERVE_WEI) || "0",
    },
  };
}

function isNativeGasAsset(asset: SweepAssetBalance): boolean {
  return asset.tokenAddress.trim().length === 0;
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function reserveForChain(chain: string, config: OwnerWithdrawConfig): string {
  const normalized = chain.trim().toLowerCase();
  if (normalized === "xlayer" || normalized === "196") {
    return config.xlayerGasReserveWei;
  }
  return config.baseGasReserveWei;
}

export function planSweepToOwnerTransfers(
  input: SweepPlanInput,
  balances: readonly SweepAssetBalance[],
): SweepPlanResult {
  if (!isAddress(input.ownerAddress)) {
    return {
      status: "invalid_config",
      summary: "Configured owner address is missing or invalid.",
    };
  }

  const reserve = safeBigInt(input.gasReserveWei);
  const transfers: OwnerSweepTransfer[] = [];

  for (const balance of balances) {
    const rawBalance = safeBigInt(balance.rawBalance);
    if (rawBalance <= 0n) {
      continue;
    }

    if (isNativeGasAsset(balance)) {
      const transferable = rawBalance > reserve ? rawBalance - reserve : 0n;
      if (transferable > 0n) {
        transfers.push({
          chain: input.chain,
          recipient: input.ownerAddress,
          amt: transferable.toString(),
          assetKind: "native",
        });
      }
      continue;
    }

    transfers.push({
      chain: input.chain,
      recipient: input.ownerAddress,
      amt: rawBalance.toString(),
      contractToken: balance.tokenAddress,
      assetKind: "erc20",
    });
  }

  return {
    status: "planned",
    transfers,
    summary: `Prepared ${transfers.length} owner sweep transfer(s) for ${input.chain}.`,
  };
}

export function parseOnchainosWalletBalanceAssets(stdout: string): SweepAssetBalance[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
    const details = Array.isArray(data.details) ? data.details : [];
    const assets: SweepAssetBalance[] = [];
    for (const detail of details) {
      if (!detail || typeof detail !== "object") {
        continue;
      }
      const tokenAssets = Array.isArray((detail as Record<string, unknown>).tokenAssets)
        ? ((detail as Record<string, unknown>).tokenAssets as unknown[])
        : [];
      for (const asset of tokenAssets) {
        if (!asset || typeof asset !== "object") {
          continue;
        }
        const rec = asset as Record<string, unknown>;
        assets.push({
          chainId: typeof rec.chainIndex === "string" ? rec.chainIndex : "",
          symbol: typeof rec.symbol === "string" ? rec.symbol : "",
          tokenAddress: typeof rec.tokenAddress === "string" ? rec.tokenAddress : "",
          rawBalance: typeof rec.rawBalance === "string" ? rec.rawBalance : "0",
          decimal: typeof rec.decimal === "string" ? rec.decimal : "0",
        });
      }
    }
    return assets;
  } catch {
    return [];
  }
}

function buildToolMissingSweepResult(result: OnchainosWalletBalanceResult): OwnerSweepExecutionResult {
  return {
    provider: "onchainos",
    lane: "owner_sweep",
    status: "tool_missing",
    summary: result.summary,
    argv: result.argv,
  };
}

export async function executeWithdrawToOwner(
  payload: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnerWithdrawExecutionResult> {
  const resolved = resolveOwnerWithdrawConfig(env);
  if (!resolved.ready) {
    return {
      mode: "owner_withdraw_invalid",
      code: resolved.reason,
      summary: "Owner withdrawal requires a valid PHALANX_OWNER_EVM_ADDRESS.",
    };
  }

  const chain = typeof payload.chain === "string" && payload.chain.trim() ? payload.chain.trim() : "base";
  const readableAmount =
    typeof payload.readableAmount === "string" && payload.readableAmount.trim() ? payload.readableAmount.trim() : undefined;
  const amt = typeof payload.amt === "string" && payload.amt.trim() ? payload.amt.trim() : undefined;
  if (!readableAmount && !amt) {
    return {
      mode: "owner_withdraw_invalid",
      code: "OWNER_WITHDRAW_AMOUNT_REQUIRED",
      summary: "withdrawToOwner requires payload.readableAmount or payload.amt.",
    };
  }

  return executeOnchainosWalletSend(
    {
      recipient: resolved.config.ownerAddress,
      chain,
      from: typeof payload.address === "string" && payload.address.trim() ? payload.address.trim() : undefined,
      contractToken:
        typeof payload.contractToken === "string" && payload.contractToken.trim()
          ? payload.contractToken.trim()
          : undefined,
      readableAmount,
      amt,
      force: true,
    },
    env,
  );
}

export async function executeSweepToOwner(
  payload: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnerSweepExecutionResult> {
  const resolved = resolveOwnerWithdrawConfig(env);
  if (!resolved.ready) {
    return {
      mode: "owner_withdraw_invalid",
      code: resolved.reason,
      summary: "Owner sweep requires a valid PHALANX_OWNER_EVM_ADDRESS.",
    };
  }

  const chain = typeof payload.chain === "string" && payload.chain.trim() ? payload.chain.trim() : "base";
  const balanceResult = await readOnchainosWalletBalance({ chain, env });
  if (balanceResult.status === "tool_missing") {
    return buildToolMissingSweepResult(balanceResult);
  }
  if (balanceResult.status !== "completed" || !balanceResult.stdout) {
    return {
      provider: "onchainos",
      lane: "owner_sweep",
      status: "failed",
      summary: balanceResult.summary,
      argv: balanceResult.argv,
    };
  }

  const balances = parseOnchainosWalletBalanceAssets(balanceResult.stdout);
  const plan = planSweepToOwnerTransfers(
    {
      chain,
      ownerAddress: resolved.config.ownerAddress,
      gasReserveWei: reserveForChain(chain, resolved.config),
    },
    balances,
  );
  if (plan.status !== "planned") {
    return {
      mode: "owner_withdraw_invalid",
      code: "OWNER_SWEEP_INVALID_PLAN",
      summary: plan.summary,
    };
  }

  const steps: OnchainosWalletSendResult[] = [];
  const txRefs: string[] = [];
  for (const transfer of plan.transfers) {
    const result = await executeOnchainosWalletSend(
      {
        recipient: transfer.recipient,
        chain: transfer.chain,
        amt: transfer.amt,
        contractToken: transfer.contractToken,
        force: true,
      },
      env,
    );
    steps.push(result);
    if (result.status === "tool_missing") {
      return {
        provider: "onchainos",
        lane: "owner_sweep",
        status: "tool_missing",
        summary: result.summary,
        steps,
        argv: result.argv,
      };
    }
    if (result.status !== "completed") {
      return {
        provider: "onchainos",
        lane: "owner_sweep",
        status: "failed",
        summary: result.summary,
        steps,
        argv: result.argv,
      };
    }
    txRefs.push(result.summary);
  }

  return {
    provider: "onchainos",
    lane: "owner_sweep",
    status: "completed",
    summary: `Owner sweep completed with ${steps.length} transfer(s).`,
    txRefs,
    steps,
  };
}
