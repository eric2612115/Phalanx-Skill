/**
 * OmRate backend query planning and optional live fetch. x402-aware execution uses resolvePaymentAwareFetch.
 */

import { probeHttpWithOptionalX402Payment, resolvePaymentAwareFetch, x402PaymentAwareSummary } from "./x402.js";

export type OmRateQueryPlanInput = {
  path: string;
  method?: "GET" | "POST";
  /** When true, downstream fetch should use an x402 payment-capable client. */
  x402Aware?: boolean;
  /** JSON body for POST when provided. */
  bodyJson?: unknown;
};

export type OmRateQueryPlan = {
  provider: "omrate";
  status: "planned" | "tool_missing" | "unsupported";
  summary: string;
  x402: {
    required: boolean;
    note: string;
  };
  request: {
    baseUrlEnv: "OMRATE_API_BASE" | "OMRATE_API_BASE_URL" | "AUTH_BACKEND_PUBLIC_URL";
    resolvedBase?: string;
    path: string;
    method: string;
  };
};

export type OmRateQueryExecutionResult = {
  provider: "omrate";
  status: "skipped" | "completed" | "failed";
  httpStatus?: number;
  summary: string;
  bodyPreview?: string;
  fetchSummary?: string;
  x402Requested: boolean;
  x402BaselineReady: boolean;
  paymentRequiredByServer?: boolean;
  paymentWrapped?: boolean;
};

/** Sync snapshot of env-driven OmRate readiness (no network). */
export type OmRateAdapterEnvSummary = {
  readonly provider: "omrate";
  readonly baseConfigured: boolean;
  readonly baseUrlEnv?: OmRateQueryPlan["request"]["baseUrlEnv"];
  readonly apiKeyConfigured: boolean;
  readonly summary: string;
};

function resolveOmrateBase(
  env: NodeJS.ProcessEnv,
): { base: string; baseUrlEnv: OmRateQueryPlan["request"]["baseUrlEnv"] } | null {
  const a = (env.OMRATE_API_BASE_URL ?? "").trim();
  if (a) return { base: a.replace(/\/$/, ""), baseUrlEnv: "OMRATE_API_BASE_URL" };
  const b = (env.OMRATE_API_BASE ?? "").trim();
  if (b) return { base: b.replace(/\/$/, ""), baseUrlEnv: "OMRATE_API_BASE" };
  const c = (env.AUTH_BACKEND_PUBLIC_URL ?? "").trim();
  if (c) return { base: c.replace(/\/$/, ""), baseUrlEnv: "AUTH_BACKEND_PUBLIC_URL" };
  return null;
}

export function summarizeOmRateAdapterEnv(env: NodeJS.ProcessEnv = process.env): OmRateAdapterEnvSummary {
  const resolved = resolveOmrateBase(env);
  const apiKeyConfigured = (env.OMRATE_API_KEY ?? "").trim().length > 0;
  if (!resolved) {
    return {
      provider: "omrate",
      baseConfigured: false,
      apiKeyConfigured,
      summary:
        "OmRate API base is not configured; set OMRATE_API_BASE_URL, OMRATE_API_BASE, or AUTH_BACKEND_PUBLIC_URL for live HTTP paths.",
    };
  }
  return {
    provider: "omrate",
    baseConfigured: true,
    baseUrlEnv: resolved.baseUrlEnv,
    apiKeyConfigured,
    summary: `OmRate base URL resolved from ${resolved.baseUrlEnv}${apiKeyConfigured ? "; API key is set" : "; API key omitted (optional)"}.`,
  };
}

/** Lightweight GET probe against the configured OmRate base (optional x402 wrapping). */
export type OmRateHttpProbeResult = {
  readonly provider: "omrate";
  readonly status: "skipped" | "completed" | "failed";
  readonly summary: string;
  readonly httpStatus?: number;
  readonly bodyPreview?: string;
  readonly x402Requested: boolean;
  readonly x402BaselineReady: boolean;
  readonly paymentRequiredByServer?: boolean;
  readonly paymentWrapped: boolean;
  readonly fetchSummary: string;
  readonly env: OmRateAdapterEnvSummary;
};

export async function probeOmRateHttp(
  input: { readonly path: string; readonly x402Aware?: boolean },
  env: NodeJS.ProcessEnv = process.env,
  options?: { readonly timeoutMs?: number; readonly fetch?: typeof fetch },
): Promise<OmRateHttpProbeResult> {
  const envSummary = summarizeOmRateAdapterEnv(env);
  const plan = planOmRateQuery(
    { path: input.path, method: "GET", x402Aware: input.x402Aware },
    env,
  );
  if (plan.status !== "planned" || !plan.request.resolvedBase) {
    return {
      provider: "omrate",
      status: "skipped",
      summary: plan.summary,
      x402Requested: Boolean(input.x402Aware),
      x402BaselineReady: omrateX402BaselineReady(env, Boolean(input.x402Aware)),
      paymentWrapped: false,
      fetchSummary: "omrate_base_unconfigured",
      env: envSummary,
    };
  }

  const url = `${plan.request.resolvedBase}${plan.request.path}`;
  const headers: Record<string, string> = {};
  const apiKey = (env.OMRATE_API_KEY ?? "").trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  const p = await probeHttpWithOptionalX402Payment(url, env, {
    method: "GET",
    headers,
    timeoutMs: options?.timeoutMs,
    paymentMode: input.x402Aware ? "auto" : "plain",
    fetch: options?.fetch,
  });

  return {
    provider: "omrate",
    status: p.status,
    summary: p.summary,
    httpStatus: p.httpStatus,
    bodyPreview: p.bodyPreview,
    x402Requested: Boolean(input.x402Aware),
    x402BaselineReady: omrateX402BaselineReady(env, Boolean(input.x402Aware)),
    paymentRequiredByServer: p.httpStatus === 402 ? true : undefined,
    paymentWrapped: p.paymentWrapped,
    fetchSummary: p.fetchSummary,
    env: envSummary,
  };
}

export function planOmRateQuery(
  input: OmRateQueryPlanInput,
  env: NodeJS.ProcessEnv = process.env,
): OmRateQueryPlan {
  const method = input.method ?? "GET";
  const resolved = resolveOmrateBase(env);

  if (!resolved) {
    return {
      provider: "omrate",
      status: "tool_missing",
      summary:
        "OMRATE_API_BASE_URL, OMRATE_API_BASE, or AUTH_BACKEND_PUBLIC_URL is not set; configure OmRate API base before live queries.",
      x402: {
        required: Boolean(input.x402Aware),
        note: input.x402Aware
          ? "x402 payment may be required once a base URL is configured; use payment-aware fetch at execution time."
          : "x402 not requested for this plan.",
      },
      request: {
        baseUrlEnv: "OMRATE_API_BASE_URL",
        path: input.path,
        method,
      },
    };
  }

  const pathNorm = input.path.startsWith("/") ? input.path : `/${input.path}`;

  return {
    provider: "omrate",
    status: "planned",
    summary: "Query plan ready; execution uses fetch with optional x402 wrapping when enabled.",
    x402: {
      required: Boolean(input.x402Aware),
      note: input.x402Aware
        ? "resolvePaymentAwareFetch selects @x402/fetch when PHALANX_X402_PAYMENT_ENABLED=1 and scheme deps resolve."
        : "Standard fetch; x402 wrap not requested.",
    },
    request: {
      baseUrlEnv: resolved.baseUrlEnv,
      resolvedBase: resolved.base,
      path: pathNorm,
      method,
    },
  };
}

function previewBody(text: string, max = 800): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function omrateX402BaselineReady(env: NodeJS.ProcessEnv, x402Aware: boolean): boolean {
  if (!x402Aware) {
    return false;
  }
  const s = x402PaymentAwareSummary({}, env);
  return s.status === "planned" || s.status === "degraded";
}

/**
 * Perform the planned HTTP request when the plan is executable; otherwise returns skipped with summary.
 */
export async function executeOmRateQuery(
  input: OmRateQueryPlanInput,
  env: NodeJS.ProcessEnv = process.env,
  options?: { timeoutMs?: number; fetch?: typeof fetch },
): Promise<OmRateQueryExecutionResult> {
  const plan = planOmRateQuery(input, env);
  if (plan.status !== "planned" || !plan.request.resolvedBase) {
    return {
      provider: "omrate",
      status: "skipped",
      summary: plan.summary,
      x402Requested: Boolean(input.x402Aware),
      x402BaselineReady: omrateX402BaselineReady(env, Boolean(input.x402Aware)),
    };
  }

  const url = `${plan.request.resolvedBase}${plan.request.path}`;
  const apiKey = (env.OMRATE_API_KEY ?? "").trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, "X-API-Key": apiKey } : {}),
  };

  const { fetchImpl, paymentWrapped, summary: fetchSummary } = await resolvePaymentAwareFetch(
    env,
    options?.fetch ?? globalThis.fetch,
  );
  const fetchFn = input.x402Aware ? fetchImpl : (options?.fetch ?? globalThis.fetch);
  const effectivePaymentWrapped = Boolean(input.x402Aware && paymentWrapped);

  const method = plan.request.method;
  const init: RequestInit = {
    method,
    headers,
    signal: options?.timeoutMs
      ? AbortSignal.timeout(Math.max(1_000, options.timeoutMs))
      : undefined,
  };

  if (method === "POST" && input.bodyJson !== undefined) {
    init.headers = { ...headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(input.bodyJson);
  }

  try {
    const res = await fetchFn(url, init);
    const text = await res.text();
    const bodyPreview = previewBody(text);

    const status = res.ok ? "completed" : "failed";
    const fs = input.x402Aware ? fetchSummary : "plain_fetch:x402_not_requested";
    const pw = input.x402Aware ? effectivePaymentWrapped : false;
    return {
      provider: "omrate",
      status,
      httpStatus: res.status,
      summary: res.ok
        ? `http_ok:${res.status}`
        : `http_error:${res.status}:${previewBody(res.statusText || "error", 120)}`,
      bodyPreview: bodyPreview.length > 0 ? bodyPreview : undefined,
      x402Requested: Boolean(input.x402Aware),
      x402BaselineReady: omrateX402BaselineReady(env, Boolean(input.x402Aware)),
      paymentRequiredByServer: res.status === 402 ? true : undefined,
      fetchSummary: fs,
      paymentWrapped: pw,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fs = input.x402Aware ? fetchSummary : "plain_fetch:x402_not_requested";
    const pw = input.x402Aware ? effectivePaymentWrapped : false;
    return {
      provider: "omrate",
      status: "failed",
      summary: `fetch_failed:${previewBody(msg, 200)}`,
      x402Requested: Boolean(input.x402Aware),
      x402BaselineReady: omrateX402BaselineReady(env, Boolean(input.x402Aware)),
      fetchSummary: fs,
      paymentWrapped: pw,
    };
  }
}
