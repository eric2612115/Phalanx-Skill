import { resolve } from "node:path";

import { executeOnchainosX402Payment } from "../src/adapters/onchainos.js";
import {
  buildExactEvmX402PaymentProof,
  decodePaymentRequiredHeader,
  parseOnchainosX402PaymentStdout,
} from "../src/adapters/x402.js";
import { loadRuntimeConfigValues } from "../src/config/store.js";

type HttpEvidence = {
  status: number;
  bodyPreview: string;
  paymentRequired?: string | null;
  paymentResponse?: string | null;
};

type X402SmokeOutput = {
  configPath: string;
  baseUrl: string;
  marketId?: string;
  path: string;
  first: HttpEvidence;
  decodedPaymentRequired?: unknown;
  selectedAccept?: unknown;
  onchainosPayment?: unknown;
  replay?: HttpEvidence | { skipped: true; reason: string };
};

function preview(text: string, max = 800): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

async function requestEvidence(url: string, headers?: HeadersInit): Promise<HttpEvidence> {
  const res = await fetch(url, { headers });
  const text = await res.text();
  return {
    status: res.status,
    bodyPreview: preview(text),
    paymentRequired: res.headers.get("PAYMENT-REQUIRED"),
    paymentResponse: res.headers.get("PAYMENT-RESPONSE"),
  };
}

async function main(): Promise<void> {
  const configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env");
  const runtimeEnv = loadRuntimeConfigValues(configPath, process.env);
  const baseUrl = (process.env.PHALANX_X402_SMOKE_BASE_URL ?? "http://127.0.0.1:8006").trim().replace(/\/$/, "");

  const markets = (await getJson(`${baseUrl}/markets?limit=1`)) as { data?: Array<{ market_id?: string }> };
  const marketId = markets.data?.[0]?.market_id;
  if (!marketId) {
    throw new Error("No market_id available for x402 smoke");
  }

  const path = `/markets/${marketId}/history?interval=1h`;
  const url = `${baseUrl}${path}`;
  const first = await requestEvidence(url);

  const output: X402SmokeOutput = {
    configPath,
    baseUrl,
    marketId,
    path,
    first,
  };

  if (first.status !== 402 || !first.paymentRequired) {
    output.replay = { skipped: true, reason: "PAYMENT-REQUIRED header missing on first request" };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const decoded = decodePaymentRequiredHeader(first.paymentRequired);
  const preferredNetwork = (runtimeEnv.PHALANX_X402_NETWORK ?? "eip155:196").trim();
  const selectedAccept =
    decoded.accepts.find((accept) => accept.network === preferredNetwork) ?? decoded.accepts[0];

  output.decodedPaymentRequired = decoded;
  output.selectedAccept = selectedAccept;

  if (!selectedAccept) {
    output.replay = { skipped: true, reason: "No acceptable payment option in PAYMENT-REQUIRED" };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const onchainosPayment = await executeOnchainosX402Payment(
    {
      network: selectedAccept.network,
      amount: selectedAccept.amount,
      payTo: selectedAccept.payTo,
      asset: selectedAccept.asset,
    },
    runtimeEnv,
  );
  output.onchainosPayment = onchainosPayment;

  const parsed = parseOnchainosX402PaymentStdout(onchainosPayment.stdout ?? "");
  if (!parsed) {
    output.replay = { skipped: true, reason: "onchainos payment output did not contain authorization + signature" };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const proof = buildExactEvmX402PaymentProof({
    requestUrl: url,
    accept: selectedAccept,
    payment: parsed,
  });

  output.replay = await requestEvidence(url, {
    "X-PAYMENT": proof,
  });

  console.log(JSON.stringify(output, null, 2));
}

await main();
