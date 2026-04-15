export interface TelegramFaqSource {
  readonly path: string;
  readonly note: string;
}

export interface TelegramFaqEntry {
  readonly id: string;
  readonly title: string;
  readonly prompts: readonly string[];
  readonly bullets: readonly string[];
  readonly sources: readonly TelegramFaqSource[];
}

function normalizeFaqPrompt(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?!.,]/g, "");
}

export const TELEGRAM_START_KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ["/claim", "What is AgentPhalanx?"],
  ["Why OKX API trio?", "Why can OMRATE_API_KEY be skipped?"],
  ["What is OKX login email?", "Why is OTP required?"],
  ["How is wallet address recorded?", "status"],
  ["portfolio", "x402 summary"],
] as const;

const FAQ_SOURCES = {
  readme: {
    path: "README.md",
    note: "Install flow, config split, and optional OmRate/x402 guidance.",
  },
  runbook: {
    path: "docs/live-demo-runbook.md",
    note: "First-run path, runtime prerequisites, and live-demo operator steps.",
  },
  configExample: {
    path: "config.env.example",
    note: "User-facing config keys and Telegram/bootstrap annotations.",
  },
} satisfies Record<string, TelegramFaqSource>;

export const TELEGRAM_FAQ_ENTRIES: readonly TelegramFaqEntry[] = [
  {
    id: "agentphalanx_intro",
    title: "What is AgentPhalanx?",
    prompts: ["what is agentphalanx", "what is agent phalanx"],
    bullets: [
      "AgentPhalanx is the local-first, self-custodial action-plane runtime in this repo. It handles setup prompts, approvals, wallet/execution orchestration, and bounded operator queries.",
      "Telegram is the operator surface for claim/setup/approval/status, but it is not an open-ended chat assistant.",
      "The implementation still lives in the `Phalanx-Skill` repository for compatibility with existing tooling and `PHALANX_*` config keys.",
    ],
    sources: [FAQ_SOURCES.readme, FAQ_SOURCES.runbook],
  },
  {
    id: "okx_api_trio",
    title: "Why OKX API trio?",
    prompts: ["why okx api trio", "why do i need okx api trio", "okx api trio"],
    bullets: [
      "For the live AgentPhalanx operator path, `OKX_API_KEY`, `OKX_API_SECRET`, and `OKX_API_PASSPHRASE` are the operator-required credentials that let the runtime talk to the OKX / Onchain OS execution path.",
      "Some isolated planner or read-only flows may work without them, but the onboarding/live execution story assumes the OKX trio is present.",
      "The trio belongs to the Telegram/operator onboarding path, not to the public FAQ or runtime-event surfaces.",
    ],
    sources: [FAQ_SOURCES.readme, FAQ_SOURCES.runbook, FAQ_SOURCES.configExample],
  },
  {
    id: "omrate_optional",
    title: "Why can OMRATE_API_KEY be skipped?",
    prompts: [
      "why can omrate_api_key be skipped",
      "why can omrate api key be skipped",
      "why is omrate api key optional",
      "omrate api key optional",
    ],
    bullets: [
      "`OMRATE_API_KEY` stays optional so the operator can still test the `x402 required` path instead of pre-authorizing every OmRate call.",
      "When the key is missing, the runtime should still surface whether payment became required, attempted, wrapped, and settled in the x402 summary.",
      "Skipping the key does not mean OmRate disappears; it means payment visibility remains part of the observable story.",
    ],
    sources: [FAQ_SOURCES.readme, FAQ_SOURCES.runbook],
  },
  {
    id: "okx_login_email",
    title: "What is OKX login email?",
    prompts: [
      "what is okx login email",
      "what is okx agentic wallet login email",
      "okx tee login email",
    ],
    bullets: [
      "`OKX_AGENTIC_WALLET_LOGIN_EMAIL` is the login account for the OKX TEE agentic wallet flow. It is not just a one-time setup field.",
      "The same email is needed again when the user wants to log back into that agentic wallet set in the future.",
      "Because future operators may create multiple agentic wallets, the resulting wallet addresses should be recorded after successful bootstrap.",
    ],
    sources: [FAQ_SOURCES.runbook, FAQ_SOURCES.configExample],
  },
  {
    id: "otp_required",
    title: "Why is OTP required?",
    prompts: ["why is otp required", "why otp required", "otp required"],
    bullets: [
      "The operator must check email and complete the OTP step, otherwise the OKX TEE wallet bootstrap/login flow cannot finish successfully.",
      "Without OTP completion, AgentPhalanx should treat wallet creation/login as incomplete rather than pretending the wallet exists.",
      "This requirement belongs to onboarding guidance and should be visible in Telegram, not hidden in terminal-only steps.",
    ],
    sources: [FAQ_SOURCES.runbook, FAQ_SOURCES.readme],
  },
  {
    id: "wallet_recording",
    title: "How is wallet address recorded?",
    prompts: [
      "how is wallet address recorded",
      "how is the wallet address recorded",
      "wallet address recorded",
    ],
    bullets: [
      "After managed-wallet bootstrap succeeds, the resulting agentic wallet address should be shown to the user and persisted as a trackable local record.",
      "That record supports later operator summaries and future multi-wallet management instead of losing the first wallet after setup.",
      "`AGENT_WALLET_ADDRESS` is only an override/troubleshooting path; the preferred live story is managed-wallet-first.",
    ],
    sources: [FAQ_SOURCES.readme, FAQ_SOURCES.runbook, FAQ_SOURCES.configExample],
  },
] as const;

function findTelegramFaqEntry(text: string): TelegramFaqEntry | undefined {
  const normalized = normalizeFaqPrompt(text);
  if (normalized.length === 0) {
    return undefined;
  }
  return TELEGRAM_FAQ_ENTRIES.find((entry) =>
    entry.prompts.some((prompt) => normalizeFaqPrompt(prompt) === normalized),
  );
}

export function buildTelegramStartKeyboardRows(): string[][] {
  return TELEGRAM_START_KEYBOARD_ROWS.map((row) => [...row]);
}

export function buildOperatorStartReply(): string {
  return [
    "AgentPhalanx — Telegram-first onboarding",
    "",
    "Use this private bot chat for `/claim`, setup, approvals, and bounded status queries after the terminal bootstrap is done.",
    "",
    "FAQ topics on this keyboard include why the OKX API trio is needed, why OTP is required, what the OKX login email means, and how the agentic wallet address gets recorded.",
    "",
    "What happens next:",
    "• `/claim` binds the owner chat and auto-writes `TELEGRAM_ALLOWED_USER_ID` locally",
    "• FAQ buttons below answer curated onboarding questions from repo docs",
    "• Once READY, the same chat also supports bounded operator shortcuts such as `status`, `portfolio`, and `x402 summary`",
    "",
    "Boundary:",
    "• This is a source-grounded onboarding surface based on curated docs (`README.md`, `docs/live-demo-runbook.md`, `config.env.example`)",
    "• It is not an open-ended general assistant and does not accept arbitrary secret-handling questions",
  ].join("\n");
}

export function buildTelegramFaqReply(text: string): string | undefined {
  const entry = findTelegramFaqEntry(text);
  if (!entry) {
    return undefined;
  }
  return [
    `AgentPhalanx FAQ — ${entry.title}`,
    "",
    ...entry.bullets.map((bullet) => `• ${bullet}`),
    "",
    "Curated sources:",
    ...entry.sources.map((source) => `• ${source.path} — ${source.note}`),
    "",
    "This reply is bounded to the curated onboarding docs above.",
  ].join("\n");
}
