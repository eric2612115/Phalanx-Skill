import { OPERATOR_CATALOG_RULES, normalizeOperatorQueryText, type RoutedOperatorFamily } from "./operator-catalog.js";

export type OperatorRouteOutcome =
  | { readonly kind: "query"; readonly family: RoutedOperatorFamily }
  | { readonly kind: "fallback" };

/**
 * Classifies operator text into a catalog family. Does not fetch data or format replies.
 */
export function classifyOperatorTelegramText(text: string): OperatorRouteOutcome {
  const normalized = normalizeOperatorQueryText(text);
  if (normalized.length === 0) {
    return { kind: "fallback" };
  }
  for (const rule of OPERATOR_CATALOG_RULES) {
    for (const needle of rule.needles) {
      if (normalized.includes(needle)) {
        return { kind: "query", family: rule.family };
      }
    }
  }
  return { kind: "fallback" };
}
