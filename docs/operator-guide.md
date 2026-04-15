# AgentPhalanx — Operator Guide

This is the full product-facing guide. The root `README.md` stays short on purpose; read this when you need setup detail, config semantics, or x402 behavior.

**AgentPhalanx** is a self-custodial, local-first DeFi agent runtime. You run it on your own machine, operate it through Telegram, and let it use **Onchain OS** for execution, **OKX Agentic Wallet** for the wallet identity path, and **OmRate** as a paid intelligence layer over `x402` on X Layer.

The code still lives in the `Phalanx-Skill` repository folder for compatibility, but the product name is **AgentPhalanx**.

**Status:** the full **deposit → tokenId → withdraw** roundtrip is **live-proven**. Smoke prerequisites and environment-specific Telegram failures are documented in `docs/live-demo-runbook.md`, not overstated in the short root `README.md`.

## What It Does

AgentPhalanx is the action plane for:

- Telegram onboarding, approvals, and operator commands
- active profile / active wallet selection
- whitelist, policy, and risk gating before execution
- guardian checks and rebalance candidates
- paid OmRate queries over `x402`
- live DeFi execution through `Onchain OS`

It is **not**:

- a hosted SaaS
- a browser frontend
- a replacement for OKX custody or signing infrastructure
- a generic skill marketplace package

## Prerequisites

Before you start, you need:

- `Node.js >= 22`
- `git`
- a Telegram account
- access to OKX credentials for the runtime path you plan to use

## Telegram Setup

### 1. Install Telegram

Install Telegram on desktop or mobile and sign in with your account.

### 2. Create a bot with `@BotFather`

In Telegram:

1. open `@BotFather`
2. run `/newbot`
3. choose a bot name and username
4. copy the bot token

Save that token as `TELEGRAM_BOT_TOKEN` in `config.env`.

### 3. Get your Telegram numeric id

The normal product path is:

- start the runtime
- open a private chat with your bot
- use `/claim`

That flow auto-writes `TELEGRAM_ALLOWED_USER_ID`.

If you want to confirm your numeric id manually, you can also message `@userinfobot`. Treat that as a manual check or fallback, not the main onboarding path.

## OKX Setup

AgentPhalanx currently requires the **OKX API trio**:

- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`

These credentials are required by the **Onchain OS execution path** used by AgentPhalanx for wallet operations, x402 payment integration, and live DeFi execution. This is part of the actual runtime path in this repo, not just a side note from a skill document.

You should also prepare:

- `OKX_AGENTIC_WALLET_LOGIN_EMAIL`

This is the login email used for the OKX TEE Agentic Wallet flow. Telegram onboarding will ask for it, and the OTP step must complete or the managed-wallet flow cannot finish successfully.

## OmRate Setup

AgentPhalanx supports two ways to access OmRate:

1. **Recommended product path:** skip `OMRATE_API_KEY` and let AgentPhalanx pay through `x402`
2. **Optional:** register for an OmRate API key and store `OMRATE_API_KEY` in `config.env`

Recommendation:

- if you want the cleanest AgentPhalanx story, use `x402`
- if you want free-tier or API-key access first, use `OMRATE_API_KEY`

`OMRATE_API_KEY` is optional by design. The runtime can operate without it and surface the full `PAYMENT-REQUIRED -> paid -> settled` path instead.

Operator-facing OmRate base URL:

- [https://api.omrate.com](https://api.omrate.com)

## Config Files

AgentPhalanx splits config into two files.

### `config.env`

Put **user-specific** values here:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OKX_AGENTIC_WALLET_LOGIN_EMAIL`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `OKX_AGENTIC_WALLET_PROFILES_JSON`
- optional `OMRATE_API_KEY`
- `PHALANX_OWNER_EVM_ADDRESS`

Rules:

- `TELEGRAM_ALLOWED_USER_ID` is usually auto-written after `/claim`
- `OKX_AGENTIC_WALLET_PROFILES_JSON` is the preferred local registry for multi-Gmail / multi-wallet setup
- `AGENT_WALLET_ADDRESS` / `PHALANX_WALLET_ADDRESS` are override-only troubleshooting paths

### `service.env`

Put **runtime and infrastructure defaults** here:

- `PHALANX_RUNTIME_MODE`
- guardian flags and guardian interval
- `OMRATE_API_BASE_URL`
- `BASE_RPC_URL`
- `XLAYER_RPC_URL`
- whitelist and governance defaults
- debug overrides such as `PHALANX_X402_NETWORK`

Rules:

- user identity and secrets belong in `config.env`
- runtime defaults and deployment behavior belong in `service.env`

Templates:

- `config.env.example`
- `service.env.example`

## Start The Runtime

Initialize the env files if needed:

```bash
npm run init
```

Run the long-lived operator runtime:

```bash
npm start
```

Use `npm run dev` only for development iteration.

## Telegram Onboarding Flow

Once the runtime is running:

1. `/start`
2. `/claim`
3. `confirm`
4. provide the OKX Agentic Wallet login email
5. provide the OKX API trio
6. optionally provide `OMRATE_API_KEY` or send `skip`
7. complete OTP / managed-wallet confirmation
8. confirm funding
9. choose whether to allocate now or skip

The onboarding FAQ in Telegram is bounded to repo docs. It is not an open-ended assistant.

## Telegram Commands

Common operator commands and queries:

- `/start`
- `/claim`
- `/help`
- `status`
- `portfolio`
- `recent events`
- `why blocked`
- `risk summary`
- `x402 summary`
- `show wallets`
- `queue`
- `queue <summary>`
- `use profile <profile-id>`
- `use wallet <wallet-id>`

## How The Runtime Works

High-level flow:

1. you start the runtime locally
2. Telegram becomes the operator surface
3. AgentPhalanx decides what can run automatically and what requires approval
4. whitelist and policy checks gate execution
5. guardian / risk logic can propose rebalances or explain blocked states
6. OmRate provides paid intelligence
7. if OmRate requires payment, AgentPhalanx pays through `x402`
8. Onchain OS performs live execution
9. Telegram receives status, tx refs, and grouped explorer links when available

### Whitelist And Approval

AgentPhalanx does not blindly execute every action:

- allowed paths can run automatically
- non-default or higher-risk actions go through Telegram approval
- whitelist and policy state are part of the operator surface

### Guardian, Risk, And Rebalance

Guardian is the periodic runtime that checks portfolio state, intelligence inputs, and whether a rebalance or operator attention is needed. Deeper operator checks live in `docs/live-demo-runbook.md`.

## x402 On X Layer

In this product story:

- **AgentPhalanx** is the buyer
- **OmRate** is the seller

When OmRate returns `PAYMENT-REQUIRED`, AgentPhalanx:

- uses the **active Agentic wallet**
- prefers **X Layer (`eip155:196`)**
- falls back to **Base (`eip155:8453`)** only when needed

`PHALANX_X402_NETWORK` is a debug override, not the normal product path.

AgentPhalanx records settlement evidence from the seller response when it is returned immediately, and falls back to a short receipt lookup by `payment_id` when needed. That allows runtime evidence and Telegram summaries to carry settlement tx hashes and explorer links automatically when the backend contract supports them.

Example settlement tx (public proof reference):

- [`0x76326160a7ad19aa456936b0fe1a61f7a58424b23d5043a7402805a7d32bf069`](https://web3.okx.com/zh-hant/explorer/x-layer/tx/0x76326160a7ad19aa456936b0fe1a61f7a58424b23d5043a7402805a7d32bf069)

If you want the full OmRate data-plane story, go to [omrate.com](https://omrate.com).

## Verify

Useful commands:

```bash
npm run smoke:live
npm run test
npm run build
npm run guard:ai
```

For execution-specific smoke flows and deeper operator checks, use `docs/live-demo-runbook.md`.

## AI Coding Assistants (Cursor, Claude, Codex, OpenClaw, OpenCode)

Normal operators do **not** need per-host prompt folders to run AgentPhalanx.

If you are **developing** this repo inside an AI editor:

- read [`docs/agent-pack/DECISIONS.md`](agent-pack/DECISIONS.md) first (support matrix and SSOT)
- thin host guides (optional): `.claude-plugin/INSTALL.md`, `.codex/INSTALL.md`, `.openclaw/INSTALL.md`, `.opencode/INSTALL.md`
- Cursor governance: `.cursor/rules/` and `.cursor/hooks.json`

## MCP

This repo includes a stdio MCP server for **AgentPhalanx**:

- `.mcp.json.example`
- `src/mcp/stdio.ts`

When MCP stdio is enabled, startup output is written to `stderr` to keep the protocol stream clean.

## Security

- never commit `config.env`, `service.env`, wallet keys, or real credentials
- use the example env files as templates only
- keep runtime and approval control local
- treat this repo as self-hosted operator software, not a hosted custody layer

## More Docs

- [`docs/README.md`](README.md) — documentation map
- [`docs/live-demo-runbook.md`](live-demo-runbook.md) — runbook and failure discipline
- [`docs/product/agentphalanx-review-narrative.md`](product/agentphalanx-review-narrative.md) — short external narrative
