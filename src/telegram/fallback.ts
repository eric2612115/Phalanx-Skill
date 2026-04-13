import { OPERATOR_FAMILY_LABELS, ROUTED_OPERATOR_FAMILIES } from "./operator-catalog.js";

/**
 * Boundary replies for unsupported READY-state text (not a general chat assistant).
 */
export function buildOperatorFallbackReply(): string {
  const capabilityLines = ROUTED_OPERATOR_FAMILIES.map((family) => `• ${OPERATOR_FAMILY_LABELS[family]}`);
  return [
    "Phalanx operator queries use keyword routing only (bounded catalog, not open chat).",
    "",
    "Include one of these themes in your message:",
    ...capabilityLines,
    "",
    "Setup, owner claim, and inline approval buttons are unchanged.",
  ].join("\n");
}
