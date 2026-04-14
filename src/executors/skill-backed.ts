import type { ExecutionAdapter } from "../runtime/core.js";
import type { RuntimeIntent } from "../runtime/types.js";
import {
  executeOnchainosDefiExecution,
  executeOnchainosSwapExecution,
  resolvePhalanxExecutionWalletAddress,
} from "../adapters/onchainos.js";
import { readOperatorLpPositionDetail } from "../adapters/lp-position-query.js";
import { executeLpPositionIntent, type ExecuteLpPositionIntentHooks } from "../adapters/lp-execution.js";
import { executeSweepToOwner, executeWithdrawToOwner } from "../adapters/owner-withdraw.js";
import { type UniswapPlannerExecutionHooks, runUniswapLiquidityPlannerForPayload } from "../adapters/uniswap.js";
import { OPERATOR_LP_POSITION_DETAIL_SCOPE } from "../runtime/operator-query-scopes.js";

export interface CreateSkillBackedExecutorOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly uniswapPlannerHooks?: UniswapPlannerExecutionHooks;
  /**
   * When set, replaces only the Onchain OS managed-address lookup (used in tests).
   * `PHALANX_WALLET_ADDRESS` / `AGENT_WALLET_ADDRESS` still take precedence when set.
   */
  readonly resolveExecutionWalletAddressImpl?: (input: {
    readonly env: NodeJS.ProcessEnv;
    readonly chain: string;
  }) => Promise<string | undefined>;
  /** Injected for tests; forwards to `executeLpPositionIntent` (discovery + direct NPM withdraw). */
  readonly lpExecutionHooks?: ExecuteLpPositionIntentHooks;
}

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

type ExecutionWalletResolutionResult =
  | { readonly ok: true; readonly wallet: string }
  | {
      readonly ok: false;
      readonly mode: "execution_wallet_unresolved";
      readonly code: "EXECUTION_WALLET_UNRESOLVED";
      readonly action: string;
      readonly chain: string;
      readonly summary: string;
    };

async function resolveExecutionWalletForChain(
  env: NodeJS.ProcessEnv,
  chain: string,
  impl: CreateSkillBackedExecutorOptions["resolveExecutionWalletAddressImpl"],
): Promise<string | undefined> {
  return resolvePhalanxExecutionWalletAddress(
    { env, chain },
    impl
      ? {
          readManagedWalletAddress: async (inp) => {
            const resolved = await impl({ env: inp.env, chain: inp.chain });
            return resolved ?? null;
          },
        }
      : {},
  );
}

async function requireExecutionWalletForChain(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly chain: string;
  readonly action: string;
  readonly explicitWallet?: string;
  readonly resolveImpl: CreateSkillBackedExecutorOptions["resolveExecutionWalletAddressImpl"];
}): Promise<ExecutionWalletResolutionResult> {
  if (input.explicitWallet) {
    return { ok: true, wallet: input.explicitWallet };
  }
  const wallet = await resolveExecutionWalletForChain(input.env, input.chain, input.resolveImpl);
  if (wallet) {
    return { ok: true, wallet };
  }
  const runtimeMode = (input.env.PHALANX_RUNTIME_MODE ?? "").trim().toLowerCase();
  if (runtimeMode !== "live") {
    return { ok: true, wallet: "" };
  }
  return {
    ok: false,
    mode: "execution_wallet_unresolved",
    code: "EXECUTION_WALLET_UNRESOLVED",
    action: input.action,
    chain: input.chain,
    summary:
      "Live execution requires an explicit wallet override or a managed Onchain OS wallet address for the requested chain.",
  };
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
  const resolveWalletImpl = options.resolveExecutionWalletAddressImpl;
  const lpHooks = options.lpExecutionHooks;

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
          const walletResult = await requireExecutionWalletForChain({
            env,
            chain,
            action: intent.action,
            explicitWallet: stringField(leg.payload, "address"),
            resolveImpl: resolveWalletImpl,
          });
          if (!walletResult.ok) {
            return walletResult;
          }
          if (leg.action === "deposit") {
            const result = await executeOnchainosDefiExecution(
              {
                kind: "lending_deposit",
                investmentId: stringField(leg.payload, "investmentId") ?? "",
                address: walletResult.wallet,
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
              address: walletResult.wallet,
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

      if (
        intent.action === "getPortfolioStatus" &&
        stringField(intent.payload, "operatorScope") === OPERATOR_LP_POSITION_DETAIL_SCOPE
      ) {
        return readOperatorLpPositionDetail(intent.payload, env, {
          resolveExecutionWalletAddressImpl: resolveWalletImpl,
          ...(lpHooks ?? {}),
        });
      }

      if (intent.action === "deposit") {
        const payload = intent.payload;
        const chain = stringField(payload, "chain") ?? "ethereum";
        const walletResult = await requireExecutionWalletForChain({
          env,
          chain,
          action: intent.action,
          explicitWallet: stringField(payload, "address"),
          resolveImpl: resolveWalletImpl,
        });
        if (!walletResult.ok) {
          return walletResult;
        }
        return executeOnchainosDefiExecution(
          {
            kind: "lending_deposit",
            investmentId: stringField(payload, "investmentId") ?? "",
            address: walletResult.wallet,
            token: stringField(payload, "token") ?? "",
            amount: stringField(payload, "amount") ?? "",
            chain,
          },
          env,
        );
      }

      if (intent.action === "withdraw") {
        const payload = intent.payload;
        const chain = stringField(payload, "chain") ?? "ethereum";
        const walletResult = await requireExecutionWalletForChain({
          env,
          chain,
          action: intent.action,
          explicitWallet: stringField(payload, "address"),
          resolveImpl: resolveWalletImpl,
        });
        if (!walletResult.ok) {
          return walletResult;
        }
        return executeOnchainosDefiExecution(
          {
            kind: "lending_withdraw",
            investmentId: stringField(payload, "investmentId") ?? "",
            address: walletResult.wallet,
            chain,
            ratio: stringField(payload, "ratio"),
            amount: stringField(payload, "amount"),
            slippage: stringField(payload, "slippage"),
            tokenId: stringField(payload, "tokenId"),
            platformId: stringField(payload, "platformId"),
          },
          env,
        );
      }

      if (intent.action === "depositLpPosition" || intent.action === "withdrawLpPosition") {
        return executeLpPositionIntent(intent.action, intent.payload, env, intent.target, {
          resolveExecutionWalletAddressImpl: resolveWalletImpl,
          ...(lpHooks ?? {}),
        });
      }

      if (intent.action === "withdrawToOwner") {
        return executeWithdrawToOwner(intent.payload, env);
      }

      if (intent.action === "sweepToOwner") {
        return executeSweepToOwner(intent.payload, env);
      }

      if (intent.action === "swap") {
        const payload = intent.payload;
        const chain = stringField(payload, "chain") ?? "base";
        const walletResult = await requireExecutionWalletForChain({
          env,
          chain,
          action: intent.action,
          explicitWallet: stringField(payload, "wallet"),
          resolveImpl: resolveWalletImpl,
        });
        if (!walletResult.ok) {
          return walletResult;
        }
        return executeOnchainosSwapExecution(
          {
            fromTokenAddress: stringField(payload, "fromTokenAddress") ?? "",
            toTokenAddress: stringField(payload, "toTokenAddress") ?? "",
            chain,
            wallet: walletResult.wallet,
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
