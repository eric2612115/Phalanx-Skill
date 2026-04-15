export interface X402SettlementEvidence {
  readonly paymentId?: string;
  readonly settlementMode?: string;
  readonly settlementStatus?: string;
  readonly settlementTxHash?: string;
  readonly settlementNetwork?: string;
  readonly settlementExplorerUrl?: string;
  readonly settlementSource: "payment_response" | "receipt_lookup";
}

export interface ResolveX402SettlementEvidenceInput {
  readonly requestUrl: string;
  readonly paymentResponseHeader?: string;
  readonly paymentIdHeader?: string;
  readonly fetchImpl?: typeof fetch;
  readonly pollDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SETTLEMENT_POLL_DELAYS_MS = [2_000, 5_000, 10_000] as const;

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeNetwork(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return `eip155:${raw}`;
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("eip155:")) {
    return trimmed;
  }
  return /^\d+$/.test(trimmed) ? `eip155:${trimmed}` : trimmed;
}

function readSettlementTxHash(record: Readonly<Record<string, unknown>>): string | undefined {
  return (
    stringField(record, "settlement_tx_hash") ??
    stringField(record, "settlementTxHash") ??
    stringField(record, "tx_hash") ??
    stringField(record, "txHash") ??
    stringField(record, "transaction")
  );
}

export function buildSettlementExplorerUrl(network: string | undefined, txHash: string | undefined): string | undefined {
  if (!network || !txHash) {
    return undefined;
  }
  const chain = network === "eip155:196" ? "xlayer" : network === "eip155:8453" ? "base" : network === "eip155:137" ? "polygon" : undefined;
  if (!chain) {
    return undefined;
  }
  return `https://web3.okx.com/zh-hant/explorer/${chain}/tx/${txHash}`;
}

export function decodePaymentResponseHeader(
  header: string | undefined | null,
): Readonly<Record<string, unknown>> | undefined {
  if (!header || header.trim().length === 0) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function parseX402SettlementFromPaymentResponse(
  header: string | undefined | null,
): X402SettlementEvidence | undefined {
  const payload = decodePaymentResponseHeader(header);
  if (!payload) {
    return undefined;
  }
  const paymentId = stringField(payload, "payment_id") ?? stringField(payload, "paymentId");
  const settlementMode = stringField(payload, "settlement_mode") ?? stringField(payload, "settlementMode");
  const settlementStatus =
    stringField(payload, "settlement_status") ??
    stringField(payload, "settlementStatus") ??
    stringField(payload, "reason_code") ??
    stringField(payload, "reasonCode");
  const settlementTxHash = readSettlementTxHash(payload);
  const settlementNetwork =
    normalizeNetwork(payload["settlement_network"]) ?? normalizeNetwork(payload["network"]) ?? normalizeNetwork(payload["chain_id"]);
  if (!paymentId && !settlementTxHash && !settlementMode && !settlementStatus) {
    return undefined;
  }
  return {
    paymentId,
    settlementMode,
    settlementStatus,
    settlementTxHash,
    settlementNetwork,
    settlementExplorerUrl: buildSettlementExplorerUrl(settlementNetwork, settlementTxHash),
    settlementSource: "payment_response",
  };
}

async function lookupX402SettlementReceipt(
  requestUrl: string,
  paymentId: string,
  fetchImpl: typeof fetch,
): Promise<X402SettlementEvidence | undefined> {
  const baseUrl = new URL(requestUrl).origin;
  const response = await fetchImpl(`${baseUrl}/payments/x402/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return undefined;
  }
  const payload = (await response.json()) as unknown;
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const settlementTxHash = readSettlementTxHash(record);
  const settlementNetwork = normalizeNetwork(record["settlement_network"]) ?? normalizeNetwork(record["network"]);
  const outcome = stringField(record, "outcome");
  const settled = record["settled"] === true;
  return {
    paymentId: stringField(record, "payment_id") ?? paymentId,
    settlementMode: settled ? "sync" : undefined,
    settlementStatus: outcome ?? (settled ? "success" : "pending"),
    settlementTxHash,
    settlementNetwork,
    settlementExplorerUrl: buildSettlementExplorerUrl(settlementNetwork, settlementTxHash),
    settlementSource: "receipt_lookup",
  };
}

export async function resolveX402SettlementEvidence(
  input: ResolveX402SettlementEvidenceInput,
): Promise<X402SettlementEvidence | undefined> {
  const parsed = parseX402SettlementFromPaymentResponse(input.paymentResponseHeader);
  if (parsed?.settlementTxHash) {
    return parsed;
  }
  const paymentId = (input.paymentIdHeader ?? parsed?.paymentId ?? "").trim();
  if (!paymentId) {
    return parsed;
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollDelaysMs = input.pollDelaysMs ?? DEFAULT_SETTLEMENT_POLL_DELAYS_MS;
  let lastReceipt = parsed;
  for (const delayMs of [0, ...pollDelaysMs]) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      const receipt = await lookupX402SettlementReceipt(input.requestUrl, paymentId, fetchImpl);
      if (!receipt) {
        continue;
      }
      const merged: X402SettlementEvidence = {
        paymentId: receipt.paymentId ?? parsed?.paymentId ?? paymentId,
        settlementMode: parsed?.settlementMode ?? receipt.settlementMode,
        settlementStatus: receipt.settlementStatus ?? parsed?.settlementStatus,
        settlementTxHash: receipt.settlementTxHash ?? parsed?.settlementTxHash,
        settlementNetwork: receipt.settlementNetwork ?? parsed?.settlementNetwork,
        settlementExplorerUrl:
          receipt.settlementExplorerUrl ??
          buildSettlementExplorerUrl(receipt.settlementNetwork ?? parsed?.settlementNetwork, receipt.settlementTxHash ?? parsed?.settlementTxHash),
        settlementSource: receipt.settlementSource,
      };
      if (merged.settlementTxHash) {
        return merged;
      }
      lastReceipt = merged;
    } catch {
      // Ignore transient lookup failures; the payment itself already succeeded.
    }
  }
  return lastReceipt
    ? {
        ...lastReceipt,
        paymentId,
      }
    : parsed;
}
