import { readOnchainosWalletBalance, type OnchainosWalletBalanceResult } from "./onchainos.js";

export interface X402BalanceProbeInput {
  readonly walletAddress: string;
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
}

export interface X402BalanceProbeResult {
  readonly sufficient: boolean;
  readonly balance?: string;
  readonly summary?: string;
}

export type X402BalanceProbe = (input: X402BalanceProbeInput) => Promise<X402BalanceProbeResult>;

function parseWalletBalanceAssets(stdout: string): Array<{ tokenAddress: string; rawBalance: string }> {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
    const details = Array.isArray(data.details) ? data.details : [];
    const assets: Array<{ tokenAddress: string; rawBalance: string }> = [];
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
          tokenAddress: typeof rec.tokenAddress === "string" ? rec.tokenAddress : "",
          rawBalance: typeof rec.rawBalance === "string" ? rec.rawBalance : "0",
        });
      }
    }
    return assets;
  } catch {
    return [];
  }
}

function networkToChain(network: string): string | null {
  switch (network.trim()) {
    case "eip155:196":
      return "xlayer";
    case "eip155:8453":
      return "base";
    default:
      return null;
  }
}

function bigintFromString(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function summarizeWalletBalanceResult(result: OnchainosWalletBalanceResult): string {
  return `wallet_balance:${result.status}:${result.summary}`;
}

export function createOnchainosX402BalanceProbe(env: NodeJS.ProcessEnv = process.env): X402BalanceProbe {
  return async (input) => {
    const chain = networkToChain(input.network);
    if (!chain) {
      return {
        sufficient: false,
        summary: `wallet_balance:unsupported_network:${input.network}`,
      };
    }

    const result = await readOnchainosWalletBalance(
      {
        chain,
        tokenAddress: input.asset,
        env,
      },
    );
    if (result.status !== "completed") {
      return {
        sufficient: false,
        summary: summarizeWalletBalanceResult(result),
      };
    }

    const asset = parseWalletBalanceAssets(result.stdout ?? "").find(
      (item) => item.tokenAddress.toLowerCase() === input.asset.toLowerCase(),
    );
    const balance = asset?.rawBalance ?? "0";
    return {
      sufficient: bigintFromString(balance) >= bigintFromString(input.amount),
      balance,
      summary: `wallet_balance:completed:${chain}`,
    };
  };
}
