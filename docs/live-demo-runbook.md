# Live Demo Runbook

This runbook is for the current hackathon-facing local operator demo. The primary recording target is a stable `deposit` live mainline, and the full `deposit -> tokenId discovery -> withdraw` roundtrip is now also live-closed.

Recording checklist:

- `docs/hackathon/xlayer-demo-checklist.md`

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
- points the operator to the private Telegram `/claim` step

## 2. Prepare `config.env`

Live operator minimum:

- `TELEGRAM_BOT_TOKEN`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `PHALANX_OWNER_EVM_ADDRESS`

`config.env` is user-facing only:

- `TELEGRAM_ALLOWED_USER_ID` is auto-written after the first successful private `/claim`
- `OMRATE_API_KEY` is optional

`service.env` owns service/runtime defaults:

- `OMRATE_API_BASE_URL` defaults to `https://api.omrate.com`
- `BASE_RPC_URL` defaults to `https://mainnet.base.org`
- `XLAYER_RPC_URL` defaults to `https://rpc.xlayer.tech`
- `PHALANX_RUNTIME_MODE`, guardian flags, execution backend, whitelist targets, and governance write keys live there
- `POLICY_OWNER_KEY` and `WHITELIST_POLICY_ADDRESS` are future extensions, not current demo blockers

Wallet note:

- the repo is moving toward `Onchain OS` managed-address-first selection
- some live paths may still require explicit wallet env override until that cleanup is fully finished
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
PHALANX_DRY_RUN_KEEPALIVE=0 npm run dev
```

With MCP stdio enabled:

```bash
PHALANX_ENABLE_MCP_STDIO=1 npm run dev
```

When MCP stdio is enabled, startup output goes to `stderr` to avoid corrupting the protocol stream.

## 7. Real Telegram Verification

When `TELEGRAM_BOT_TOKEN` is valid and `PHALANX_RUNTIME_MODE=live`:

1. start the runtime
2. send a private message to the bot
3. complete owner claim if not already bound
4. verify approval messages arrive in the same private chat
5. verify bounded operator queries such as:
   - `status`
   - `portfolio`
   - `recent events`
   - `why blocked`
   - `current whitelist`
   - `risk summary`
   - `agent wallet`

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

If `withdraw` is also completed, capture:

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
- if `withdraw` is not stable in time, keep the recorded story focused on the already-proven deposit mainline

## 14. Safety Reminders

- Do not use main funds for first-run verification.
- Keep third-party install review in Docker.
- Treat quote/read success separately from live execution success.
- Preserve normalized logs and summaries for failures instead of hiding them.
