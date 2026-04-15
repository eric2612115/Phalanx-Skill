/**
 * Bounded operator query surface: keyword families only (no open-ended NL routing).
 */

export const ROUTED_OPERATOR_FAMILIES = [
  "readiness_pending",
  "lp_position_detail",
  "portfolio_balances",
  "recent_events",
  "why_blocked_next",
  "runtime_execution_context",
  "whitelist_policy",
  "risk_guardian",
  "wallets_binding",
] as const;

export type RoutedOperatorFamily = (typeof ROUTED_OPERATOR_FAMILIES)[number];

export interface OperatorCatalogRule {
  readonly family: RoutedOperatorFamily;
  /** Longer / more specific needles should appear earlier within each family. */
  readonly needles: readonly string[];
}

export const OPERATOR_FAMILY_LABELS: Readonly<Record<RoutedOperatorFamily, string>> = {
  readiness_pending: "readiness / status / pending approvals",
  lp_position_detail: "LP position detail (pool, ticks, liquidity, withdraw hint)",
  portfolio_balances: "portfolio / balances / positions / allocation",
  recent_events: "recent events / guardian actions / tx or correlation refs",
  why_blocked_next: "why blocked / what next",
  runtime_execution_context: "wallet + x402/payment evidence from latest runtime event",
  whitelist_policy: "whitelist / allowlist / policy summary",
  risk_guardian: "risk summary / guardian assessment",
  wallets_binding: "owner wallet / agent wallet / binding summary",
};

/**
 * First substring match across rules (top to bottom) and needles (left to right) wins.
 */
export const OPERATOR_CATALOG_RULES: readonly OperatorCatalogRule[] = [
  {
    family: "why_blocked_next",
    needles: [
      "what should i do",
      "what next",
      "whats next",
      "why am i blocked",
      "why did this block",
      "why blocked",
    ],
  },
  {
    family: "runtime_execution_context",
    needles: [
      "execution context summary",
      "runtime wallet payment",
      "wallet source evidence",
      "x402 summary",
      "payment summary",
    ],
  },
  {
    family: "readiness_pending",
    needles: [
      "pending approvals",
      "pending approval",
      "awaiting approval",
      "approval queue",
      "ready state",
      "readiness",
      "system status",
      "health check",
      "status",
    ],
  },
  {
    family: "lp_position_detail",
    needles: [
      "lp position detail",
      "lp position",
      "liquidity position detail",
      "liquidity position",
      "v3 position detail",
      "nft position detail",
      "uniswap v3 position",
      "uniswap position",
      "ticks and liquidity",
      "pool tick range",
    ],
  },
  {
    family: "portfolio_balances",
    needles: [
      "portfolio",
      "balances",
      "balance",
      "positions",
      "position",
      "allocation",
      "buckets",
      "bucket",
    ],
  },
  {
    family: "recent_events",
    needles: [
      "recent events",
      "runtime events",
      "event log",
      "guardian action",
      "show events",
      "transactions",
      "transaction",
      "tx ref",
      "correlation",
      "activity",
      "events",
    ],
  },
  {
    family: "whitelist_policy",
    needles: [
      "current whitelist",
      "policy summary",
      "allowed targets",
      "allowlist",
      "whitelist",
      "policy",
    ],
  },
  {
    family: "risk_guardian",
    needles: [
      "risk summary",
      "guardian assessment",
      "last assessment",
      "risk rules",
      "rule order",
      "risk context",
      "risk",
      "assessment",
    ],
  },
  {
    family: "wallets_binding",
    needles: [
      "binding summary",
      "telegram binding",
      "owner wallet",
      "agent wallet",
      "wallet summary",
      "binding",
    ],
  },
];

export function normalizeOperatorQueryText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
