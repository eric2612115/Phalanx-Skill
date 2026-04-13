import {
  buildGuardianSnapshotFromOnchainosDeFiDetails,
  parseOnchainosDefiPositionDetail,
  parseOnchainosDefiPositionsOverview,
} from "../adapters/portfolio.js";
import type { PortfolioSnapshot } from "../adapters/portfolio.js";
import type { OnchainosDefiPositionDetail } from "../adapters/portfolio.js";
import { readOnchainosDefiPositionDetail, readOnchainosDefiPositions } from "../adapters/onchainos.js";
import { runGuardianCycle, type GuardianCycleResult } from "./cycle.js";
import type { PhalanxHost } from "../app/host.js";

export interface GuardianTickerConfig {
  readonly intervalMs: number;
  readonly driftThresholdBps?: number;
  readonly getPortfolio: () => Promise<PortfolioSnapshot>;
  readonly now: () => number;
}

export interface GuardianServiceDeps {
  readonly loadPortfolioImpl?: (env: NodeJS.ProcessEnv) => Promise<PortfolioSnapshot>;
  readonly logImpl?: (line: string) => void;
}

export function resolveGuardianPortfolioInputs(
  env: NodeJS.ProcessEnv = process.env,
): { address?: string; chain: string } {
  return {
    address: env.PHALANX_WALLET_ADDRESS?.trim() || env.TEST_WALLET_ADDRESS?.trim(),
    chain: env.PHALANX_GUARDIAN_PORTFOLIO_CHAIN?.trim() || env.PHALANX_DEFAULT_CHAIN?.trim() || "base",
  };
}

/**
 * Periodic Guardian evaluation. Runs one cycle immediately, then on each interval.
 */
export function startGuardianTicker(
  config: GuardianTickerConfig,
  onResult: (result: GuardianCycleResult) => void | Promise<void>,
): () => void {
  const drift = config.driftThresholdBps ?? 500;

  const runOnce = async () => {
    try {
      const portfolio = await config.getPortfolio();
      const result = runGuardianCycle({
        now: config.now(),
        portfolio,
        driftThresholdBps: drift,
      });
      await onResult(result);
    } catch (error) {
      console.error("[guardian] portfolio load failed", error);
    }
  };

  void runOnce();

  const handle = setInterval(() => {
    void runOnce();
  }, config.intervalMs);

  return () => clearInterval(handle);
}

export async function loadGuardianPortfolioFromOnchainos(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PortfolioSnapshot> {
  const { address, chain } = resolveGuardianPortfolioInputs(env);
  if (!address) {
    throw new Error("guardian_portfolio_wallet_address_missing");
  }

  const overview = await readOnchainosDefiPositions({
    address,
    chains: [chain],
    chain,
    env,
  });
  if (overview.status !== "completed" || !overview.stdout) {
    throw new Error(`guardian_positions_overview_unavailable:${overview.status}`);
  }

  const platforms = parseOnchainosDefiPositionsOverview(overview.stdout);
  if (platforms.length === 0) {
    throw new Error("guardian_positions_overview_empty");
  }

  const details: OnchainosDefiPositionDetail[] = [];
  for (const platform of platforms) {
    const detail = await readOnchainosDefiPositionDetail({
      address,
      chain,
      platformId: platform.analysisPlatformId,
      env,
    });
    if (detail.status !== "completed" || !detail.stdout) {
      continue;
    }
    details.push(...parseOnchainosDefiPositionDetail(detail.stdout));
  }

  const normalized = buildGuardianSnapshotFromOnchainosDeFiDetails(details, Date.now());
  if (normalized.status !== "classified") {
    throw new Error(normalized.reason);
  }
  return normalized.snapshot;
}

/**
 * Opt-in background Guardian tick (env-gated). Safe no-op when disabled.
 * When a {@link PhalanxHost} is supplied, each cycle updates structured assessment on the host
 * (see `guardian/operator-assessment.ts`) for operator queries — not parsed from Telegram text.
 */
export function maybeStartGuardianFromEnv(
  host?: PhalanxHost,
  env: NodeJS.ProcessEnv = process.env,
  deps: GuardianServiceDeps = {},
): (() => void) | undefined {
  if (env.PHALANX_GUARDIAN_ENABLED !== "1") {
    return undefined;
  }

  const raw = Number(env.PHALANX_GUARDIAN_INTERVAL_MS ?? "60000");
  const intervalMs = Number.isFinite(raw) && raw >= 5_000 ? raw : 60_000;

  return startGuardianTicker(
    {
      intervalMs,
      driftThresholdBps: 500,
      getPortfolio: async () => {
        if (deps.loadPortfolioImpl) {
          return deps.loadPortfolioImpl(env);
        }
        return loadGuardianPortfolioFromOnchainos(env);
      },
      now: () => Date.now(),
    },
    async (r) => {
      if (host) {
        await host.handleGuardianCycleResult(r);
        return;
      }
      const summary = r.items.map((i) => ({
        outcome: i.outcome,
        action: i.intent?.action,
      }));
      (deps.logImpl ?? console.log)(`[guardian] cycle ${JSON.stringify(summary)}`);
    },
  );
}
