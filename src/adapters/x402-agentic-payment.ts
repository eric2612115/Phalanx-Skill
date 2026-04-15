import { executeOnchainosX402Payment, type OnchainosX402PaymentResult } from "./onchainos.js";
import { buildExactEvmX402PaymentProof, decodePaymentRequiredHeader, parseOnchainosX402PaymentStdout } from "./x402.js";
import { createOnchainosX402BalanceProbe, type X402BalanceProbe } from "./x402-balance-probe.js";
import { selectBestX402Accept } from "./x402-accept-selection.js";
import { normalizeAgenticWalletRegistry, resolveActiveAgenticWallet } from "../config/agentic-wallet-registry.js";

export type AgenticWalletPaymentSource =
  | "agentic_active_wallet"
  | "override"
  | "debug_private_key_fallback";

export interface AgenticX402PaymentSelection {
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly payerAddress: string;
  readonly payerProfileId?: string;
  readonly payerProfileEmail?: string;
  readonly payerWalletId?: string;
  readonly walletSource: AgenticWalletPaymentSource;
}

export interface AgenticX402HttpResult {
  readonly status: "completed" | "failed";
  readonly httpStatus?: number;
  readonly summary: string;
  readonly bodyPreview?: string;
  readonly paymentRequiredByServer: boolean;
  readonly paymentAttempted: boolean;
  readonly paymentWrapped: boolean;
  readonly paymentSettled: boolean;
  readonly fetchSummary: string;
  readonly selection?: AgenticX402PaymentSelection;
  readonly receipt?: Readonly<Record<string, unknown>>;
}

export interface ExecuteAgenticX402HttpRequestInput {
  readonly url: string;
  readonly init?: RequestInit;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ExecuteAgenticX402HttpRequestDeps {
  readonly fetch?: typeof fetch;
  readonly executePayment?: (
    input: Parameters<typeof executeOnchainosX402Payment>[0],
    env: NodeJS.ProcessEnv,
  ) => Promise<OnchainosX402PaymentResult>;
  readonly balanceProbe?: X402BalanceProbe;
}

function preview(text: string, max = 800): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

function paymentExplicitlyEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.PHALANX_X402_PAYMENT_ENABLED ?? "").trim() === "1";
}

function resolvePayer(env: NodeJS.ProcessEnv): {
  address?: string;
  walletSource?: AgenticWalletPaymentSource;
  profileId?: string;
  profileEmail?: string;
  walletId?: string;
} {
  const override = (env.PHALANX_WALLET_ADDRESS ?? env.AGENT_WALLET_ADDRESS ?? "").trim();
  if (override) {
    return {
      address: override,
      walletSource: "override",
    };
  }
  const registry = normalizeAgenticWalletRegistry(env);
  const active = resolveActiveAgenticWallet(registry);
  if (active.wallet) {
    return {
      address: active.wallet.address,
      walletSource: "agentic_active_wallet",
      profileId: active.profile?.profileId,
      profileEmail: active.profile?.email,
      walletId: active.wallet.walletId,
    };
  }
  return {};
}

export async function executeAgenticX402HttpRequest(
  input: ExecuteAgenticX402HttpRequestInput,
  deps: ExecuteAgenticX402HttpRequestDeps = {},
): Promise<AgenticX402HttpResult> {
  const env = input.env ?? process.env;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const balanceProbe = deps.balanceProbe ?? createOnchainosX402BalanceProbe(env);
  const executePayment = deps.executePayment ?? executeOnchainosX402Payment;
  const init = input.init ?? {};
  const first = await fetchImpl(input.url, init);
  const firstBody = await first.text();

  if (!paymentExplicitlyEnabled(env)) {
    return {
      status: first.ok ? "completed" : "failed",
      httpStatus: first.status,
      summary: first.ok ? `http_ok:${first.status}` : `http_error:${first.status}`,
      bodyPreview: preview(firstBody),
      paymentRequiredByServer: first.status === 402,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "plain_fetch:payment_disabled",
    };
  }

  if (first.status !== 402) {
    return {
      status: first.ok ? "completed" : "failed",
      httpStatus: first.status,
      summary: first.ok ? `http_ok:${first.status}` : `http_error:${first.status}`,
      bodyPreview: preview(firstBody),
      paymentRequiredByServer: false,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "agentic_x402:not_required",
    };
  }

  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    return {
      status: "failed",
      httpStatus: first.status,
      summary: "payment_required_header_missing",
      bodyPreview: preview(firstBody),
      paymentRequiredByServer: true,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "agentic_x402:payment_required_header_missing",
    };
  }

  const payer = resolvePayer(env);
  if (!payer.address || !payer.walletSource) {
    return {
      status: "failed",
      httpStatus: first.status,
      summary: "agentic_wallet_missing",
      bodyPreview: preview(firstBody),
      paymentRequiredByServer: true,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "agentic_x402:agentic_wallet_missing",
    };
  }

  const decoded = decodePaymentRequiredHeader(header);
  const selected = await selectBestX402Accept({
    accepts: decoded.accepts,
    payerAddress: payer.address,
    networkOverride: (env.PHALANX_X402_NETWORK ?? "").trim() || undefined,
    balanceProbe,
  });
  if (!selected.accept) {
    return {
      status: "failed",
      httpStatus: first.status,
      summary: selected.summary,
      bodyPreview: preview(firstBody),
      paymentRequiredByServer: true,
      paymentAttempted: false,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: `agentic_x402:${selected.status}`,
      receipt: {
        payerAddress: payer.address,
        payerProfileId: payer.profileId,
        payerProfileEmail: payer.profileEmail,
        payerWalletId: payer.walletId,
        walletSource: payer.walletSource,
        evaluations: selected.evaluations,
      },
    };
  }

  const paymentResult = await executePayment(
    {
      network: selected.accept.network,
      amount: selected.accept.amount,
      payTo: selected.accept.payTo,
      asset: selected.accept.asset,
      from: payer.address,
      maxTimeoutSeconds: selected.accept.maxTimeoutSeconds,
    },
    env,
  );
  if (paymentResult.status !== "completed") {
    return {
      status: "failed",
      httpStatus: first.status,
      summary: paymentResult.summary,
      bodyPreview: preview(firstBody),
      paymentRequiredByServer: true,
      paymentAttempted: true,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: `agentic_x402:payment_failed:${paymentResult.status}`,
      selection: {
        network: selected.accept.network,
        asset: selected.accept.asset,
        amount: selected.accept.amount,
        payTo: selected.accept.payTo,
        payerAddress: payer.address,
        payerProfileId: payer.profileId,
        payerProfileEmail: payer.profileEmail,
        payerWalletId: payer.walletId,
        walletSource: payer.walletSource,
      },
      receipt: {
        paymentStatus: paymentResult.status,
        paymentSummary: paymentResult.summary,
      },
    };
  }

  const parsedPayment = parseOnchainosX402PaymentStdout(paymentResult.stdout ?? "");
  if (!parsedPayment) {
    return {
      status: "failed",
      httpStatus: first.status,
      summary: "onchainos_payment_output_missing_authorization",
      bodyPreview: preview(firstBody),
      paymentRequiredByServer: true,
      paymentAttempted: true,
      paymentWrapped: false,
      paymentSettled: false,
      fetchSummary: "agentic_x402:proof_parse_failed",
    };
  }

  const proof = buildExactEvmX402PaymentProof({
    requestUrl: input.url,
    accept: selected.accept,
    payment: parsedPayment,
  });

  const replayHeaders = new Headers(init.headers ?? {});
  replayHeaders.set("X-PAYMENT", proof);
  const replay = await fetchImpl(input.url, {
    ...init,
    headers: replayHeaders,
  });
  const replayBody = await replay.text();
  const selection: AgenticX402PaymentSelection = {
    network: selected.accept.network,
    asset: selected.accept.asset,
    amount: selected.accept.amount,
    payTo: selected.accept.payTo,
    payerAddress: payer.address,
    payerProfileId: payer.profileId,
    payerProfileEmail: payer.profileEmail,
    payerWalletId: payer.walletId,
    walletSource: payer.walletSource,
  };

  return {
    status: replay.ok ? "completed" : "failed",
    httpStatus: replay.status,
    summary: replay.ok ? `http_ok:${replay.status}` : `http_error:${replay.status}`,
    bodyPreview: preview(replayBody),
    paymentRequiredByServer: true,
    paymentAttempted: true,
    paymentWrapped: true,
    paymentSettled: true,
    fetchSummary: `agentic_x402:${selected.accept.network}`,
    selection,
    receipt: {
      payerAddress: selection.payerAddress,
      payerProfileId: selection.payerProfileId,
      payerProfileEmail: selection.payerProfileEmail,
      payerWalletId: selection.payerWalletId,
      walletSource: selection.walletSource,
      selectedNetwork: selection.network,
      selectedAsset: selection.asset,
      paymentResponse: replay.headers.get("PAYMENT-RESPONSE") ?? undefined,
      paymentId: replay.headers.get("X-PAYMENT-ID") ?? undefined,
    },
  };
}
