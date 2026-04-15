import type { PhalanxHost } from "../../app/host.js";
import type { PortfolioBucketKind } from "../../adapters/portfolio.js";
import type { ExecutionMilestones } from "../../runtime/execution-evidence.js";
import type { RuntimeEvent } from "../../runtime/events.js";
import { OPERATOR_LP_POSITION_DETAIL_SCOPE } from "../../runtime/operator-query-scopes.js";

export { OPERATOR_LP_POSITION_DETAIL_SCOPE };

export interface OperatorPortfolioBucketSummary {
  readonly kind: PortfolioBucketKind | string;
  readonly currentBps: number;
  readonly targetBps: number;
}

export interface OperatorPortfolioPostActionFromRuntime {
  readonly eventId: string;
  readonly createdAt: string;
  readonly action: string;
  readonly summary: string;
  readonly walletSource?: string;
  readonly paymentSummary?: string;
  readonly milestoneLine?: string;
  readonly portfolioPushReady?: boolean;
  readonly portfolioPushSent?: boolean;
}

export type OperatorPortfolioSnapshot =
  | {
      readonly status: "ok";
      readonly source: "normalized" | "dry_run" | "unknown";
      readonly buckets: readonly OperatorPortfolioBucketSummary[];
      readonly asOf?: number;
      readonly lendingHealthScore?: number;
      readonly lpInRange?: boolean;
      readonly lpStrictRange?: boolean;
      /** Latest executed event with allocation/LP/push milestones (bounded), for post-action portfolio context. */
      readonly postActionFromRuntime?: OperatorPortfolioPostActionFromRuntime;
    }
  | {
      readonly status: "unavailable";
      readonly code: string;
      readonly message: string;
    };

export type OperatorLpPositionDetailSnapshot =
  | {
      readonly status: "ok";
      readonly chain?: string;
      readonly protocol?: string;
      readonly platformId?: string;
      readonly poolAddress: string;
      readonly tokenId: string;
      readonly token0Symbol?: string;
      readonly token1Symbol?: string;
      readonly feeTier?: string;
      readonly tickLower: number;
      readonly tickUpper: number;
      readonly currentTick?: number;
      readonly liquidity: string;
      readonly inRange: boolean;
      readonly withdrawabilitySummary: string;
      readonly withdrawable?: boolean;
      readonly platformLabel?: string;
      readonly lastUpdatedAt?: string;
    }
  | {
      readonly status: "unavailable";
      readonly code: string;
      readonly message: string;
    };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeBuckets(raw: unknown): readonly OperatorPortfolioBucketSummary[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: OperatorPortfolioBucketSummary[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const kind = row.kind;
    const currentBps = row.currentBps;
    const targetBps = row.targetBps;
    if (typeof kind !== "string" || typeof currentBps !== "number" || typeof targetBps !== "number") {
      continue;
    }
    out.push({ kind, currentBps, targetBps });
  }
  return out;
}

function hasPostActionPortfolioMilestones(m: ExecutionMilestones): boolean {
  return Boolean(
    m.portfolio_push_ready ||
      m.portfolio_push_sent ||
      m.uniswap_executed ||
      m.aave_executed ||
      m.morpho_executed ||
      m.allocation_planned,
  );
}

function findPostActionRuntimeEvent(host: PhalanxHost): RuntimeEvent | undefined {
  const events = host.getRuntimeEvents(60);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.stage !== "executed") {
      continue;
    }
    const m = e.executionEvidence?.milestones;
    if (!m || !hasPostActionPortfolioMilestones(m)) {
      continue;
    }
    return e;
  }
  return undefined;
}

function buildPostActionFromRuntime(event: RuntimeEvent): OperatorPortfolioPostActionFromRuntime {
  const ee = event.executionEvidence;
  const m = ee?.milestones;
  const milestoneLine =
    m === undefined
      ? undefined
      : (Object.entries(m) as Array<[string, boolean | undefined]>)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
          .join(",");
  return {
    eventId: event.eventId,
    createdAt: event.createdAt,
    action: event.action,
    summary: event.summary,
    walletSource: ee?.wallet?.source,
    paymentSummary: ee?.payment?.summary,
    milestoneLine: milestoneLine && milestoneLine.length > 0 ? milestoneLine : undefined,
    ...(m?.portfolio_push_ready === true ? { portfolioPushReady: true } : {}),
    ...(m?.portfolio_push_sent === true ? { portfolioPushSent: true } : {}),
  };
}

function normalizeExecutedPortfolio(adapterResult: unknown): OperatorPortfolioSnapshot {
  const r = asRecord(adapterResult);
  if (!r) {
    return { status: "ok", source: "unknown", buckets: [] };
  }
  if (r.mode === "dry_run") {
    return { status: "ok", source: "dry_run", buckets: [] };
  }
  const buckets = normalizeBuckets(r.buckets);
  if (buckets.length > 0) {
    return {
      status: "ok",
      source: "normalized",
      buckets,
      asOf: typeof r.asOf === "number" ? r.asOf : undefined,
      lendingHealthScore: typeof r.lendingHealthScore === "number" ? r.lendingHealthScore : undefined,
      lpInRange: typeof r.lpInRange === "boolean" ? r.lpInRange : undefined,
      lpStrictRange: typeof r.lpStrictRange === "boolean" ? r.lpStrictRange : undefined,
    };
  }
  return { status: "ok", source: "unknown", buckets: [] };
}

export async function fetchOperatorPortfolioSnapshot(host: PhalanxHost): Promise<OperatorPortfolioSnapshot> {
  const res = await host.invokeMcp("phalanx_portfolio", {});
  if (!res.ok) {
    return { status: "unavailable", code: res.code ?? "UNKNOWN", message: res.message };
  }
  const data = res.data as { kind?: string; adapterResult?: unknown };
  if (data.kind !== "executed") {
    return {
      status: "unavailable",
      code: "UNEXPECTED_OUTCOME",
      message: `Unexpected portfolio tool outcome: ${String(data.kind ?? "unknown")}`,
    };
  }
  const normalized = normalizeExecutedPortfolio(data.adapterResult);
  if (normalized.status !== "ok") {
    return normalized;
  }
  const postEvt = findPostActionRuntimeEvent(host);
  if (!postEvt) {
    return normalized;
  }
  return { ...normalized, postActionFromRuntime: buildPostActionFromRuntime(postEvt) };
}

function readStringField(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key];
  if (typeof v === "string" && v.trim().length > 0) {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return undefined;
}

function readIntField(row: Record<string, unknown>, key: string): number | undefined {
  const v = row[key];
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function readBooleanField(row: Record<string, unknown>, key: string): boolean | undefined {
  const v = row[key];
  return typeof v === "boolean" ? v : undefined;
}

function inferProtocol(platformLabel: string | undefined, platformId: string | undefined): string | undefined {
  const haystack = `${platformLabel ?? ""} ${platformId ?? ""}`.trim().toLowerCase();
  if (haystack.includes("uniswap")) return "uniswap-v3";
  if (haystack.includes("pancake")) return "pancakeswap-v3";
  if (haystack.includes("aerodrome")) return "aerodrome";
  if (haystack.includes("curve")) return "curve";
  if (haystack.includes("sushi")) return "sushiswap";
  if (haystack.includes("velodrome")) return "velodrome";
  return undefined;
}

function normalizeLpPositionDetail(adapterResult: unknown): OperatorLpPositionDetailSnapshot {
  const r = asRecord(adapterResult);
  if (!r) {
    return { status: "unavailable", code: "NO_DETAIL", message: "No LP position detail in adapter result." };
  }
  if (r.mode === "dry_run") {
    return { status: "unavailable", code: "DRY_RUN", message: "LP position detail is not available in dry-run mode." };
  }
  const detail = asRecord(r.lpPositionDetail);
  if (!detail) {
    return { status: "unavailable", code: "MISSING_LP_DETAIL", message: "Adapter did not return lpPositionDetail." };
  }
  const poolAddress = readStringField(detail, "poolAddress");
  const tokenId = readStringField(detail, "tokenId");
  const tickLower = readIntField(detail, "tickLower");
  const tickUpper = readIntField(detail, "tickUpper");
  const liquidity = readStringField(detail, "liquidity");
  const withdrawabilitySummary = readStringField(detail, "withdrawabilitySummary");
  const inRange = detail.inRange;
  const chain = readStringField(r, "chain");
  const platformId = readStringField(r, "platformId");
  const platformLabel = readStringField(detail, "platformLabel");
  const protocol = readStringField(detail, "protocol") ?? readStringField(r, "protocol") ?? inferProtocol(platformLabel, platformId);
  const token0Symbol = readStringField(detail, "token0Symbol");
  const token1Symbol = readStringField(detail, "token1Symbol");
  const feeTier = readStringField(detail, "feeTier");
  const withdrawable = readBooleanField(detail, "withdrawable");
  const currentTick = readIntField(detail, "currentTick");
  const lastUpdatedAt = readStringField(detail, "lastUpdatedAt");
  if (
    !poolAddress ||
    !tokenId ||
    tickLower === undefined ||
    tickUpper === undefined ||
    !liquidity ||
    typeof inRange !== "boolean" ||
    !withdrawabilitySummary
  ) {
    return {
      status: "unavailable",
      code: "INVALID_LP_DETAIL",
      message: "lpPositionDetail is present but missing required fields.",
    };
  }
  return {
    status: "ok",
    ...(chain ? { chain } : {}),
    ...(protocol ? { protocol } : {}),
    ...(platformId ? { platformId } : {}),
    poolAddress,
    tokenId,
    ...(token0Symbol ? { token0Symbol } : {}),
    ...(token1Symbol ? { token1Symbol } : {}),
    ...(feeTier ? { feeTier } : {}),
    tickLower,
    tickUpper,
    ...(currentTick !== undefined ? { currentTick } : {}),
    liquidity,
    inRange,
    withdrawabilitySummary,
    ...(withdrawable !== undefined ? { withdrawable } : {}),
    ...(platformLabel ? { platformLabel } : {}),
    ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
  };
}

/**
 * Single bounded read: active LP NFT / tick range / liquidity / in-range / withdraw hint via portfolio tool payload.
 */
export async function fetchOperatorLpPositionDetailSnapshot(host: PhalanxHost): Promise<OperatorLpPositionDetailSnapshot> {
  const res = await host.invokeMcp("phalanx_portfolio", {
    payload: { operatorScope: OPERATOR_LP_POSITION_DETAIL_SCOPE },
  });
  if (!res.ok) {
    return { status: "unavailable", code: res.code ?? "UNKNOWN", message: res.message };
  }
  const data = res.data as { kind?: string; adapterResult?: unknown };
  if (data.kind !== "executed") {
    return {
      status: "unavailable",
      code: "UNEXPECTED_OUTCOME",
      message: `Unexpected portfolio tool outcome: ${String(data.kind ?? "unknown")}`,
    };
  }
  return normalizeLpPositionDetail(data.adapterResult);
}
