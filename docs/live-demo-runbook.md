# Live Demo Runbook

**AgentPhalanx** is the operator-facing product name for this runtime (repository folder: `Phalanx-Skill`). Compatibility-sensitive configuration continues to use `PHALANX_*` env prefixes as documented below.

This runbook is for the current hackathon-facing local operator demo. The primary recording target is a stable `deposit` live mainline, and the full `deposit -> tokenId discovery -> withdraw` roundtrip is now also live-closed.

Current verification reality for this workspace:

- automated checks passed: `npm run test`, `npm run build`, `npm run guard:ai`
- `npm run smoke:allocation-mainline` was blocked here because `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` was not set
- `npm run smoke:deposit-mainline` produced its JSON envelope but did not complete successfully here because Telegram returned `chat not found`
- `npm run smoke:uniswap-lp-roundtrip` was blocked here by Telegram `409 Conflict` / overlapping `getUpdates` polling on the same bot token

Read the smoke notes below as operational prerequisites and blockers, not as a blanket claim that every live smoke succeeded in this environment.

Recording checklist:

- `docs/hackathon/xlayer-demo-checklist.md`
- `docs/telegram-first-acceptance-matrix.md`

## Single first-run path (new machine, new user)

Follow this end-to-end once per fresh checkout before exploring optional branches:

1. **Clone and install:** `git clone` → `cd Phalanx-Skill` → `npm install` → `npm run init`
2. **`config.env`:** fill only the human-required keys the init summary lists. Use `@BotFather` for `TELEGRAM_BOT_TOKEN`. Leave `TELEGRAM_ALLOWED_USER_ID` blank until claim succeeds; a successful private `/claim` **writes it automatically**. `@userinfobot` is **not** the main onboarding path (optional numeric-id lookup only).
3. **`service.env`:** enable the runtime and demo switches you need (`PHALANX_RUNTIME_MODE`, allocation-demo flags, RPC defaults, etc.—see the sections below)
4. **Start the runtime:** `npm start` (or `PHALANX_ENABLE_MCP_STDIO=1 npm start` when using MCP stdio). Use `npm run dev` only for local iteration; terminal bootstrap ends here and ongoing operator flow is in Telegram.
5. **Telegram private chat:** message the bot, send `/start` to open onboarding + FAQ, then complete `/claim` → `confirm`. The Telegram wizard now continues as login email → OKX trio → optional OmRate key (`skip` allowed) → OTP / managed-wallet confirmation → funding confirmation → allocate-now-or-skip.
6. **Optional verify:** compare `TELEGRAM_ALLOWED_USER_ID` in `config.env` to your Telegram user id if you want a manual cross-check (binding does not require `@userinfobot`)
7. **Readiness smoke:** `npm run smoke:live`
8. **Mainline smokes:** `npm run smoke:deposit-mainline` and/or `npm run smoke:allocation-mainline` when their prerequisites are met

**Telegram onboarding surface:** in a private chat with the bot, send `/start` first. It introduces AgentPhalanx, points you to `/claim`, and shows a bounded FAQ keyboard sourced from curated docs (`README.md`, this runbook, `config.env.example`). Send `/help` or `help` for the compact operator summary (what AgentPhalanx is, first-run outline, READY keyword themes). This is not an open-ended assistant. Optional future assistant-style features, if added, would ship behind explicit toggles and would not replace the default keyword/approval surface documented here.

## Live Preflight Before Any Smoke Or Recording

Use this checklist before `smoke:deposit-mainline`, `smoke:allocation-mainline`, or a live recording session:

1. Confirm there is exactly one active Telegram poller for the bot token you are about to use. If another process is already calling `getUpdates`, stop it first.
2. Confirm the bot can reach the intended private operator chat: send `/start` or `/help` in that chat and verify the reply arrives there.
3. Confirm `config.env` and `service.env` match the story you want to run:
   - deposit-only story: live mode + Telegram + wallet + funds
   - allocation/x402 story: the same, plus `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` and a compatible `PHALANX_FLOW_PROFILE`
4. Confirm the managed wallet path is the one you expect:
   - Telegram wizard already recorded `OKX_AGENTIC_WALLET_CURRENT_ADDRESS`, and/or
   - `OKX_AGENTIC_WALLET_PROFILES_JSON` shows the intended active profile / active wallet, or
   - an intentional override is set and understood as override-only
5. Confirm funds are already present in the active managed wallet before asking the runtime to execute.
6. For the paid OmRate / allocation story, preload X Layer USDT into the **active Agentic wallet** before the runtime hits `PAYMENT-REQUIRED`. X Layer is preferred first; Base is fallback only when X Layer is present but insufficient.
7. Confirm which proof you are collecting:
   - `npm run smoke:deposit-mainline` for the stable recording cut
   - `npm run smoke:allocation-mainline` for the fuller proactive allocation + x402 story

## Failure Discipline For Common Live Blockers

| Blocker | What it usually means | What to check first | What success looks like after retry |
| --- | --- | --- | --- |
| `chat not found` | the bot token is valid, but the configured owner chat is not the chat currently talking to the bot | open the target private chat, send `/start`, confirm `/claim` wrote the current `TELEGRAM_ALLOWED_USER_ID`, and make sure the same bot token is running | Telegram approval / report lands in the intended private chat |
| `409 Conflict` from Telegram | more than one process is polling the same bot token | stop every extra `npm run dev`, smoke script, or other bot process using the token, then restart only one runtime | one poller remains, approvals and reports resume normally |
| managed wallet unresolved | OTP/login/bootstrap did not actually finish, or the runtime is still looking at the wrong wallet source | re-run the Telegram wizard step, confirm `OKX_AGENTIC_WALLET_CURRENT_ADDRESS`, and only use `AGENT_WALLET_ADDRESS` if intentionally overriding | `agent wallet` / runtime evidence shows the expected managed address |
| funding not ready | wallet exists but has insufficient assets for the requested live action | deposit funds first, verify with wallet balance tooling, then resume the intended smoke/demo | the next runtime attempt reaches approval or execution instead of blocking on funding |
| allocation smoke fails fast before work starts | allocation story prerequisites are not enabled | set `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` and a compatible `PHALANX_FLOW_PROFILE`, then restart if needed | `smoke:allocation-mainline` enters the proactive allocation story instead of preflight failure |

## 1. Install And Bootstrap

```bash
git clone <your-copy-of-this-repo>
cd Phalanx-Skill
npm install
npm run init
```

Expected init behavior:

- creates `config.env` from `config.env.example` when missing
- creates `service.env` from `service.env.example` when missing
- reports `operator_ready`, `demo_ready`, or partial readiness
- separates required values from optional ones
- treats `OMRATE_API_KEY` as optional
- frames the terminal as: `@BotFather` token → `npm run init` → start runtime → hand off to Telegram for `/start` → `/claim` (with `@userinfobot` explicitly not the main path)

## 2. Prepare `config.env`

Live operator minimum:

- `TELEGRAM_BOT_TOKEN`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `PHALANX_OWNER_EVM_ADDRESS`

`config.env` is user-facing only:

- `TELEGRAM_ALLOWED_USER_ID` is auto-written after the first successful private `/claim`
- `OKX_AGENTIC_WALLET_LOGIN_EMAIL` is a user-specific Telegram-collected field for OKX TEE login / OTP
- `OKX_AGENTIC_WALLET_CURRENT_ADDRESS` / `OKX_AGENTIC_WALLET_ADDRESS_HISTORY` are local records written after managed-wallet confirmation
- `OKX_AGENTIC_WALLET_PROFILES_JSON` is the preferred local registry for multi-Gmail / multi-wallet operators and their active wallet selection
- `OMRATE_API_KEY` is optional
- `AGENT_WALLET_ADDRESS` is troubleshooting override-only, not the primary wizard path

If the operator changes `OKX_AGENTIC_WALLET_LOGIN_EMAIL` later from Telegram, AgentPhalanx must warn first and require a second confirmation before overwriting it, because the old email may still be needed to access previously created agentic wallets.

`service.env` owns service/runtime defaults:

- `OMRATE_API_BASE_URL` defaults to `https://api.omrate.com`
- `BASE_RPC_URL` defaults to `https://mainnet.base.org`
- `XLAYER_RPC_URL` defaults to `https://rpc.xlayer.tech`
- `PHALANX_GUARDIAN_INTERVAL_MS` defaults to a long-running product interval (4 hours) and can be lowered locally for tests
- `PHALANX_MEMORY_STATE_PATH` can override the local runtime memory snapshot path
- `PHALANX_RUNTIME_MODE`, guardian flags, execution backend, whitelist targets, and governance write keys live there
- `POLICY_OWNER_KEY` and `WHITELIST_POLICY_ADDRESS` are future extensions, not current demo blockers

Wallet note:

- the repo now prefers `Onchain OS` managed-address-first selection
- one operator may keep multiple Gmail profiles and multiple Agentic wallets; Telegram can switch the active profile / wallet before execution
- if a path fails because it selects the wrong `from` address, treat that as a wallet-resolution/config issue, not a proof that LP execution is broken

## 3. Re-run Third-Party Review Before Host Installation

```bash
npm run review:docker:all
```

Reference:

- `docs/third-party-install-review.md`
- `docs/third-party-review-baseline.md`

## 4. Basic Startup Verification

```bash
npm run smoke:live
```

Expected:

- startup summary prints `mode`
- readiness reflects the current operator/demo state
- `phalanx_status` succeeds

For synthetic readiness verification:

```bash
PHALANX_SMOKE_SYNTHETIC_READY=1 npm run smoke:live
```

## 5. Fund The Agentic Wallet Before Real Execution

Before any real live LP execution:

1. transfer a small amount of test funds into the active OKX Agentic Wallet address
2. confirm balances with `onchainos wallet balance`
3. only then continue to planner / approval / LP execution rehearsal

## 6. Start The Runtime

Without MCP stdio:

```bash
PHALANX_DRY_RUN_KEEPALIVE=0 npm start
```

With MCP stdio enabled:

```bash
PHALANX_ENABLE_MCP_STDIO=1 npm start
```

When MCP stdio is enabled, startup output goes to `stderr` to avoid corrupting the protocol stream.

## 7. Real Telegram Verification

When `TELEGRAM_BOT_TOKEN` is valid and `PHALANX_RUNTIME_MODE=live`:

1. start the runtime
2. send a private message to the bot
3. use `/start` to open the onboarding + bounded FAQ keyboard
4. use `/help` or `help` for the compact operator summary when needed
5. complete owner claim if not already bound
6. continue the Telegram wizard through login email, OKX trio, optional OmRate key, OTP / managed-wallet confirmation, funding confirmation, and allocate-now-or-skip
7. verify approval messages arrive in the same private chat
8. verify bounded operator queries such as:
   - `status`
   - `portfolio`
   - `recent events`
   - `why blocked`
   - `current whitelist`
   - `risk summary`
   - `agent wallet`
   - `queue`

Bounded Telegram operator actions now also include:

- `queue <summary>` to add a pending operator task
- inline `Cancel` / `Edit` buttons on queued jobs
- `use profile <profile-id>` and `use wallet <wallet-id>` to switch the active identity before execution

Unknown free-form text in READY private chat should receive a fallback that points back to `/help` and the catalog themes.

Use `docs/telegram-first-acceptance-matrix.md` as the fixed acceptance contract for Telegram onboarding, live demo flows, tx-link grouping, x402 visibility, and failure-mode observability.

## 8. Main Recording Story

For today's recording, the preferred story is:

1. show local/self-hosted runtime startup
2. show the LP action path or MCP-triggered deposit path
3. show Telegram approval
4. approve in Telegram
5. show local-first whitelist update and runtime resume
6. show live `approve -> deposit`
7. show returned tx refs

What is already proven:

- Telegram approval request delivery
- Telegram approve callback
- resume through `RuntimeCore`
- local whitelist update
- correct pool selection after planner fixes
- live Uniswap V3 deposit through `onchainos wallet contract-call`
- successful tx refs
- tokenId discovery and live withdraw in the full roundtrip proof

What is still optional for the recording cut:

- rich LP NFT operator report in Telegram

### Deposit mainline smoke (JSON proof)

For a single command that follows the same host and Telegram approval wiring as `smoke:telegram-approval`, runs planner then `phalanx_action` deposit, and prints a machine-readable envelope for recordings:

```bash
npm run smoke:deposit-mainline
```

Expected top-level fields include:

- `mode`: always `deposit_mainline_smoke`
- `schemaVersion`: bump when the envelope shape changes
- `proof.milestones`: booleans for approval and deposit phases (`approval_requested`, `approval_resumed`, `deposit_attempted`, `deposit_completed`, `tx_refs_captured`)
- `proof.txRefs`: deduped tx refs when the adapter exposes them
- `proof.humanSummary`: compact pipe-separated milestone line for logs

Contract tests live in `tests/smoke-deposit-mainline.test.ts`. Requires the same live + Telegram readiness as other approval smokes; approve in Telegram when the script waits on a pending approval.

### Allocation mainline smoke (JSON proof)

For the proactive **AgentPhalanx** allocation story (separate from deposit-only rehearsal), run:

```bash
npm run smoke:allocation-mainline
```

Hard prerequisites (the script fails fast when missing):

- `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED` must be `1` so the host enables the agentic allocation demo lane.
- `PHALANX_FLOW_PROFILE` must resolve to `allocation_mainline` or `rehearsal` (aliases such as `allocation-mainline` are accepted).
- the same live Telegram readiness expectations as other approval smokes (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, and a reachable owner chat).

Contract tests for the smoke envelope live in `tests/smoke-deposit-mainline.test.ts` and `tests/allocation-mainline.test.ts`.

## 9. Real Onchain OS / OmRate / Uniswap Verification

Run incrementally with small funds:

1. confirm `onchainos` capability and active wallet selection
2. verify Telegram approval path
3. verify planner selects the intended pool
4. confirm blocked LP route becomes `pending_approval`
5. approve in Telegram
6. confirm callback resumes the original action
7. confirm live deposit completes and returns tx refs

## 10. Uniswap LP Roundtrip Script

Use the dedicated roundtrip script when you want the full live lifecycle proof:

```bash
npm run smoke:uniswap-lp-roundtrip
```

Telegram note: Telegram only allows one long-polling `getUpdates` session per bot token. If another **AgentPhalanx** / `Phalanx-Skill` dev instance (or any other process) is already polling the same bot, this script may fail with HTTP `409 Conflict` until the other poller stops.

Required env:

- `PHALANX_LP_INVESTMENT_ID`
- `PHALANX_LP_AMOUNT`
- `PHALANX_LP_AMOUNT_SECONDARY`
- `PHALANX_LP_TICK_LOWER`
- `PHALANX_LP_TICK_UPPER`

Optional env:

- `PHALANX_LP_CHAIN=base`
- `PHALANX_LP_TOKEN_A`, `PHALANX_LP_TOKEN_B`
- `PHALANX_LP_TOKEN`
- `PHALANX_LP_TOKEN_SECONDARY`
- `PHALANX_LP_DISCOVERY_PAGES`
- `PHALANX_LP_WITHDRAW_PLATFORM_ID`
- `PHALANX_LP_WITHDRAW_TOKEN_ID`
- `PHALANX_LP_WITHDRAW_RATIO`
- `PHALANX_LP_WITHDRAW_AMOUNT`
- `PHALANX_LP_RANGE`

Interpretation rules:

1. planning still comes from `phalanx_uniswap_liquidity_plan`
2. live execution-time identifiers should be refreshed from `onchainos`
3. no stale local LP metadata should be trusted for withdraw
4. operator-supplied LP amounts must already be in minimal units
5. live Uniswap V3 on Base uses direct `NonfungiblePositionManager` calldata through `onchainos wallet contract-call`

Reference:

- `docs/uniswap-v3-direct-execution.md`

## 11. Evidence Checklist

Capture these artifacts during rehearsal or recording:

- startup summary showing mode and readiness
- Telegram approval screenshot for the blocked LP action
- terminal evidence for resumed execution
- tx refs from the live deposit
- planner/pool-selection evidence used in the explanation
- any runtime event snippet that shows the action resumed through the runtime rather than a side channel

If you are capturing the full roundtrip proof, also capture:

- post-deposit discovery output
- derived withdraw payload evidence
- withdraw result and post-withdraw state

## 12. Recommended Verification Before Recording

Run at least:

```bash
npm test -- tests/uniswap-v3-execution.test.ts tests/uniswap-official-planner.test.ts
npm run build
npm run guard:ai
```

If the local environment supports it, also run:

```bash
npm run smoke:live
```

## 13. Fallback Paths

Use these fallback modes when dependencies are flaky:

- if Telegram is temporarily unavailable, prove the approval outbox and callback path locally before retrying the live chat
- if planner dependencies are partially unavailable, show planner readiness/probe evidence before retrying execution
- if wallet selection chooses the wrong address, fix config/address resolution first and do not mislabel it as an LP logic failure
- if the environment blocks the roundtrip script (for example Telegram chat/poller issues), keep the recorded story focused on the already-proven deposit mainline and report the blocker explicitly

## 14. Safety Reminders

- Do not use main funds for first-run verification.
- Keep third-party install review in Docker.
- Treat quote/read success separately from live execution success.
- Preserve normalized logs and summaries for failures instead of hiding them.
