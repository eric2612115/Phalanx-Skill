/**
 * x402 payment layer adapter: structured summaries plus optional @x402/fetch wrapping when EVM scheme deps exist.
 * Without @x402/evm (or a compatible scheme package), payment wrapping degrades to plain fetch — no throw.
 */

import { privateKeyToAccount } from "viem/accounts";

import { getExecutionWalletAddress, hasExecutionWalletSignal, hasOkxBootstrapCredentials } from "../config/store.js";

export type X402AdapterSurface = {
  provider: "x402";
  layers: readonly ["payment", "fetch"];
  notes: string[];
};

export type X402PaymentAwareSummaryInput = {
  resource?: string;
};

export type X402PaymentAwareSummary = {
  provider: "x402";
  status: "unsupported" | "tool_missing" | "planned" | "degraded";
  paymentLayer: "x402" | "none";
  summary: string;
  resource?: string;
  /** When payment wrap is explicitly requested via env, reflects whether scheme module is likely loadable. */
  schemeModuleHint?: "default_evm" | "custom";
};

export type X402FetchResolution = {
  readonly paymentWrapped: boolean;
  readonly fetchImpl: typeof fetch;
  readonly summary: string;
};

/** Normalized optional HTTP probe using the same payment resolution as OmRate execution. */
export type X402HttpProbeResult = {
  readonly provider: "x402";
  readonly status: "skipped" | "completed" | "failed";
  readonly httpStatus?: number;
  readonly summary: string;
  readonly bodyPreview?: string;
  readonly paymentWrapped: boolean;
  readonly fetchSummary: string;
};

export type X402AcceptOption = {
  readonly scheme: string;
  readonly network: string;
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds?: number;
  readonly extra?: Record<string, unknown>;
};

export type X402PaymentRequiredPayload = {
  readonly x402Version: number;
  readonly accepts: readonly X402AcceptOption[];
};

export type OnchainosX402Authorization = {
  readonly from: string;
  readonly nonce: string;
  readonly to: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly value: string;
};

export type OnchainosX402PaymentFields = {
  readonly authorization: OnchainosX402Authorization;
  readonly signature: string;
};

export type BuildExactEvmX402PaymentProofInput = {
  readonly requestUrl: string;
  readonly accept: X402AcceptOption;
  readonly payment: OnchainosX402PaymentFields;
  readonly description?: string;
  readonly mimeType?: string;
};

function parseJsonRecord(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function decodePaymentRequiredHeader(encoded: string): X402PaymentRequiredPayload {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const parsed = parseJsonRecord(decoded);
  if (!parsed || !Array.isArray(parsed.accepts) || typeof parsed.x402Version !== "number") {
    throw new Error("Invalid PAYMENT-REQUIRED header payload");
  }
  return parsed as unknown as X402PaymentRequiredPayload;
}

export function parseOnchainosX402PaymentStdout(stdout: string): OnchainosX402PaymentFields | null {
  const parsed = parseJsonRecord(stdout);
  const data =
    parsed?.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : undefined;
  const authorization =
    data?.authorization && typeof data.authorization === "object"
      ? (data.authorization as Record<string, unknown>)
      : undefined;
  const signature = typeof data?.signature === "string" ? data.signature : undefined;
  if (!authorization || !signature) {
    return null;
  }
  const requiredFields = ["from", "nonce", "to", "validAfter", "validBefore", "value"] as const;
  if (requiredFields.some((field) => typeof authorization[field] !== "string")) {
    return null;
  }
  return {
    authorization: authorization as unknown as OnchainosX402Authorization,
    signature,
  };
}

export function buildExactEvmX402PaymentProof(input: BuildExactEvmX402PaymentProofInput): string {
  const chainIndex = input.accept.network.split(":")[1];
  if (!chainIndex) {
    throw new Error(`Unsupported x402 network: ${input.accept.network}`);
  }
  return Buffer.from(
    JSON.stringify({
      x402Version: 1,
      chainIndex,
      paymentPayload: {
        x402Version: 1,
        scheme: input.accept.scheme,
        network: input.accept.network,
        payload: {
          signature: input.payment.signature,
          authorization: input.payment.authorization,
        },
      },
      paymentRequirements: {
        scheme: input.accept.scheme,
        network: input.accept.network,
        maxAmountRequired: input.accept.amount,
        payTo: input.accept.payTo,
        asset: input.accept.asset,
        maxTimeoutSeconds: input.accept.maxTimeoutSeconds,
        resource: input.requestUrl,
        description: input.description ?? "OmRate premium API access",
        mimeType: input.mimeType ?? "application/json",
        extra: input.accept.extra ?? {},
      },
    }),
    "utf8",
  ).toString("base64");
}

function normalizeHexKey(raw: string): `0x${string}` | null {
  const t = raw.trim();
  if (!t) return null;
  const with0x = t.startsWith("0x") ? t : `0x${t}`;
  if (with0x.length < 66) return null;
  return with0x as `0x${string}`;
}

export function describeX402AdapterSurface(): X402AdapterSurface {
  return {
    provider: "x402",
    layers: ["payment", "fetch"],
    notes: [
      "Programmatic verification belongs in Docker review probes; adapters return structured status instead of installing tooling on the host.",
      "Execution may wrap fetch with @x402/fetch when PHALANX_X402_PAYMENT_ENABLED=1 and an EVM scheme package (default @x402/evm) is resolvable.",
    ],
  };
}

function paymentExplicitlyEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.PHALANX_X402_PAYMENT_ENABLED ?? "").trim() === "1";
}

function privateKeyFallbackExplicitlyEnabled(env: NodeJS.ProcessEnv): boolean {
  return (env.PHALANX_X402_FORCE_FETCH_WRAP ?? "").trim() === "1";
}

/**
 * Sync summary for payment-gated resources (no network). Reflects env toggles only.
 */
export function x402PaymentAwareSummary(
  input: X402PaymentAwareSummaryInput = {},
  env: NodeJS.ProcessEnv = process.env,
): X402PaymentAwareSummary {
  if (!paymentExplicitlyEnabled(env)) {
    return {
      provider: "x402",
      status: "unsupported",
      paymentLayer: "x402",
      summary:
        "x402 payment wrap disabled (set PHALANX_X402_PAYMENT_ENABLED=1 plus private key and scheme package to enable).",
      ...(input.resource ? { resource: input.resource } : {}),
    };
  }

  const activeWalletAddress = getExecutionWalletAddress(env);
  if (hasOkxBootstrapCredentials(env) && hasExecutionWalletSignal(env)) {
    return {
      provider: "x402",
      status: "planned",
      paymentLayer: "x402",
      summary: activeWalletAddress
        ? "x402 agentic payment requested; runtime will use the active Agentic wallet and Onchain OS for PAYMENT-REQUIRED replays."
        : "x402 agentic payment requested; runtime has OKX bootstrap credentials and will resolve the active wallet before replaying PAYMENT-REQUIRED responses.",
      ...(input.resource ? { resource: input.resource } : {}),
    };
  }

  const pk = normalizeHexKey(env.PHALANX_X402_PRIVATE_KEY ?? env.X402_PRIVATE_KEY ?? "");
  if (pk && privateKeyFallbackExplicitlyEnabled(env)) {
    return {
      provider: "x402",
      status: "planned",
      paymentLayer: "x402",
      summary:
        "x402 private-key fetch wrapping is explicitly enabled for debugging; production mainline should prefer the active Agentic wallet path.",
      schemeModuleHint: (env.PHALANX_X402_EVM_PACKAGE ?? "").trim() ? "custom" : "default_evm",
      ...(input.resource ? { resource: input.resource } : {}),
    };
  }

  return {
    provider: "x402",
    status: "tool_missing",
    paymentLayer: "x402",
    summary:
      "x402 payment is enabled but runtime lacks an active Agentic wallet / OKX bootstrap path. Configure OKX credentials plus an active wallet registry (or use explicit debug fetch wrapping).",
    ...(input.resource ? { resource: input.resource } : {}),
  };
}

/**
 * Resolve fetch for HTTP clients. Uses @x402/fetch only when payment is enabled and scheme stack loads.
 * Always returns a callable fetch (plain global fetch on any failure path).
 */
export async function resolvePaymentAwareFetch(
  env: NodeJS.ProcessEnv = process.env,
  baseFetch: typeof fetch = globalThis.fetch,
): Promise<X402FetchResolution> {
  if (!paymentExplicitlyEnabled(env)) {
    return {
      paymentWrapped: false,
      fetchImpl: baseFetch,
      summary: "plain_fetch:payment_disabled",
    };
  }

  const pk = normalizeHexKey(env.PHALANX_X402_PRIVATE_KEY ?? env.X402_PRIVATE_KEY ?? "");
  if (!pk) {
    return {
      paymentWrapped: false,
      fetchImpl: baseFetch,
      summary: "plain_fetch:missing_private_key",
    };
  }

  const spec = (env.PHALANX_X402_EVM_PACKAGE ?? "@x402/evm").trim() || "@x402/evm";
  const network = (env.PHALANX_X402_NETWORK ?? "eip155:8453").trim() || "eip155:8453";

  try {
    const evm = (await import(spec)) as Record<string, unknown>;
    const ExactEvmScheme = (evm.ExactEvmScheme ?? evm.default) as
      | (new (signer: unknown) => unknown)
      | undefined;
    const { x402Client, x402HTTPClient } = await import("@x402/core/client");
    const { wrapFetchWithPayment } = await import("@x402/fetch");

    if (typeof ExactEvmScheme !== "function") {
      return {
        paymentWrapped: false,
        fetchImpl: baseFetch,
        summary: `plain_fetch:scheme_export_missing:${spec}`,
      };
    }

    const account = privateKeyToAccount(pk);
    const schemeClient = new ExactEvmScheme(account);
    const client = new x402Client().register(network as never, schemeClient as never);
    const httpClient = new x402HTTPClient(client);
    const wrapped = wrapFetchWithPayment(baseFetch, httpClient);

    return {
      paymentWrapped: true,
      fetchImpl: wrapped,
      summary: `x402_wrapped_fetch:${network}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      paymentWrapped: false,
      fetchImpl: baseFetch,
      summary: `plain_fetch:scheme_or_wrap_failed:${msg.replace(/\s+/g, " ").slice(0, 200)}`,
    };
  }
}

function previewHttpBody(text: string, max = 600): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * When sync summary is `planned`, verify that dynamic imports and wrap actually succeed.
 * Keeps @x402/fetch usage inside `resolvePaymentAwareFetch` (dynamic) so missing peer deps degrade safely.
 */
export async function assessX402PaymentReadiness(
  env: NodeJS.ProcessEnv = process.env,
  baseFetch: typeof fetch = globalThis.fetch,
): Promise<X402PaymentAwareSummary> {
  const sync = x402PaymentAwareSummary({}, env);
  if (sync.status !== "planned") return sync;
  if (!privateKeyFallbackExplicitlyEnabled(env)) {
    return sync;
  }

  const r = await resolvePaymentAwareFetch(env, baseFetch);
  if (r.paymentWrapped) {
    return {
      ...sync,
      status: "planned",
      summary: `x402_ready:${r.summary}`,
    };
  }

  return {
    ...sync,
    status: "degraded",
    summary: `x402_degraded:${r.summary}`,
  };
}

/**
 * Generic HTTP GET/POST with optional x402 wrapping when `paymentMode` is `auto` (default).
 * Does not throw; returns a normalized surface for probes and adapters.
 */
export async function probeHttpWithOptionalX402Payment(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    readonly method?: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly timeoutMs?: number;
    /** `plain` skips `resolvePaymentAwareFetch` entirely. */
    readonly paymentMode?: "auto" | "plain";
    readonly fetch?: typeof fetch;
  },
): Promise<X402HttpProbeResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      provider: "x402",
      status: "skipped",
      summary: "empty_url",
      paymentWrapped: false,
      fetchSummary: "no_fetch",
    };
  }

  const baseFetch = options?.fetch ?? globalThis.fetch;
  const mode = options?.paymentMode ?? "auto";
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? 30_000);

  let fetchImpl: typeof fetch;
  let paymentWrapped: boolean;
  let fetchSummary: string;
  if (mode === "plain") {
    fetchImpl = baseFetch;
    paymentWrapped = false;
    fetchSummary = "plain_fetch:forced_mode";
  } else {
    const r = await resolvePaymentAwareFetch(env, baseFetch);
    fetchImpl = r.fetchImpl;
    paymentWrapped = r.paymentWrapped;
    fetchSummary = r.summary;
  }

  const method = options?.method ?? "GET";
  const init: RequestInit = {
    method,
    headers: { Accept: "application/json", ...(options?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (method === "POST" && options?.body !== undefined) {
    init.body = options.body;
    init.headers = {
      ...((init.headers as Record<string, string>) ?? {}),
      "Content-Type": "application/json",
    };
  }

  try {
    const res = await fetchImpl(trimmed, init);
    const text = await res.text();
    const preview = previewHttpBody(text);
    return {
      provider: "x402",
      status: res.ok ? "completed" : "failed",
      httpStatus: res.status,
      summary: res.ok ? `http_ok:${res.status}` : `http_error:${res.status}`,
      ...(preview.length > 0 ? { bodyPreview: preview } : {}),
      paymentWrapped,
      fetchSummary,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const summary = previewHttpBody(`fetch_failed:${msg}`, 240);
    return {
      provider: "x402",
      status: "failed",
      summary: summary.length > 0 ? summary : "fetch_failed",
      paymentWrapped,
      fetchSummary,
    };
  }
}
