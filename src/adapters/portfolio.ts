/**
 * Normalized portfolio view for Guardian and read paths (contract-level; no live chain I/O).
 */

export type PortfolioBucketKind = "lending" | "lp";

export interface PortfolioBucketState {
  readonly kind: PortfolioBucketKind;
  /** Observed bucket weight in basis points (two buckets typically sum to 10_000). */
  readonly currentBps: number;
  /** Strategy target for this bucket in basis points. */
  readonly targetBps: number;
}

export interface PortfolioSignals {
  readonly lendingHealthScore?: number;
  readonly lpInRange?: boolean;
  readonly lpStrictRange?: boolean;
}

export interface PortfolioSnapshot {
  readonly buckets: readonly PortfolioBucketState[];
  readonly asOf: number;
  readonly lendingHealthScore?: number;
  readonly lpInRange?: boolean;
  readonly lpStrictRange?: boolean;
}

export interface OnchainosDefiPlatformOverview {
  readonly analysisPlatformId: string;
  readonly platformName: string;
  readonly currencyAmount: string;
}

export interface OnchainosDefiPositionDetail {
  readonly analysisPlatformId: string;
  readonly platformName: string;
  readonly investType: string;
  readonly totalValue: string;
}

export type GuardianPortfolioNormalizationResult =
  | { readonly status: "classified"; readonly snapshot: PortfolioSnapshot }
  | { readonly status: "insufficient_data"; readonly reason: string };

export type PortfolioAdapterPlan = {
  readonly provider: "portfolio";
  readonly status: "planned" | "tool_missing";
  readonly summary: string;
  readonly readSource: "normalized_stub" | "onchainos_cli_template";
};

/**
 * Describes how a full portfolio read would be sourced; execution stays behind probes/onchainos.
 */
export function planPortfolioRead(): PortfolioAdapterPlan {
  return {
    provider: "portfolio",
    status: "planned",
    summary:
      "Portfolio reads should aggregate lending and LP buckets via approved adapter paths (e.g. onchainos templates); this module only carries normalized snapshot types.",
    readSource: "normalized_stub",
  };
}

export function buildPortfolioSnapshot(
  buckets: readonly PortfolioBucketState[],
  asOf: number,
  signals?: PortfolioSignals,
): PortfolioSnapshot {
  return {
    buckets,
    asOf,
    ...(signals?.lendingHealthScore !== undefined ? { lendingHealthScore: signals.lendingHealthScore } : {}),
    ...(signals?.lpInRange !== undefined ? { lpInRange: signals.lpInRange } : {}),
    ...(signals?.lpStrictRange !== undefined ? { lpStrictRange: signals.lpStrictRange } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function parseOnchainosDefiPositionsOverview(stdout: string): OnchainosDefiPlatformOverview[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = asRecord(parsed);
    const data = asRecord(root?.data);
    const walletIdPlatformList = Array.isArray(data?.walletIdPlatformList) ? data.walletIdPlatformList : [];
    return walletIdPlatformList
      .flatMap((walletEntry) => {
        const entry = asRecord(walletEntry);
        return Array.isArray(entry?.platformList) ? entry.platformList : [];
      })
      .map((platform) => {
        const entry = asRecord(platform);
        return {
          analysisPlatformId: stringField(entry, "analysisPlatformId") ?? "",
          platformName: stringField(entry, "platformName") ?? "",
          currencyAmount: stringField(entry, "currencyAmount") ?? "",
        };
      })
      .filter((platform) => platform.analysisPlatformId.length > 0);
  } catch {
    return [];
  }
}

export function parseOnchainosDefiPositionDetail(stdout: string): OnchainosDefiPositionDetail[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = asRecord(parsed);
    const rawData = root?.data;
    const details = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];
    return details.flatMap((detail) => {
      const data = asRecord(detail);
      const analysisPlatformId = stringField(data, "analysisPlatformId") ?? "";
      const platformName = stringField(data, "platformName") ?? "";
      const walletIdPlatformDetailList = Array.isArray(data?.walletIdPlatformDetailList) ? data.walletIdPlatformDetailList : [];
      return walletIdPlatformDetailList
        .flatMap((walletEntry) => {
          const entry = asRecord(walletEntry);
          return Array.isArray(entry?.networkHoldVoList) ? entry.networkHoldVoList : [];
        })
        .flatMap((networkHold) => {
          const entry = asRecord(networkHold);
          return Array.isArray(entry?.investTokenBalanceVoList) ? entry.investTokenBalanceVoList : [];
        })
        .map((position) => {
          const entry = asRecord(position);
          return {
            analysisPlatformId,
            platformName,
            investType: stringField(entry, "investType") ?? "",
            totalValue: stringField(entry, "totalValue") ?? "0",
          };
        })
        .filter((position) => position.investType.length > 0);
    });
  } catch {
    return [];
  }
}

function classifyInvestTypeToBucket(investType: string): PortfolioBucketKind | undefined {
  switch (investType) {
    case "1":
    case "4":
    case "5":
      return "lending";
    case "2":
    case "3":
      return "lp";
    default:
      return undefined;
  }
}

export function buildGuardianSnapshotFromOnchainosDeFiDetails(
  details: readonly OnchainosDefiPositionDetail[],
  asOf: number,
): GuardianPortfolioNormalizationResult {
  let lendingUsd = 0;
  let lpUsd = 0;
  for (const detail of details) {
    const bucket = classifyInvestTypeToBucket(detail.investType);
    const totalValue = numberField({ totalValue: detail.totalValue }, "totalValue") ?? 0;
    if (!bucket || totalValue <= 0) {
      continue;
    }
    if (bucket === "lending") {
      lendingUsd += totalValue;
    } else {
      lpUsd += totalValue;
    }
  }
  const total = lendingUsd + lpUsd;
  if (total <= 0) {
    return {
      status: "insufficient_data",
      reason: "official_positions_missing_classified_bucket_values",
    };
  }
  return {
    status: "classified",
    snapshot: buildPortfolioSnapshot(
      [
        { kind: "lending", currentBps: Math.round((lendingUsd / total) * 10_000), targetBps: 5_000 },
        { kind: "lp", currentBps: Math.round((lpUsd / total) * 10_000), targetBps: 5_000 },
      ],
      asOf,
    ),
  };
}
