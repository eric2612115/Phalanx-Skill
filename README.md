# AgentPhalanx

**AgentPhalanx** is the outward-facing product name for this self-custodial, local-first Agentic runtime for X Layer-oriented DeFi operations. The implementation lives in the `Phalanx-Skill` repository folder and npm package id `phalanx-skill` for compatibility with existing tooling and `PHALANX_*` configuration keys.

It uses `Onchain OS` as the execution substrate, a paid intelligence layer over `x402`, and `Uniswap Skill` as the LP planning layer.

This repo is being prepared for `X Layer Arena`, not packaged as a hosted SaaS or a generic skill marketplace item.

## Reviewer Narrative

For the short reviewer-facing product story, start with `docs/product/agentphalanx-review-narrative.md`.

## What It Is

`Phalanx-Skill` owns the action-plane implementation for **AgentPhalanx**:

- MCP entrypoints and runtime orchestration
- policy, risk, whitelist, and approval flow
- Telegram approval and operator routing
- planner-to-execution handoff
- x402-aware paid intelligence access
- live execution through `Onchain OS`

It is **not**:

- the paid intelligence data plane or backend source of truth
- the frontend UI
- a replacement for OKX wallet custody or signing infrastructure
- a hosted control plane that asks users to trust cloud-managed private keys

## Why Local-First

The trust model is deliberate:

- `Onchain OS` remains the execution and signing boundary
- the operator keeps local control over runtime and credentials
- **AgentPhalanx** adds governance, approval, and orchestration on top of the existing OKX execution substrate

This repo should be read as a local/self-hosted Agentic application, not as an attempt to reimplement wallet infra or move custody into a SaaS.

## Architecture

At the architecture level, `OmRate` is one component in the `AgentPhalanx` story: a cross-protocol DeFi rate aggregator built by this team, used as AgentPhalanx's paid intelligence layer over `x402`, with pay-per-use access on X Layer. Operator-facing API base: [https://api.omrate.com](https://api.omrate.com).

## Current Status

Current truth as of this repo state:

- externally **installable** through documented manual setup
- **not claiming** npm or marketplace publish readiness
- governance is enforced through rules, hooks, `guard:ai`, and CI
- the `deposit` live mainline is already proven
- the `deposit -> tokenId discovery -> withdraw` roundtrip is now live-proven
- richer LP position reporting is still in progress

## Current Proven Capabilities

These paths have already been validated in the current iteration:

- Telegram approval request delivery
- Telegram approve callback handling
- `RuntimeCore` resume after approval
- local-first whitelist update
- correct Uniswap pool selection after planner fixes
- live Uniswap V3 deposit through `onchainos wallet contract-call`
- returned tx refs for the successful live deposit path
- tokenId discovery and live withdraw in the full roundtrip proof

The currently proven live story is:

1. trigger or prepare the LP action
2. route into Telegram approval
3. approve in Telegram
4. update whitelist locally
5. resume original action through `RuntimeCore`
6. execute live `approve -> deposit`
7. collect tx refs
8. discover tokenId and complete the live withdraw step for the full roundtrip proof

## Current Gaps

These are known and intentionally not overclaimed:

- richer Telegram LP position detail reporting
- final cleanup of wallet auto-resolution so managed Onchain OS addresses are primary everywhere
- stable no-override recording config for every live path

For today's demo target, stable `deposit` mainline remains the simplest primary recording path, while the `deposit -> tokenId discovery -> withdraw` roundtrip is also live-proven when you want the stronger lifecycle proof.

## Current Verification Reality

Latest automated verification run in this environment:

- `npm run test` passed
- `npm run build` passed
- `npm run guard:ai` passed

Latest live-smoke reality in this environment:

- `npm run smoke:allocation-mainline` did **not** complete because `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` was not set, and that smoke intentionally fails fast without the allocation-mainline env preconditions.
- `npm run smoke:deposit-mainline` produced its JSON proof envelope but did **not** reach a successful approval/deposit completion because Telegram returned `chat not found` for the configured chat.
- `npm run smoke:uniswap-lp-roundtrip` did **not** complete because Telegram long polling hit `409 Conflict` / competing `getUpdates`, which means another bot poller was already active for the same token.

Treat those smoke outcomes as environment-specific blockers, not as proof that every live path succeeded in this session.

## Install

Primary install story for the current phase:

```bash
git clone <your-copy-of-this-repo>
cd Phalanx-Skill
npm install
npm run init
```

`npm run init` is the operator bootstrap entrypoint in the **terminal**. Treat the terminal as Telegram-focused bootstrap only: obtain `TELEGRAM_BOT_TOKEN` from `@BotFather`, save it in `config.env`, run `npm run init`, start the runtime (`npm start` for the long-running operator path, `npm run dev` for local development), then **hand off** to a private Telegram chat with your bot for `/claim` and day-to-day operator actions.

It will:

- create `config.env` from `config.env.example` when needed
- create `service.env` from `service.env.example` when needed
- report `operator_ready` vs `demo_ready`
- separate required keys from optional keys
- treat `OMRATE_API_KEY` as optional
- print next steps toward `/claim` in Telegram (not a general-purpose terminal wizard)

Then read these in order:

1. `docs/agent-pack/DECISIONS.md`
2. `docs/agent-pack/GOVERNANCE.md`
3. `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
4. `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`
5. `docs/live-demo-runbook.md`

## First run on a new computer (single story)

Use this as the default checklist for a clean machine and a new operator:

1. **Clone and install:** `git clone` → `cd Phalanx-Skill` → `npm install` → `npm run init`
2. **`config.env` (human inputs only):** set the required keys from `npm run init` output (for example `TELEGRAM_BOT_TOKEN` from `@BotFather`, OKX API trio, `PHALANX_OWNER_EVM_ADDRESS`). Leave `TELEGRAM_ALLOWED_USER_ID` empty until claim completes; a successful private `/claim` **writes it automatically**—`@userinfobot` is **not** the main path (optional lookup only if you want your numeric id by hand).
3. **`service.env` (runtime/demo switches):** turn on what you need for live or rehearsal (for example `PHALANX_RUNTIME_MODE=live`, demo flags described in `docs/live-demo-runbook.md`, RPC defaults you rely on).
4. **Start the runtime:** typically `npm start` (or `PHALANX_ENABLE_MCP_STDIO=1 npm start` when using MCP stdio). Use `npm run dev` only for development iteration. This is the last recurring step you need the **terminal** for before ongoing work moves to Telegram.
5. **Telegram:** open a **private** chat with your bot, send `/start`, then complete `/claim` → `confirm`. The wizard now continues in Telegram as: login email → OKX trio → optional data API key (`skip` allowed) → OTP / managed-wallet confirmation → funding confirmation → allocate now or skip.
6. **Optional verify:** if you want to double-check, compare `TELEGRAM_ALLOWED_USER_ID` in `config.env` to your Telegram user id; binding does not depend on `@userinfobot`.
7. **Smoke (readiness):** `npm run smoke:live`
8. **Smoke (mainline proofs):** run `npm run smoke:deposit-mainline` and/or `npm run smoke:allocation-mainline` when their prerequisites in the runbook are satisfied.

In Telegram private chat, send **`/start`** first for the onboarding surface: it introduces AgentPhalanx, shows the next `/claim` step, and exposes a bounded FAQ keyboard sourced from curated docs (`README.md`, `docs/live-demo-runbook.md`, `config.env.example`). Send **`/help`** (or plain **`help`**) anytime for the compact operator summary and query catalog. Neither path is an open-ended assistant channel.

## Operator Bootstrap

The terminal is for env edits, `npm run init`, and starting the runtime; after that, owner binding and approvals happen in Telegram.

Minimum human-entered inputs for live operator mode:

- `TELEGRAM_BOT_TOKEN` (from `@BotFather`, saved in `config.env`)
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `PHALANX_OWNER_EVM_ADDRESS`

`config.env` is user-facing only:

- `TELEGRAM_ALLOWED_USER_ID` is auto-written after the first successful `/claim`
- `OKX_AGENTIC_WALLET_LOGIN_EMAIL` is user-specific and can be collected in Telegram onboarding
- `OKX_AGENTIC_WALLET_CURRENT_ADDRESS` / `OKX_AGENTIC_WALLET_ADDRESS_HISTORY` are local records written after managed-wallet confirmation
- `OKX_AGENTIC_WALLET_PROFILES_JSON` is the preferred local registry for multi-Gmail / multi-wallet fleets; Telegram and runtime keep the active profile / active wallet there
- `OMRATE_API_KEY` is optional
- `AGENT_WALLET_ADDRESS` remains override-only troubleshooting, not the primary onboarding path

If the operator later changes `OKX_AGENTIC_WALLET_LOGIN_EMAIL` from Telegram, AgentPhalanx now warns first and requires a second confirmation before overwriting it, because losing the old email can strand access to older agentic wallets.

`service.env` owns service/runtime defaults:

- `OMRATE_API_BASE_URL` defaults to `https://api.omrate.com`
- `BASE_RPC_URL` defaults to `https://mainnet.base.org`
- `XLAYER_RPC_URL` defaults to `https://rpc.xlayer.tech`
- `PHALANX_RUNTIME_MODE`, guardian flags, execution backend, whitelist targets, and governance write keys live there
- `POLICY_OWNER_KEY` and `WHITELIST_POLICY_ADDRESS` are future on-chain governance extensions, not current demo blockers

Wallet note:

- `Onchain OS` managed-address-first selection is now the default runtime direction, with env values kept as explicit overrides
- multi-Gmail / multi-wallet registry is local-first: one operator can keep multiple Gmail identities, each with multiple Agentic wallet addresses, and switch the active wallet from Telegram

## Quick Verify

Always run:

```bash
npm run guard:ai
```

Run these when the affected changes require them:

```bash
npm run test
npm run build
```

Useful commands:

```bash
npm install
npm run init
npm run guard:ai
npm run test
npm run build
npm run dev
npm run smoke:live
npm run smoke:uniswap-lp-roundtrip
npm run smoke:deposit-mainline
```

Stable `deposit` mainline recording: `npm run smoke:deposit-mainline` prints JSON with `mode: "deposit_mainline_smoke"`, `schemaVersion`, `proof.milestones`, and `proof.txRefs` (see `docs/live-demo-runbook.md`).

`npm run smoke:allocation-mainline` is stricter: it requires `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` and a compatible `PHALANX_FLOW_PROFILE` before it will start the proactive allocation story (see `docs/live-demo-runbook.md`).

## Demo Focus

The main hackathon story is:

- the paid intelligence layer contributes market discovery
- `x402` sits inside the data-access narrative
- `Uniswap Skill` contributes planning and pool-selection evidence
- **AgentPhalanx** applies policy/risk/approval/runtime orchestration
- `Onchain OS` executes the live chain action

For the current demo window:

- primary recording target: stable `deposit` live mainline
- full roundtrip is now available when you want the stronger lifecycle proof

See:

- `docs/live-demo-runbook.md`
- `docs/telegram-first-acceptance-matrix.md`
- `docs/hackathon/xlayer-demo-checklist.md`
- `docs/uniswap-v3-direct-execution.md`
- `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`

## Telegram Operator Surface

In **private** chat, `/start` opens the onboarding surface with `/claim`, FAQ buttons, and a bounded doc-grounded FAQ layer for common setup questions such as OKX API trio, optional `OMRATE_API_KEY`, OTP, login email, and wallet recording. After claim confirmation, the Telegram wizard continues with login email → OKX trio → optional data API key → managed-wallet confirmation → funding confirmation → allocate-now-or-skip. `/help` (or `help`) returns the compact operator overview and READY-state keyword themes.

Once the runtime is `READY`, the bound Telegram owner chat supports bounded operator queries such as:

- readiness / pending approvals
- portfolio / balances / positions
- recent events / guardian actions / tx refs
- why blocked / what next
- wallet + x402/payment evidence from latest runtime event
- whitelist / policy summary
- risk summary / guardian assessment
- owner wallet / agent wallet / binding summary
- job queue / pending tasks / active wallet view

Bounded Telegram operator actions now include:

- `queue <summary>` to enqueue a pending operator task
- queue inline `Cancel` / `Edit` actions
- `use profile <profile-id>` to change the active Gmail profile
- `use wallet <wallet-id>` to change the active Agentic wallet

## x402 On X Layer

For `x402`, both sides of the flow in this demo story are built by this team: `AgentPhalanx` is the buyer and `OmRate` is the seller. When a paid intelligence call returns `PAYMENT-REQUIRED`, AgentPhalanx uses the **active Agentic wallet** by default, prefers `X Layer (eip155:196)`, and only falls back to `Base (eip155:8453)` when the preferred network is present but insufficient. `PHALANX_X402_NETWORK` is now a debug override, not the normal product path.

The latest live proof in this repo was replayed against `https://api.omrate.com/markets/<market>/history?interval=1h`, selected the X Layer accept, paid from `0x0dfddf188f102978c75882bc990d903ebe08f443`, and returned `paid_x402` with payment id `06b600b15565a4fc87ebd4e25f7e03bda27bdcfcb97d44ca829dd77a781cab81`. The current smoke artifact exposes signed authorization + settlement confirmation / `payment_id`; if you want a public-facing explorer link here, replace this line with the exact facilitator settlement tx from the final recording run rather than inventing one.

If reviewers want the full data-plane story instead of the AgentPhalanx runtime story, point them to [omrate.com](https://omrate.com) rather than expanding this README further.

This is intentionally a bounded operator surface, not a general chat assistant. The FAQ layer is limited to curated onboarding docs and does not choose actions, inspect secrets, or expand into arbitrary chat. Optional future work may add separate assistant-style integrations behind explicit product toggles; the default Telegram path remains keyword routing, approvals, setup prompts, and the bounded FAQ surface only.

For a fixed acceptance contract across onboarding, live flows, tx links, x402 visibility, and common failure handling, use `docs/telegram-first-acceptance-matrix.md`.

## Host-Specific Setup

- Cursor: use the checked-in `.cursor/rules/` and `.cursor/hooks.json`
- Claude Code: see `.claude-plugin/INSTALL.md`
- OpenAI Codex CLI: see `.codex/INSTALL.md`
- OpenClaw: see `.openclaw/INSTALL.md`
- OpenCode: see `.opencode/INSTALL.md`

## MCP

This repo includes a stdio MCP server for **AgentPhalanx**. Start from:

- `.mcp.json.example`
- `src/mcp/stdio.ts`

When MCP stdio is enabled, startup output is written to `stderr` to keep the protocol stream clean.

## Security

- Never commit `.env`, `config.env`, `service.env`, wallet keys, API secrets, or real credentials.
- Use `config.env.example` and `service.env.example` as templates only.
- Treat local hooks as helpful, not sufficient; CI is the shared quality floor.
- Review third-party tool installation in Docker before host installation.
- Keep MCP env values local and out of version control.

## Release Posture

- Current private submission snapshot: `docs/release/submission-snapshot.md`
- Package version follows semver in `package.json`; private review tags should use `agentphalanx-v<version>` or `agentphalanx-YYYYMMDD-<label>`
- Default recording cut is still `deposit`; allocation + `x402` is the fuller product story, and the withdraw roundtrip is already live-proven rather than a current gap

## License

This repository is `UNLICENSED` and private by default. See `LICENSE` and `docs/release/submission-snapshot.md`. Do not assume redistribution or public-use rights.
