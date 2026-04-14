import {
  buildRuntimeConfig,
  getConfigEnvValue,
  hasExecutionWalletSignal,
  hasOkxBootstrapCredentials,
  type RuntimeReadinessSummary,
} from "../config/store.js";

export type InstallCheckCategory = "operator_required" | "demo_required" | "optional" | "info";

export interface InstallCheck {
  readonly id: string;
  readonly category: InstallCheckCategory;
  readonly ok: boolean;
  readonly title: string;
  readonly detail?: string;
}

export function computeX402BaselineReady(
  values: Readonly<Record<string, string | undefined>>,
  summary: RuntimeReadinessSummary,
): boolean {
  if (summary.mode !== "live") {
    return false;
  }
  return hasOkxBootstrapCredentials(values) && hasExecutionWalletSignal(values);
}

export function runInstallChecks(
  values: Readonly<Record<string, string | undefined>>,
  summary: RuntimeReadinessSummary,
): InstallCheck[] {
  const live = summary.mode === "live";
  const cfg = buildRuntimeConfig(values);

  const checks: InstallCheck[] = [];

  const tg = getConfigEnvValue(values, "TELEGRAM_BOT_TOKEN");
  checks.push({
    id: "telegram_bot_token",
    category: "operator_required",
    ok: !!tg,
    title: "Telegram bot token",
    detail: tg ? "configured" : "set TELEGRAM_BOT_TOKEN",
  });

  const okxOk = hasOkxBootstrapCredentials(values);
  checks.push({
    id: "okx_onchainos_credentials",
    category: "operator_required",
    ok: okxOk,
    title: "OKX / onchainos API credentials",
    detail: okxOk ? "key, secret, and passphrase present" : "set OKX_API_KEY, OKX_API_SECRET, OKX_API_PASSPHRASE",
  });

  const walletOk = hasExecutionWalletSignal(values);
  checks.push({
    id: "execution_wallet_signal",
    category: "operator_required",
    ok: !live || walletOk,
    title: "Execution / agentic wallet",
    detail: walletOk
      ? "address present (AGENT_WALLET_ADDRESS, PHALANX_WALLET_ADDRESS, or TEST_WALLET_ADDRESS)"
      : live
        ? "set AGENT_WALLET_ADDRESS or PHALANX_WALLET_ADDRESS (or TEST_WALLET_ADDRESS for rehearsal)"
        : "not required in dry_run",
  });

  checks.push({
    id: "omrate_base_url_default",
    category: "info",
    ok: true,
    title: "OmRate API base",
    detail: `${cfg.omrate.baseUrl} (fixed default; optional override OMRATE_API_BASE_URL)`,
  });

  const omrateKey = getConfigEnvValue(values, "OMRATE_API_KEY");
  checks.push({
    id: "omrate_api_key",
    category: "optional",
    ok: true,
    title: "OmRate API key",
    detail: omrateKey ? "set (optional)" : "not set (optional)",
  });

  const policyOwner = getConfigEnvValue(values, "POLICY_OWNER_KEY");
  const policyAddr = getConfigEnvValue(values, "WHITELIST_POLICY_ADDRESS");
  const govOk = !!(policyOwner && policyAddr);
  checks.push({
    id: "governance_write",
    category: "optional",
    ok: true,
    title: "Governance write prerequisites",
    detail: govOk
      ? "POLICY_OWNER_KEY and WHITELIST_POLICY_ADDRESS present (optional on-chain governance enabled)"
      : "not set (optional future on-chain governance enhancement)",
  });

  const ownerEvm = getConfigEnvValue(values, "PHALANX_OWNER_EVM_ADDRESS");
  checks.push({
    id: "owner_withdraw_binding",
    category: "demo_required",
    ok: !live || !!ownerEvm,
    title: "Owner-withdraw prerequisites",
    detail: ownerEvm ? "PHALANX_OWNER_EVM_ADDRESS set" : "set PHALANX_OWNER_EVM_ADDRESS for owner-withdraw flow",
  });

  const baseRpc = getConfigEnvValue(values, "BASE_RPC_URL");
  checks.push({
    id: "base_rpc",
    category: "info",
    ok: true,
    title: "Base RPC",
    detail: `${baseRpc} (fixed default for Base execution; override BASE_RPC_URL only if needed)`,
  });

  checks.push({
    id: "xlayer_rpc_official_default",
    category: "info",
    ok: true,
    title: "X Layer RPC",
    detail: `${cfg.chain.xlayerRpcUrl} (official default unless XLAYER_RPC_URL overrides)`,
  });

  return checks;
}
