import { OPERATOR_FAMILY_LABELS, ROUTED_OPERATOR_FAMILIES } from "./operator-catalog.js";
import {
  buildOperatorStartReply as buildOperatorStartReplyFromFaq,
  buildTelegramFaqReply as buildTelegramFaqReplyFromFaq,
  buildTelegramStartKeyboardRows as buildTelegramStartKeyboardRowsFromFaq,
} from "./faq.js";

/**
 * True for Telegram-style `/help`, optional `@botname` suffix, or plain `help` (private chat only — caller enforces).
 */
export function isOperatorHelpCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0) {
    return false;
  }
  if (t === "help") {
    return true;
  }
  return /^\/help(@[a-z0-9_]+)?$/.test(t);
}

/**
 * True for Telegram-style `/start`, optional `@botname` suffix, or plain `start` (private chat only — caller enforces).
 */
export function isOperatorStartCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0) {
    return false;
  }
  if (t === "start") {
    return true;
  }
  return /^\/start(@[a-z0-9_]+)?$/.test(t);
}

export function buildOperatorStartReply(): string {
  return buildOperatorStartReplyFromFaq();
}

export function buildTelegramFaqReply(text: string): string | undefined {
  return buildTelegramFaqReplyFromFaq(text);
}

export function buildTelegramStartKeyboardRows(): string[][] {
  return buildTelegramStartKeyboardRowsFromFaq();
}

export function buildPreReadyOperatorShortcutReply(): string {
  return [
    "Claim first, then finish setup before using READY-state operator shortcuts like `status`, `portfolio`, or `x402 summary`.",
    "",
    "Use `/start` for onboarding + FAQ, then complete `/claim` in this private chat.",
  ].join("\n");
}

/**
 * Static onboarding copy for private chats (not LLM-generated; no conversational routing).
 */
export function buildOperatorHelpReply(): string {
  const queryLines = ROUTED_OPERATOR_FAMILIES.map((family) => `• ${OPERATOR_FAMILY_LABELS[family]}`);
  return [
    "AgentPhalanx — private operator channel",
    "",
    "What it is: a local-first, self-custodial action-plane runtime for X Layer–oriented DeFi. This bot sends setup/claim prompts, approval buttons, and a fixed catalog of status queries. It is not an open-ended chat assistant.",
    "",
    "First run (full checklist: `README.md` + `docs/live-demo-runbook.md`):",
    "• `git clone` → `npm install` → `npm run init`",
    "• Fill only the human-required fields in `config.env`",
    "• Enable the demo/runtime switches you need in `service.env` (for example `PHALANX_RUNTIME_MODE=live` and any demo flags from the runbook)",
    "• Start the runtime (`npm run dev` or your usual host command)",
    "• Open a private chat with this bot, send `/claim`, then `confirm` when asked",
    "• Confirm `TELEGRAM_ALLOWED_USER_ID` in `config.env` matches your Telegram user id",
    "• Run `npm run smoke:live`, then `npm run smoke:deposit-mainline` or `npm run smoke:allocation-mainline` when prerequisites are met",
    "",
    "After lifecycle is READY, each operator message must include one of these keyword themes (same bounded catalog as fallback text):",
    ...queryLines,
    "",
    "Routing is keyword-only today; re-send `/help` or plain `help` in this private chat anytime for this summary.",
    "",
    "Setup, `/claim`, `confirm`, and inline approval flows are unchanged.",
  ].join("\n");
}

/**
 * Boundary replies for unsupported READY-state text (not a general chat assistant).
 */
export function buildOperatorFallbackReply(): string {
  const capabilityLines = ROUTED_OPERATOR_FAMILIES.map((family) => `• ${OPERATOR_FAMILY_LABELS[family]}`);
  return [
    "AgentPhalanx operator queries use keyword routing only (bounded catalog, not open chat).",
    "",
    "Send `/help` (or plain `help`) in this private chat for the full overview.",
    "",
    "Include one of these themes in your message:",
    ...capabilityLines,
    "",
    "Setup, owner claim, and inline approval buttons are unchanged.",
  ].join("\n");
}
