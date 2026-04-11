import type { ExecutionAdapter } from "../runtime/core.js";
import type { RuntimeIntent } from "../runtime/types.js";
import { executeOnchainosDefiExecution, executeOnchainosSwapExecution } from "../adapters/onchainos.js";
import { type UniswapPlannerExecutionHooks, runUniswapLiquidityPlannerForPayload } from "../adapters/uniswap.js";

export interface CreateSkillBackedExecutorOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly uniswapPlannerHooks?: UniswapPlannerExecutionHooks;
}

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function governanceSummary(intent: RuntimeIntent): Record<string, unknown> {
  return {
    mode: "governance_change",
    action: intent.action,
    target: intent.target ?? null,
    payload: intent.payload,
  };
}

type RebalanceLeg = {
  readonly action: "deposit" | "withdraw";
  readonly payload: Readonly<Record<string, unknown>>;
};

function rebalanceLegs(payload: Readonly<Record<string, unknown>>): RebalanceLeg[] {
  const value = payload.operations;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const action = stringField(item, "action");
      const legPayload = item.payload;
      return action === "deposit" || action === "withdraw"
        ? {
            action,
            payload:
              legPayload && typeof legPayload === "object" ? (legPayload as Readonly<Record<string, unknown>>) : {},
          }
        : null;
    })
    .filter((item): item is RebalanceLeg => item !== null);
}

export function createSkillBackedExecutor(
  options: CreateSkillBackedExecutorOptions = {},
): ExecutionAdapter {
  const env = options.env ?? process.env;
  const uniswapPlannerHooks = options.uniswapPlannerHooks;

  return {
    async execute(intent: RuntimeIntent): Promise<unknown> {
      if (intent.action === "proposeRebalance" || intent.action === "executeRebalance") {
        const legs = rebalanceLegs(intent.payload);
        if (legs.length === 0) {
          return {
            mode: "rebalance_plan_only",
            action: intent.action,
            summary: "Rebalance intent carried rationale but no executable legs.",
            reason: stringField(intent.payload, "reason") ?? "unspecified",
            riskNotes: Array.isArray(intent.payload.riskNotes) ? intent.payload.riskNotes : [],
          };
        }

        const results: unknown[] = [];
        const txRefs: string[] = [];
        for (const leg of legs) {
          const chain = stringField(leg.payload, "chain") ?? "ethereum";
          if (leg.action === "deposit") {
            const result = await executeOnchainosDefiExecution(
              {
                kind: "lending_deposit",
                investmentId: stringField(leg.payload, "investmentId") ?? "",
                address: stringField(leg.payload, "address") ?? env.TEST_WALLET_ADDRESS ?? "",
                token: stringField(leg.payload, "token") ?? "",
                amount: stringField(leg.payload, "amount") ?? "",
                chain,
              },
              env,
            );
            results.push(result);
            txRefs.push(...(result.txRefs ?? []));
            continue;
          }
          const result = await executeOnchainosDefiExecution(
            {
              kind: "lending_withdraw",
              investmentId: stringField(leg.payload, "investmentId") ?? "",
              address: stringField(leg.payload, "address") ?? env.TEST_WALLET_ADDRESS ?? "",
              chain,
              ratio: stringField(leg.payload, "ratio"),
              amount: stringField(leg.payload, "amount"),
              slippage: stringField(leg.payload, "slippage"),
              tokenId: stringField(leg.payload, "tokenId"),
              platformId: stringField(leg.payload, "platformId"),
            },
            env,
          );
          results.push(result);
          txRefs.push(...(result.txRefs ?? []));
        }
        return {
          mode: "rebalance_executed",
          action: intent.action,
          legs: results,
          txRefs,
          summary: `Executed rebalance with ${results.length} legs`,
        };
      }

      if (intent.action === "requestWhitelistExpansion") {
        return governanceSummary(intent);
      }

      if (intent.action === "planUniswapLiquidity") {
        return runUniswapLiquidityPlannerForPayload(intent.payload, env, uniswapPlannerHooks);
      }

      if (intent.action === "deposit") {
        const payload = intent.payload;
        return executeOnchainosDefiExecution(
          {
            kind: "lending_deposit",
            investmentId: stringField(payload, "investmentId") ?? "",
            address: stringField(payload, "address") ?? env.TEST_WALLET_ADDRESS ?? "",
            token: stringField(payload, "token") ?? "",
            amount: stringField(payload, "amount") ?? "",
            chain: stringField(payload, "chain") ?? "ethereum",
          },
          env,
        );
      }

      if (intent.action === "withdraw") {
        const payload = intent.payload;
        return executeOnchainosDefiExecution(
          {
            kind: "lending_withdraw",
            investmentId: stringField(payload, "investmentId") ?? "",
            address: stringField(payload, "address") ?? env.TEST_WALLET_ADDRESS ?? "",
            chain: stringField(payload, "chain") ?? "ethereum",
            ratio: stringField(payload, "ratio"),
            amount: stringField(payload, "amount"),
            slippage: stringField(payload, "slippage"),
            tokenId: stringField(payload, "tokenId"),
            platformId: stringField(payload, "platformId"),
          },
          env,
        );
      }

      if (intent.action === "swap") {
        const payload = intent.payload;
        return executeOnchainosSwapExecution(
          {
            fromTokenAddress: stringField(payload, "fromTokenAddress") ?? "",
            toTokenAddress: stringField(payload, "toTokenAddress") ?? "",
            chain: stringField(payload, "chain") ?? "base",
            wallet: stringField(payload, "wallet") ?? env.TEST_WALLET_ADDRESS ?? "",
            amount: stringField(payload, "amount"),
            readableAmount: stringField(payload, "readableAmount"),
            slippage: stringField(payload, "slippage"),
          },
          env,
        );
      }

      return {
        mode: "skill_backed_unimplemented",
        action: intent.action,
        target: intent.target ?? null,
        payload: intent.payload,
      };
    },
  };
}
