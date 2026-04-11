/**
 * Runtime init snapshot: adapter contracts and environment hints (no host installs).
 */

import { listOnchainosCapabilities, portfolioPathContract } from "../src/adapters/onchainos.js";
import { planOmRateQuery } from "../src/adapters/omrate.js";
import { describeX402AdapterSurface, x402PaymentAwareSummary } from "../src/adapters/x402.js";
import { parseAllowlistFromEnv } from "../src/adapters/whitelist-contract.js";

import { isExecutedDirectly } from "./probe-shared.js";

export type InitSnapshot = {
  schema: "phalanx.init.v1";
  adapters: {
    onchainos: Awaited<ReturnType<typeof listOnchainosCapabilities>>;
    portfolioContract: ReturnType<typeof portfolioPathContract>;
    omrate: ReturnType<typeof planOmRateQuery>;
    x402: ReturnType<typeof describeX402AdapterSurface>;
    x402PaymentSummary: ReturnType<typeof x402PaymentAwareSummary>;
  };
  env: {
    whitelistEntries: number;
    omrateBaseConfigured: boolean;
  };
  baseline: {
    dockerReviewScripts: string[];
    notes: string[];
  };
};

export async function collectInitSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<InitSnapshot> {
  const onchainos = await listOnchainosCapabilities("base");
  return {
    schema: "phalanx.init.v1",
    adapters: {
      onchainos,
      portfolioContract: portfolioPathContract("base"),
      omrate: planOmRateQuery({ path: "/health", x402Aware: true }, env),
      x402: describeX402AdapterSurface(),
      x402PaymentSummary: x402PaymentAwareSummary({}, env),
    },
    env: {
      whitelistEntries: parseAllowlistFromEnv(env).length,
      omrateBaseConfigured: Boolean(
        (env.OMRATE_API_BASE_URL ?? env.OMRATE_API_BASE ?? "").trim(),
      ),
    },
    baseline: {
      dockerReviewScripts: ["npm run review:docker:onchainos", "npm run review:docker:uniswap"],
      notes: [
        "Host binaries may be absent; adapter calls return tool_missing instead of throwing.",
        "Third-party installs belong in Docker review flows, not silent init steps.",
      ],
    },
  };
}

async function main(): Promise<void> {
  const snap = await collectInitSnapshot();
  console.log(JSON.stringify(snap, null, 2));
}

if (isExecutedDirectly(import.meta.url)) {
  await main();
}
