import type { X402AcceptOption } from "./x402.js";
import type { X402BalanceProbe } from "./x402-balance-probe.js";

export type X402AcceptSelectionStatus =
  | "selected"
  | "no_supported_accept"
  | "insufficient_funds"
  | "selection_blocked";

export interface X402AcceptSelectionInput {
  readonly accepts: readonly X402AcceptOption[];
  readonly payerAddress: string;
  readonly networkOverride?: string;
  readonly balanceProbe: X402BalanceProbe;
}

export interface X402AcceptSelectionEvaluation {
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly sufficient: boolean;
  readonly balance?: string;
  readonly summary?: string;
}

export interface X402AcceptSelectionResult {
  readonly status: X402AcceptSelectionStatus;
  readonly accept?: X402AcceptOption;
  readonly payerAddress: string;
  readonly summary: string;
  readonly evaluations: readonly X402AcceptSelectionEvaluation[];
}

const NETWORK_PRIORITY: readonly string[] = ["eip155:196", "eip155:8453"];

function networkRank(network: string): number {
  const index = NETWORK_PRIORITY.indexOf(network);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export async function selectBestX402Accept(
  input: X402AcceptSelectionInput,
): Promise<X402AcceptSelectionResult> {
  const supported = input.accepts.filter((accept) => NETWORK_PRIORITY.includes(accept.network));
  if (supported.length === 0) {
    return {
      status: "no_supported_accept",
      payerAddress: input.payerAddress,
      summary: "no_supported_accept:accepts[] did not include X Layer or Base",
      evaluations: [],
    };
  }

  const override = input.networkOverride?.trim();
  const candidates = override
    ? supported.filter((accept) => accept.network === override)
    : [...supported].sort((left, right) => networkRank(left.network) - networkRank(right.network));

  if (override && candidates.length === 0) {
    return {
      status: "selection_blocked",
      payerAddress: input.payerAddress,
      summary: `selection_blocked:override_network_unavailable:${override}`,
      evaluations: [],
    };
  }

  const evaluations: X402AcceptSelectionEvaluation[] = [];
  for (const accept of candidates) {
    const probed = await input.balanceProbe({
      walletAddress: input.payerAddress,
      network: accept.network,
      asset: accept.asset,
      amount: accept.amount,
    });
    const evaluation: X402AcceptSelectionEvaluation = {
      network: accept.network,
      asset: accept.asset,
      amount: accept.amount,
      sufficient: probed.sufficient,
      balance: probed.balance,
      summary: probed.summary,
    };
    evaluations.push(evaluation);
    if (probed.sufficient) {
      return {
        status: "selected",
        accept,
        payerAddress: input.payerAddress,
        summary: override
          ? `selected_accept:override:${accept.network}`
          : `selected_accept:policy_rank:${accept.network}`,
        evaluations,
      };
    }
  }

  return {
    status: "insufficient_funds",
    payerAddress: input.payerAddress,
    summary: `insufficient_funds:${override ?? "policy_ranked_candidates_exhausted"}`,
    evaluations,
  };
}
