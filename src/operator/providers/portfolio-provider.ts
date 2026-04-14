import type { PhalanxHost } from "../../app/host.js";
import type { PortfolioBucketKind } from "../../adapters/portfolio.js";
import { OPERATOR_LP_POSITION_DETAIL_SCOPE } from "../../runtime/operator-query-scopes.js";

export { OPERATOR_LP_POSITION_DETAIL_SCOPE };

export interface OperatorPortfolioBucketSummary {
  readonly kind: PortfolioBucketKind | string;
  readonly currentBps: number;
  readonly targetBps: number;
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
    }
  | {
      readonly status: "unavailable";
      readonly code: string;
      readonly message: string;
    };

export type OperatorLpPositionDetailSnapshot =
  | {
      readonly status: "ok";
      readonly poolAddress: string;
      readonly tokenId: string;
      readonly tickLower: number;
      readonly tickUpper: number;
      readonly liquidity: string;
      readonly inRange: boolean;
      readonly withdrawabilitySummary: string;
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
  return normalizeExecutedPortfolio(data.adapterResult);
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
    poolAddress,
    tokenId,
    tickLower,
    tickUpper,
    liquidity,
    inRange,
    withdrawabilitySummary,
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
