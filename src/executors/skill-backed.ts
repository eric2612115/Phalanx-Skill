import type { ExecutionAdapter } from "../runtime/core.js";
import type { RuntimeIntent } from "../runtime/types.js";
import {
  executeOnchainosDefiExecution,
  executeOnchainosSwapExecution,
  readOnchainosManagedWalletAddress,
  resolvePhalanxExecutionWalletAddress,
} from "../adapters/onchainos.js";
import {
  mergeExecutionMilestones,
  normalizeWalletEvidence,
  type ExecutionEvidence,
  type ExecutionMilestones,
  type WalletEvidence,
} from "../runtime/execution-evidence.js";
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
  | { readonly ok: true; readonly wallet: string; readonly walletEvidence: WalletEvidence }
  | {
      readonly ok: false;
      readonly mode: "execution_wallet_unresolved";
      readonly code: "EXECUTION_WALLET_UNRESOLVED";
      readonly action: string;
      readonly chain: string;
      readonly summary: string;
      readonly walletEvidence: WalletEvidence;
    };

function trimEnvWalletOverride(env: NodeJS.ProcessEnv): string | undefined {
  const a = (env.PHALANX_WALLET_ADDRESS ?? "").trim();
  const b = (env.AGENT_WALLET_ADDRESS ?? "").trim();
  return a || b || undefined;
}

function chainWalletMilestones(executionWallet: string): ExecutionMilestones {
  return { wallet_resolved: executionWallet.trim().length > 0 };
}

function reconcileWalletEvidence(walletEvidence: WalletEvidence, executionWallet: string): WalletEvidence {
  const effectiveAddress = executionWallet.trim() || walletEvidence.resolvedAddress.trim();
  if (effectiveAddress === walletEvidence.resolvedAddress) {
    return walletEvidence;
  }
  return {
    ...walletEvidence,
    resolvedAddress: effectiveAddress,
    reason:
      walletEvidence.reason === "runtime_execution_wallet_selected"
        ? walletEvidence.reason
        : "runtime_execution_wallet_selected",
  };
}

function withExecutionEvidence<T extends Record<string, unknown>>(
  result: T,
  walletEvidence: WalletEvidence,
  executionWallet: string,
  ...extraMilestones: ExecutionMilestones[]
): T & { executionEvidence: ExecutionEvidence } {
  const consistentWalletEvidence = reconcileWalletEvidence(walletEvidence, executionWallet);
  const effectiveAddress = consistentWalletEvidence.resolvedAddress.trim();
  return {
    ...result,
    executionEvidence: {
      wallet: consistentWalletEvidence,
      milestones: mergeExecutionMilestones(chainWalletMilestones(effectiveAddress), ...extraMilestones),
    },
  };
}

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

async function readManagedWalletForEvidence(
  env: NodeJS.ProcessEnv,
  chain: string,
  impl: CreateSkillBackedExecutorOptions["resolveExecutionWalletAddressImpl"] | undefined,
): Promise<string | undefined> {
  if (impl) {
    return impl({ env, chain });
  }
  const r = await readOnchainosManagedWalletAddress({ chain, env });
  return r ?? undefined;
}

async function requireExecutionWalletForChain(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly chain: string;
  readonly action: string;
  readonly explicitWallet?: string;
  readonly resolveImpl: CreateSkillBackedExecutorOptions["resolveExecutionWalletAddressImpl"];
}): Promise<ExecutionWalletResolutionResult> {
  const liveMode = (input.env.PHALANX_RUNTIME_MODE ?? "").trim().toLowerCase() === "live";
  const envOverride = trimEnvWalletOverride(input.env);
  const payloadExplicit = input.explicitWallet?.trim() || undefined;
  const testFallback = (input.env.TEST_WALLET_ADDRESS ?? "").trim() || undefined;

  let managed: string | undefined;
  if (!envOverride) {
    managed = await readManagedWalletForEvidence(input.env, input.chain, input.resolveImpl);
  }

  const walletEvidence = normalizeWalletEvidence({
    liveMode,
    chain: input.chain,
    managedAddress: managed,
    explicitOverride: envOverride,
    explicitPayload: payloadExplicit,
    testFallback,
  });

  if (payloadExplicit) {
    return { ok: true, wallet: payloadExplicit, walletEvidence };
  }
  if (envOverride) {
    return { ok: true, wallet: envOverride, walletEvidence };
  }
  if (managed) {
    return { ok: true, wallet: managed, walletEvidence };
  }
  const wallet = await resolveExecutionWalletForChain(input.env, input.chain, input.resolveImpl);
  if (wallet) {
    return { ok: true, wallet, walletEvidence };
  }
  if (!liveMode) {
    return { ok: true, wallet: "", walletEvidence };
  }
  return {
    ok: false,
    mode: "execution_wallet_unresolved",
    code: "EXECUTION_WALLET_UNRESOLVED",
    action: input.action,
    chain: input.chain,
    summary:
      "Live execution prefers an Onchain OS managed wallet for this chain. PHALANX_WALLET_ADDRESS / AGENT_WALLET_ADDRESS are optional override-only pins for troubleshooting, not the default execution path.",
    walletEvidence,
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
        let rebalanceExecutionEvidence: ExecutionEvidence | undefined;
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
            return {
              mode: walletResult.mode,
              code: walletResult.code,
              action: walletResult.action,
              chain: walletResult.chain,
              summary: walletResult.summary,
              executionEvidence: {
                wallet: walletResult.walletEvidence,
                milestones: mergeExecutionMilestones({ wallet_resolved: false }),
              },
            };
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
                platformId: stringField(leg.payload, "platformId"),
              },
              env,
            );
            const segment = stringField(leg.payload, "_allocationSegment");
            const wrapped = withExecutionEvidence(
              {
                ...(result as Record<string, unknown>),
                ...(segment ? { allocationSegment: segment } : {}),
              },
              walletResult.walletEvidence,
              walletResult.wallet,
            );
            if (!rebalanceExecutionEvidence) {
              rebalanceExecutionEvidence = wrapped.executionEvidence;
            }
            results.push(wrapped);
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
          const wrapped = withExecutionEvidence(
            { ...(result as Record<string, unknown>) },
            walletResult.walletEvidence,
            walletResult.wallet,
          );
          if (!rebalanceExecutionEvidence) {
            rebalanceExecutionEvidence = wrapped.executionEvidence;
          }
          results.push(wrapped);
          txRefs.push(...(result.txRefs ?? []));
        }
        return {
          mode: "rebalance_executed",
          action: intent.action,
          legs: results,
          txRefs,
          summary: `Executed rebalance with ${results.length} legs`,
          ...(rebalanceExecutionEvidence ? { executionEvidence: rebalanceExecutionEvidence } : {}),
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
        const detail = await readOperatorLpPositionDetail(intent.payload, env, {
          resolveExecutionWalletAddressImpl: resolveWalletImpl,
          ...(lpHooks ?? {}),
        });
        const chain =
          stringField(intent.payload, "chain")?.trim() ||
          ((env.PHALANX_DEFAULT_CHAIN ?? "").trim() || "base");
        const walletResult = await requireExecutionWalletForChain({
          env,
          chain,
          action: intent.action,
          explicitWallet: stringField(intent.payload, "address"),
          resolveImpl: resolveWalletImpl,
        });
        const executionAddr =
          walletResult.ok && walletResult.wallet.trim().length > 0
            ? walletResult.wallet
            : typeof detail === "object" &&
                detail !== null &&
                "address" in detail &&
                typeof (detail as Record<string, unknown>).address === "string"
              ? String((detail as Record<string, unknown>).address)
              : walletResult.walletEvidence.resolvedAddress;
        if (detail && typeof detail === "object") {
          return withExecutionEvidence(
            { ...(detail as Record<string, unknown>) },
            walletResult.walletEvidence,
            executionAddr,
          );
        }
        return detail;
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
          return {
            mode: walletResult.mode,
            code: walletResult.code,
            action: walletResult.action,
            chain: walletResult.chain,
            summary: walletResult.summary,
            executionEvidence: {
              wallet: walletResult.walletEvidence,
              milestones: mergeExecutionMilestones({ wallet_resolved: false }),
            },
          };
        }
        const depositResult = await executeOnchainosDefiExecution(
          {
            kind: "lending_deposit",
            investmentId: stringField(payload, "investmentId") ?? "",
            address: walletResult.wallet,
            token: stringField(payload, "token") ?? "",
            amount: stringField(payload, "amount") ?? "",
            chain,
            platformId: stringField(payload, "platformId"),
          },
          env,
        );
        return withExecutionEvidence(
          { ...(depositResult as Record<string, unknown>) },
          walletResult.walletEvidence,
          walletResult.wallet,
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
          return {
            mode: walletResult.mode,
            code: walletResult.code,
            action: walletResult.action,
            chain: walletResult.chain,
            summary: walletResult.summary,
            executionEvidence: {
              wallet: walletResult.walletEvidence,
              milestones: mergeExecutionMilestones({ wallet_resolved: false }),
            },
          };
        }
        const withdrawResult = await executeOnchainosDefiExecution(
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
        return withExecutionEvidence(
          { ...(withdrawResult as Record<string, unknown>) },
          walletResult.walletEvidence,
          walletResult.wallet,
        );
      }

      if (intent.action === "depositLpPosition" || intent.action === "withdrawLpPosition") {
        const chain = stringField(intent.payload, "chain") ?? "ethereum";
        const walletResult = await requireExecutionWalletForChain({
          env,
          chain,
          action: intent.action,
          explicitWallet: stringField(intent.payload, "address"),
          resolveImpl: resolveWalletImpl,
        });
        if (!walletResult.ok) {
          return {
            mode: walletResult.mode,
            code: walletResult.code,
            action: walletResult.action,
            chain: walletResult.chain,
            summary: walletResult.summary,
            executionEvidence: {
              wallet: walletResult.walletEvidence,
              milestones: mergeExecutionMilestones({ wallet_resolved: false }),
            },
          };
        }
        const lpResult = await executeLpPositionIntent(intent.action, intent.payload, env, intent.target, {
          resolveExecutionWalletAddressImpl: resolveWalletImpl,
          ...(lpHooks ?? {}),
        });
        if (lpResult && typeof lpResult === "object" && "provider" in lpResult && lpResult.provider === "onchainos") {
          return withExecutionEvidence(
            { ...(lpResult as Record<string, unknown>) },
            walletResult.walletEvidence,
            walletResult.wallet,
          );
        }
        return {
          ...(lpResult as Record<string, unknown>),
          executionEvidence: {
            wallet: walletResult.walletEvidence,
            milestones: mergeExecutionMilestones(chainWalletMilestones(walletResult.wallet)),
          },
        };
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
          return {
            mode: walletResult.mode,
            code: walletResult.code,
            action: walletResult.action,
            chain: walletResult.chain,
            summary: walletResult.summary,
            executionEvidence: {
              wallet: walletResult.walletEvidence,
              milestones: mergeExecutionMilestones({ wallet_resolved: false }),
            },
          };
        }
        const swapResult = await executeOnchainosSwapExecution(
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
        return withExecutionEvidence(
          { ...(swapResult as Record<string, unknown>) },
          walletResult.walletEvidence,
          walletResult.wallet,
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
