import type { PhalanxHost } from "../app/host.js";
import { fetchOperatorBindingSnapshot } from "../operator/providers/binding-provider.js";
import { fetchOperatorEventSnapshot } from "../operator/providers/event-provider.js";
import { fetchOperatorExplainSnapshot } from "../operator/providers/explain-provider.js";
import { fetchOperatorPolicySnapshot } from "../operator/providers/policy-provider.js";
import { fetchOperatorPortfolioSnapshot } from "../operator/providers/portfolio-provider.js";
import { fetchOperatorRiskSnapshot } from "../operator/providers/risk-provider.js";
import { fetchOperatorStatusSnapshot } from "../operator/providers/status-provider.js";
import type { RoutedOperatorFamily } from "./operator-catalog.js";

export type OperatorQueryPayload =
  | { readonly family: "readiness_pending"; readonly snapshot: Awaited<ReturnType<typeof fetchOperatorStatusSnapshot>> }
  | { readonly family: "portfolio_balances"; readonly snapshot: Awaited<ReturnType<typeof fetchOperatorPortfolioSnapshot>> }
  | { readonly family: "recent_events"; readonly snapshot: Awaited<ReturnType<typeof fetchOperatorEventSnapshot>> }
  | { readonly family: "why_blocked_next"; readonly snapshot: Awaited<ReturnType<typeof fetchOperatorExplainSnapshot>> }
  | { readonly family: "whitelist_policy"; readonly snapshot: Awaited<ReturnType<typeof fetchOperatorPolicySnapshot>> }
  | { readonly family: "risk_guardian"; readonly snapshot: Awaited<ReturnType<typeof fetchOperatorRiskSnapshot>> }
  | { readonly family: "wallets_binding"; readonly snapshot: Awaited<ReturnType<typeof fetchOperatorBindingSnapshot>> };

export async function runOperatorQuery(host: PhalanxHost, family: RoutedOperatorFamily): Promise<OperatorQueryPayload> {
  switch (family) {
    case "readiness_pending":
      return { family, snapshot: await fetchOperatorStatusSnapshot(host) };
    case "portfolio_balances":
      return { family, snapshot: await fetchOperatorPortfolioSnapshot(host) };
    case "recent_events":
      return { family, snapshot: await fetchOperatorEventSnapshot(host, { limit: 40 }) };
    case "why_blocked_next":
      return { family, snapshot: await fetchOperatorExplainSnapshot(host) };
    case "whitelist_policy":
      return { family, snapshot: await fetchOperatorPolicySnapshot(host) };
    case "risk_guardian":
      return { family, snapshot: await fetchOperatorRiskSnapshot(host) };
    case "wallets_binding":
      return { family, snapshot: await fetchOperatorBindingSnapshot(host) };
  }
}
