import { detectionsInString } from "../security/detectors.js";
import { redactString } from "../security/redaction.js";

export type SetupWizardStep =
  | "collect_login_email"
  | "collect_okx"
  | "collect_omrate"
  | "bootstrap_wallet"
  | "confirm_funding"
  | "offer_allocate";

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
    case "collect_login_email":
      return "Step 1/6: Send the OKX TEE agentic wallet login email. This email is used for future login, and you will need to check OTP there before wallet bootstrap can finish.";
    case "collect_okx":
      return "Step 2/6: Send your OKX API credentials in the agreed format (values are stored locally and never echoed back).";
    case "collect_omrate":
      return "Step 3/6: Send `OMRATE_API_KEY=<value>` or `skip`. Skipping keeps the x402-required path testable.";
    case "bootstrap_wallet":
      return "Step 4/6: Reply `continue` after checking the OTP inbox. AgentPhalanx will try to confirm the managed wallet address and record it locally.";
    case "confirm_funding":
      return "Step 5/6: Fund the managed wallet, then reply `funded` when assets are ready for live execution.";
    case "offer_allocate":
      return "Step 6/6: Reply `allocate_now` to continue into allocation-oriented operation, or `skip` to finish setup without auto-allocation.";
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
