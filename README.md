# Phalanx Skill

Action-plane repository for Phalanx: wallet execution, signing, x402 flows, and orchestration that integrate with OmRate.

## Purpose

This repository holds the agent-facing execution layer. It stays separate from OmRate frontend (UI) and backend (data plane, auth, DB) so boundaries stay clear.

## Current status

**Active implementation.** The repo now includes:

- a dry-run runtime host behind `npm run dev`
- MCP status / portfolio / action entrypoints
- Telegram setup and approval routing primitives
- bounded local memory / secret-guard / policy / risk pipeline
- guarded adapter contracts and Docker review scripts for third-party install surfaces

Execution adapters still default to dry-run / normalized contract behavior unless real external tooling is intentionally wired in.

## Out of scope

- UI components and browser app state
- Generic market data fetchers owned by backend
- Direct database access
- Reimplementing backend auth or persistence

## In scope (action plane)

- Agent wallet and signing flows
- x402 payment and settlement integrations
- Execution-channel adapters
- Stable action interfaces that call OmRate backend APIs
- Policy-aware orchestration for agent actions

## Relationship to other repositories

- `OmRate-Backend`: data plane, auth, DB, admin, API source of truth
- `OmRate-frontend`: user-facing product UI
- `Phalanx-Skill`: action-plane implementation (this repo)

## Capability probes

Structured probes (JSON on stdout) inform adapter branching before execution code hardens:

```bash
npx tsx scripts/probe-onchainos.ts
npx tsx scripts/probe-x402.ts
```

The onchainos probe runs `onchainos wallet login --help` and `onchainos defi list --chain base`, then normalizes **walletLogin**, **lendingProtocols**, **lpProtocols**, and **rawCommandsRun** (per-command argv, exit status, stdout/stderr, spawn errors). Missing binaries or failures are reported in that structure instead of crashing.

The x402 probe creates a temp npm project, runs `npm install @x402/fetch`, then imports the package with Node—so resolution matches real adapter installs. Requires `npm` on PATH and registry access; failures are normalized in JSON like other probes.

## Third-party install review

Do not treat adapter code as implicit approval to install third-party tools directly on the host.

Review commands:

```bash
npm run review:docker:onchainos
npm run review:docker:uniswap
npm run review:docker:all
```

Reference docs:

- `docs/third-party-install-review.md`
- `docs/third-party-review-baseline.md`

Current rule: installer behavior is reviewed in Docker first; host installation is a separate decision.

### Release decision rules (P0 / probes)

- Capability probes decide which adapter branches are viable.
- **Lending:** if a preferred lending path fails but another supported path exists in the same category, substitution is allowed without redefining the product goal.
- **LP (Uniswap / PancakeSwap):** these are P0 product targets, not optional examples. Probes may change the execution adapter branch, but **must not silently swap the protocol target**. If either target is impossible, treat it as a **scope review** event, not an invisible substitution.

## Local development

```bash
npm install
npm run test
npm run dev
npm run build
npm run review:docker:all
npm run smoke:live
```

`npm run dev` starts the local dry-run host and prints a startup summary that exposes current lifecycle plus the local MCP / Telegram surface state. It keeps the process alive by default for local verification.

Useful env flags:

- `PHALANX_DRY_RUN_KEEPALIVE=0` - print startup summary and exit
- `PHALANX_GUARDIAN_ENABLED=1` - enable the local Guardian ticker during dry-run

## Live-capable runtime

The current runtime is live-capable, but it still degrades safely when credentials, RPC endpoints, binaries, or contract addresses are missing.

`config.env` is loaded at startup. Important fields:

- `PHALANX_RUNTIME_MODE=live`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`
- `OMRATE_API_KEY`, `OMRATE_API_BASE_URL`
- `XLAYER_RPC_URL`, `BASE_RPC_URL`
- `POLICY_OWNER_KEY`, `WHITELIST_POLICY_ADDRESS`

Optional live toggles:

- `PHALANX_ENABLE_MCP_STDIO=1` to attach MCP stdio transport
- `PHALANX_EXECUTION_BACKEND=onchainos_skill` to route state-changing execution through the skill-backed executor instead of the dry-run fallback
- `PHALANX_X402_PAYMENT_ENABLED=1` with private key env to attempt x402-wrapped fetch paths
- protocol-specific env for Uniswap / Pancake quote or position reads

## Live smoke

Use the smoke script to verify startup and runtime orchestration:

```bash
npm run smoke:live
```

If your real credentials are not loaded yet, you can still verify the approval/resume path with a synthetic READY host:

```bash
PHALANX_SMOKE_SYNTHETIC_READY=1 npm run smoke:live
```

This verifies:

- config loading from `config.env`
- startup summary
- MCP status path
- portfolio read when READY
- allowlisted execution path for a fixed policy item such as `uniswap-v3` without manual approval
- governance approval path for a blocked fixed policy item such as `pancakeswap-v3` -> Telegram callback -> RuntimeCore resume
- skill readiness snapshots for `onchainos` and `Uniswap liquidity-planner`

Short-term demo governance is intentionally modeled around fixed policy items such as `aave-v3`, `morpho-vaults`, `uniswap-v3`, `pancakeswap-v3`, and `whitelist-admin`. This is the compatibility layer that will later evolve into agent-managed policy bundles without rewriting the current approval plumbing.
