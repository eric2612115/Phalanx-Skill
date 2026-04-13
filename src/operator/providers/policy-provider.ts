import type { PhalanxHost } from "../../app/host.js";
import type { PolicyContext } from "../../runtime/types.js";

export interface OperatorPolicySnapshot {
  readonly lifecycle: PolicyContext["lifecycle"];
  readonly executionPaused: boolean;
  readonly whitelistTargets: readonly string[];
  readonly whitelistContractConfigured: boolean;
}

export async function fetchOperatorPolicySnapshot(host: PhalanxHost): Promise<OperatorPolicySnapshot> {
  const ctx = host.getPolicyContext();
  const cfg = host.getRuntimeConfig();
  return {
    lifecycle: ctx.lifecycle,
    executionPaused: ctx.executionPaused,
    whitelistTargets: host.getEffectiveWhitelistTargets(),
    whitelistContractConfigured: Boolean(cfg.whitelist.policyAddress && cfg.whitelist.ownerKey),
  };
}
