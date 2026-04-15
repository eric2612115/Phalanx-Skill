# Operator Runbook

This file is the practical operator runbook for **AgentPhalanx**. The path remains `docs/live-demo-runbook.md` for compatibility, but the intent is product operation, not a one-off stage script.

## Who This Is For

Use this runbook if you are:

- installing AgentPhalanx on a new machine
- preparing to run Telegram onboarding
- verifying runtime readiness before real usage
- checking x402, wallet, or approval behavior in a live environment

If you only need the shortest install path, start with `README.md`.

## New Machine Checklist

Follow this once on a fresh machine:

1. clone the repo
2. run `npm install`
3. run `npm run init`
4. fill `config.env`
5. adjust `service.env` only if you need non-default runtime behavior
6. run `npm start`
7. move into Telegram and complete `/start` -> `/claim` -> `confirm`

## `config.env`

`config.env` is the user-facing file.

Expected live operator minimum:

- `TELEGRAM_BOT_TOKEN`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `PHALANX_OWNER_EVM_ADDRESS`

Usually managed through onboarding or local edits:

- `TELEGRAM_ALLOWED_USER_ID`
- `OKX_AGENTIC_WALLET_LOGIN_EMAIL`
- `OKX_AGENTIC_WALLET_PROFILES_JSON`
- optional `OMRATE_API_KEY`

Notes:

- `TELEGRAM_ALLOWED_USER_ID` should normally be auto-written by `/claim`
- `@userinfobot` is only a fallback for manual verification
- `AGENT_WALLET_ADDRESS` and `PHALANX_WALLET_ADDRESS` are override-only troubleshooting paths

## `service.env`

`service.env` is the runtime/defaults file.

Typical values live here:

- `PHALANX_RUNTIME_MODE`
- `PHALANX_GUARDIAN_ENABLED`
- `PHALANX_GUARDIAN_INTERVAL_MS`
- `OMRATE_API_BASE_URL`
- `BASE_RPC_URL`
- `XLAYER_RPC_URL`
- whitelist and governance defaults

Notes:

- keep user secrets in `config.env`
- keep runtime defaults in `service.env`
- treat `PHALANX_X402_NETWORK` as a debug override, not the normal product path

## Telegram Onboarding

In a **private** chat with your bot:

1. send `/start`
2. send `/claim`
3. send `confirm`
4. follow the setup prompts:
   - login email
   - OKX API trio
   - optional OmRate API key or `skip`
   - OTP / managed-wallet confirmation
   - funding confirmation
   - allocate now or skip

The Telegram FAQ surface is bounded to curated repo docs. It is not an open-ended assistant.

## Readiness Checks

Run:

```bash
npm run smoke:live
```

What you want to see:

- runtime lifecycle is `READY`
- Telegram surface is `ready`
- no missing required operator keys

For deeper validation:

```bash
npm run test
npm run build
npm run guard:ai
```

## Smoke: allocation mainline

`npm run smoke:allocation-mainline` is stricter than readiness smoke: it expects the proactive allocation story to be enabled. Set `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` (and a compatible `PHALANX_FLOW_PROFILE` when you use that lane) before running it, or the script may exit early by design.

## Before Real Execution

Before asking AgentPhalanx to execute real actions:

1. confirm exactly one Telegram poller is running for the bot token
2. confirm the bot replies in the intended private chat
3. confirm the active managed wallet is the one you expect
4. confirm funds are already in the active wallet
5. for x402 stories, preload X Layer funds in the active Agentic wallet

## Telegram Operator Surface

Common operator queries:

- `status`
- `portfolio`
- `recent events`
- `why blocked`
- `risk summary`
- `x402 summary`
- `show wallets`
- `queue`

Common operator actions:

- `queue <summary>`
- `use profile <profile-id>`
- `use wallet <wallet-id>`

Approval-gated actions continue through Telegram inline buttons when required.

## x402 Checks

When the OmRate path is paid:

- AgentPhalanx should prefer X Layer
- the active Agentic wallet should be the payer
- `x402 summary` should show required / attempted / wrapped / settled
- settlement tx hash or grouped explorer links should appear when the backend returns or resolves them

Current production OmRate API base:

- [https://api.omrate.com](https://api.omrate.com)

## Common Failures

### `chat not found`

Usually means:

- the bot token is valid
- but the configured owner chat is not the chat currently talking to the bot

Check:

- open the same private bot chat
- send `/start`
- re-run `/claim` if needed

### `409 Conflict`

Usually means more than one process is polling the same bot token. Telegram long polling may surface this as a `409 Conflict` when two runtimes compete for `getUpdates` on the same token.

Check:

- stop every extra runtime, smoke script, or dev process using the same token
- restart only one runtime

### Managed wallet unresolved

Usually means:

- OTP/login/bootstrap did not really complete
- or the runtime is still looking at the wrong wallet source

Check:

- complete the Telegram wizard again
- confirm the recorded wallet registry
- only use wallet overrides intentionally

### Funding not ready

Usually means the wallet exists but the required chain/asset balance is missing.

Check:

- fund first
- verify balances
- retry after funding is confirmed

## Advanced References

- `README.md`
- `docs/README.md`
- `docs/uniswap-v3-direct-execution.md`
- `docs/agent-pack/DECISIONS.md`
