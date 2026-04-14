import { resolve } from "node:path";

import { ConfigStore, resolveServiceConfigPath } from "../config/store.js";
import { writeWhitelistContractAllowance } from "../adapters/whitelist-contract.js";
import { extractRuntimeTxRefs } from "../runtime/events.js";
import type { ExecutionAdapter } from "../runtime/core.js";
import type { RuntimeIntent } from "../runtime/types.js";
import { WhitelistPolicy } from "../policy/whitelist-policy.js";

export interface GovernanceAwareExecutorOptions {
  readonly baseExecutor: ExecutionAdapter;
  readonly whitelistPolicy: WhitelistPolicy;
  readonly env?: NodeJS.ProcessEnv;
  readonly governanceWriteImpl?: typeof writeWhitelistContractAllowance;
}

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseResumeIntent(payload: Readonly<Record<string, unknown>>): RuntimeIntent | undefined {
  const value = payload.originalIntent;
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const intent = value as Record<string, unknown>;
  if (
    typeof intent.id !== "string" ||
    typeof intent.action !== "string" ||
    typeof intent.lane !== "string" ||
    typeof intent.entrySource !== "string" ||
    !intent.payload ||
    typeof intent.payload !== "object"
  ) {
    return undefined;
  }
  return {
    id: intent.id,
    action: intent.action,
    lane: intent.lane as RuntimeIntent["lane"],
    entrySource: intent.entrySource as RuntimeIntent["entrySource"],
    payload: intent.payload as Readonly<Record<string, unknown>>,
    target: typeof intent.target === "string" ? intent.target : undefined,
  };
}

function resolvePolicyItemTarget(
  intent: RuntimeIntent,
): string | undefined {
  return (
    stringField(intent.payload, "target") ??
    parseResumeIntent(intent.payload)?.target
  );
}

function resolveChainTarget(
  intent: RuntimeIntent,
): string | undefined {
  return (
    stringField(intent.payload, "contractAddress") ??
    stringField(intent.payload, "targetAddress") ??
    stringField(intent.payload, "executionTarget") ??
    stringField(intent.payload, "poolAddress") ??
    stringField(intent.payload, "target")
  );
}

function persistWhitelistTarget(target: string, env: NodeJS.ProcessEnv): void {
  const configPath = env.PHALANX_CONFIG_PATH?.trim();
  if (!configPath) {
    return;
  }
  const store = new ConfigStore(resolveServiceConfigPath(resolve(configPath), env));
  const current = new Set(
    ((store.getSnapshot().values.WHITELIST_TARGETS ?? "").split(",") as string[])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  current.add(target);
  store.updateValidated({ WHITELIST_TARGETS: [...current].sort((a, b) => a.localeCompare(b)).join(",") }, () => null);
}

function governanceWriteConfigured(
  env: NodeJS.ProcessEnv,
  hasInjectedWriteImpl: boolean,
): boolean {
  if (hasInjectedWriteImpl) {
    return true;
  }
  const ownerKey = (env.POLICY_OWNER_KEY ?? "").trim();
  const policyAddress = (env.WHITELIST_POLICY_ADDRESS ?? env.PHALANX_WHITELIST_CONTRACT_ADDRESS ?? "").trim();
  return ownerKey.length > 0 && policyAddress.length > 0;
}

export function createGovernanceAwareExecutor(
  options: GovernanceAwareExecutorOptions,
): ExecutionAdapter {
  const env = options.env ?? process.env;
  const governanceWrite = options.governanceWriteImpl ?? writeWhitelistContractAllowance;
  const allowChainWrite = governanceWriteConfigured(env, options.governanceWriteImpl !== undefined);
  return {
    async execute(intent: RuntimeIntent): Promise<unknown> {
      if (intent.action !== "requestWhitelistExpansion") {
        return options.baseExecutor.execute(intent);
      }

      const policyItemTarget = resolvePolicyItemTarget(intent);
      const chainTarget = resolveChainTarget(intent);
      const localWhitelistTarget = policyItemTarget ?? chainTarget;
      if (!localWhitelistTarget) {
        return {
          mode: "whitelist_governance_failed",
          summary: "No target was provided for whitelist expansion.",
        };
      }
      options.whitelistPolicy.addTarget(localWhitelistTarget);
      persistWhitelistTarget(localWhitelistTarget, env);

      const governanceWriteResult =
        allowChainWrite && chainTarget ? await governanceWrite(chainTarget, true, env) : undefined;

      const originalIntent = parseResumeIntent(intent.payload);
      const resumedResult = originalIntent ? await options.baseExecutor.execute(originalIntent) : undefined;
      const txRefs = [
        ...(governanceWriteResult?.status === "completed" && governanceWriteResult.txHash
          ? [governanceWriteResult.txHash]
          : []),
        ...(resumedResult ? (extractRuntimeTxRefs(resumedResult) ?? []) : []),
      ];

      return {
        mode: governanceWriteResult?.status === "completed" ? "whitelist_governance_completed" : "whitelist_local_completed",
        summary: originalIntent
          ? governanceWriteResult?.status === "completed"
            ? "Whitelist updated and the original action resumed."
            : "Local whitelist updated and the original action resumed."
          : governanceWriteResult?.status === "completed"
            ? "Whitelist updated."
            : "Local whitelist updated.",
        ...(governanceWriteResult ? { governanceWrite: governanceWriteResult } : {}),
        target: localWhitelistTarget,
        chainTarget,
        resumedAction: originalIntent?.action,
        resumedResult,
        txRefs,
      };
    },
  };
}
