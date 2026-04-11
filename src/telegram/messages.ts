import { detectionsInString } from "../security/detectors.js";
import { redactString } from "../security/redaction.js";

export type SetupWizardStep =
  | "collect_okx"
  | "collect_wallet"
  | "collect_omrate"
  | "collect_whitelist"
  | "finalize";

/**
 * User-facing Telegram copy for setup. Never interpolate raw secrets or user-provided tokens.
 */
export function renderSetupError(code: string, detail?: string): string {
  const base = `Setup error (${code}).`;
  if (detail === undefined || detail.length === 0) {
    return base;
  }
  const spans = detectionsInString(detail);
  const safeDetail = spans.length > 0 ? redactString(detail, spans) : detail;
  return `${base} ${safeDetail}`.trim();
}

export function setupStepPrompt(step: SetupWizardStep): string {
  switch (step) {
    case "collect_okx":
      return "Step 1/5: Send your OKX API credentials in the agreed format (values are stored locally and never echoed back).";
    case "collect_wallet":
      return "Step 2/5: Send wallet identity / verification payload for the agentic wallet.";
    case "collect_omrate":
      return "Step 3/5: Send your OmRate API key.";
    case "collect_whitelist":
      return "Step 4/5: Send whitelist bootstrap payload (targets to allow).";
    case "finalize":
      return "Step 5/5: Send `confirm` to run final readiness checks and finish setup.";
    default:
      return "Unknown setup step.";
  }
}

export function ownerClaimRejectedMessage(): string {
  return "Owner claim is only allowed in a private chat with the bot.";
}

export function ownerAlreadyClaimedMessage(): string {
  return "This runtime already has an owner. Setup is not available from this chat.";
}

export function setupCompleteMessage(): string {
  return "Setup complete. The runtime is READY.";
}
