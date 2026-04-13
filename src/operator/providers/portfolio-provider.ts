import type { PhalanxHost } from "../../app/host.js";
import type { PortfolioBucketKind } from "../../adapters/portfolio.js";

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
