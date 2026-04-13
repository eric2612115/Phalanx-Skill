# Phalanx Skill

Action-plane repository for Phalanx: wallet execution, signing, x402 flows, MCP exposure, and orchestration against OmRate backend APIs.

## What It Is

`Phalanx-Skill` is the OmRate action-plane repo. It is responsible for:

- agent wallet and signing flows
- x402 payment-aware execution paths
- MCP tooling and runtime orchestration
- governance-aware action execution against OmRate backend APIs

It is **not** the OmRate data plane or frontend:

- `OmRate-Backend` owns auth, DB, and backend API source of truth
- `OmRate-frontend` owns user-facing UI
- `Phalanx-Skill` owns agent-facing execution behavior

Current status:

- externally **installable** through documented manual setup
- **not claiming npm or marketplace publish readiness yet**
- governance is enforced through rules, hooks, `guard:ai`, and CI

## Prerequisites

- Node.js `>=22`
- npm
- local git checkout of this repository

Optional, depending on what you want to use:

- `onchainos` for live execution and capability probes
- Telegram bot credentials for live approval routing
- OmRate API credentials
- chain RPC endpoints

## Install

Primary install story for this phase:

```bash
git clone <your-copy-of-this-repo>
cd Phalanx-Skill
npm install
npm run init
```

`npm run init` is the operator bootstrap entrypoint. It will:

- create `config.env` from `config.env.example` when needed
- report `operator_ready` vs `demo_ready`
- separate operator-tier missing keys from optional keys
- confirm the x402 baseline story (`OKX/onchainos + execution wallet`, `OMRATE_API_KEY` optional)
- print the next step to privately message the bot and run `/claim`

Then read these in order:

1. `docs/agent-pack/DECISIONS.md`
2. `docs/agent-pack/GOVERNANCE.md`
3. `docs/agent-pack/PRE_MERGE_CHECKLIST.md`

### Host-specific setup

- Cursor: use the checked-in `.cursor/rules/` and `.cursor/hooks.json` from this repo; no fake `.cursor-plugin` metadata is claimed
- Claude Code: see `.claude-plugin/INSTALL.md`
- OpenAI Codex CLI: see `.codex/INSTALL.md`
- OpenClaw: see `.openclaw/INSTALL.md`
- OpenCode: see `.opencode/INSTALL.md`

### MCP setup

This repo includes a stdio MCP server. Start from:

- `.mcp.json.example`
- `src/mcp/stdio.ts`

The example uses the real repo startup path and enables MCP through:

- `PHALANX_ENABLE_MCP_STDIO=1`
- `PHALANX_DRY_RUN_KEEPALIVE=1`

## Verify

Always run:

```bash
npm run guard:ai
```

Run these when required by `docs/agent-pack/PRE_MERGE_CHECKLIST.md`:

```bash
npm run test
npm run build
```

For branch-based review or CI-style checks:

```bash
npm run guard:ai -- --diff-base origin/main
```

CI uses the same shared quality floor through `.github/workflows/ai-governance.yml`.

## Development

Common commands:

```bash
npm install
npm run guard:ai
npm run test
npm run dev
npm run build
npm run review:docker:all
npm run smoke:live
npm run smoke:uniswap-lp-roundtrip
```

`npm run dev` starts the local dry-run host and prints a startup summary that exposes runtime lifecycle plus MCP and Telegram surface state. When MCP stdio is enabled, startup summary goes to `stderr` so the protocol stream stays clean.

### Capability probes

Structured probes help determine whether real adapter branches are viable:

```bash
npx tsx scripts/probe-onchainos.ts
npx tsx scripts/probe-x402.ts
```

### Third-party install review

Do not treat adapter code as approval to install third-party tools directly on the host.

Review commands:

```bash
npm run review:docker:onchainos
npm run review:docker:uniswap
npm run review:docker:all
```

Reference docs:

- `docs/third-party-install-review.md`
- `docs/third-party-review-baseline.md`

### Operator Bootstrap

Operator-facing required inputs during `npm run init`:

- `PHALANX_RUNTIME_MODE=live`
- `TELEGRAM_BOT_TOKEN`
- `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`
- `AGENT_WALLET_ADDRESS` or `PHALANX_WALLET_ADDRESS`

Demo-ready additions:

- `POLICY_OWNER_KEY`
- `WHITELIST_POLICY_ADDRESS`
- `PHALANX_OWNER_EVM_ADDRESS`
- `BASE_RPC_URL`

Derived / fixed / auto-persisted values:

- `TELEGRAM_ALLOWED_USER_ID` is written automatically after the first successful Telegram `/claim`
- `OMRATE_API_KEY` is optional
- `OMRATE_API_BASE_URL` defaults to `https://api.omrate.com`
- `XLAYER_RPC_URL` defaults to the official `https://rpc.xlayer.tech`
- x402 baseline does not require a local `PHALANX_X402_PRIVATE_KEY`

### Telegram Operator Surface

Once the runtime is `READY`, the bound Telegram owner chat can use bounded operator queries for:

- readiness / pending approvals
- portfolio / balances / positions
- recent events / guardian actions / tx refs
- why blocked / what next
- whitelist / policy summary
- risk summary / guardian assessment
- owner wallet / agent wallet / binding summary

This is intentionally a bounded keyword router, not an open-ended chat assistant. Unsupported requests are redirected to the supported capability list.

### Live-capable runtime

The runtime is live-capable, but still degrades safely when credentials, RPC endpoints, binaries, or contract addresses are missing.

Useful toggles:

- `PHALANX_ENABLE_MCP_STDIO=1`
- `PHALANX_EXECUTION_BACKEND=onchainos_skill`
- `PHALANX_X402_PAYMENT_ENABLED=1`
- `PHALANX_DRY_RUN_KEEPALIVE=0`
- `PHALANX_GUARDIAN_ENABLED=1`

### Live smoke

```bash
npm run smoke:live
PHALANX_SMOKE_SYNTHETIC_READY=1 npm run smoke:live
```

For operator bootstrap verification, also run:

```bash
npm run init
```

Approval / reporting behavior:

- Guardian and runtime events can emit Telegram execution reports
- blocked actions route into Telegram approval when policy requires it
- approval callbacks resume through `RuntimeCore`, not a side channel
- the rebalance demo path now carries structured pool / swap / LP / approval metadata into runtime events and Telegram/operator queries

### Uniswap LP live roundtrip

```bash
npm run smoke:uniswap-lp-roundtrip
```

Required env for the focused operator roundtrip:

- `PHALANX_LP_INVESTMENT_ID`
- `PHALANX_LP_AMOUNT`
- `PHALANX_LP_AMOUNT_SECONDARY`
- `PHALANX_LP_TICK_LOWER`
- `PHALANX_LP_TICK_UPPER`

For why live Uniswap V3 execution uses direct `NonfungiblePositionManager` calldata instead of the default high-level LP route, see `docs/uniswap-v3-direct-execution.md`.

## Security

- Never commit `.env`, `config.env`, wallet keys, API secrets, or real operational credentials.
- Use `config.env.example` as a template only.
- Treat local hooks as helpful, not sufficient; CI is the final enforcement layer.
- Review third-party tool installation in Docker before considering host installation.
- Keep MCP env values local and out of version control.

## License

No public license is declared in this repository yet. Until a formal license is added, treat the repo as internal/private and do not assume redistribution rights.
