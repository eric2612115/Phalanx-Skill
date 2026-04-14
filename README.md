# Phalanx Skill

`Phalanx-Skill` is a self-custodial, local-first Agentic runtime for X Layer-oriented DeFi operations. It uses `Onchain OS` as the execution substrate, `OmRate` as the paid intelligence layer, and `Uniswap Skill` as the LP planning layer.

This repo is being prepared for `X Layer Arena`, not packaged as a hosted SaaS or a generic skill marketplace item.

## What It Is

`Phalanx-Skill` owns the action-plane layer for Phalanx:

- MCP entrypoints and runtime orchestration
- policy, risk, whitelist, and approval flow
- Telegram approval and operator routing
- planner-to-execution handoff
- x402-aware OmRate access
- live execution through `Onchain OS`

It is **not**:

- the OmRate data plane or backend source of truth
- the frontend UI
- a replacement for OKX wallet custody or signing infrastructure
- a hosted control plane that asks users to trust cloud-managed private keys

## Why Local-First

The trust model is deliberate:

- `Onchain OS` remains the execution and signing boundary
- the operator keeps local control over runtime and credentials
- Phalanx adds governance, approval, and orchestration on top of the existing OKX execution substrate

This repo should be read as a local/self-hosted Agentic application, not as an attempt to reimplement wallet infra or move custody into a SaaS.

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

The currently proven live story is:

1. trigger or prepare the LP action
2. route into Telegram approval
3. approve in Telegram
4. update whitelist locally
5. resume original action through `RuntimeCore`
6. execute live `approve -> deposit`
7. collect tx refs

## Current Gaps

These are known and intentionally not overclaimed:

- richer Telegram LP position detail reporting
- final cleanup of wallet auto-resolution so managed Onchain OS addresses are primary everywhere
- stable no-override recording config for every live path

For today's demo target, `deposit` mainline is the blocker. `withdraw` is an additive win.

## Install

Primary install story for the current phase:

```bash
git clone <your-copy-of-this-repo>
cd Phalanx-Skill
npm install
npm run init
```

`npm run init` is the operator bootstrap entrypoint. It will:

- create `config.env` from `config.env.example` when needed
- create `service.env` from `service.env.example` when needed
- report `operator_ready` vs `demo_ready`
- separate required keys from optional keys
- treat `OMRATE_API_KEY` as optional
- point the operator to the next Telegram `/claim` step

Then read these in order:

1. `docs/agent-pack/DECISIONS.md`
2. `docs/agent-pack/GOVERNANCE.md`
3. `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
4. `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`
5. `docs/live-demo-runbook.md`

## Operator Bootstrap

Minimum human-entered inputs for live operator mode:

- `TELEGRAM_BOT_TOKEN`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `PHALANX_OWNER_EVM_ADDRESS`

`config.env` is user-facing only:

- `TELEGRAM_ALLOWED_USER_ID` is auto-written after the first successful `/claim`
- `OMRATE_API_KEY` is optional

`service.env` owns service/runtime defaults:

- `OMRATE_API_BASE_URL` defaults to `https://api.omrate.com`
- `BASE_RPC_URL` defaults to `https://mainnet.base.org`
- `XLAYER_RPC_URL` defaults to `https://rpc.xlayer.tech`
- `PHALANX_RUNTIME_MODE`, guardian flags, execution backend, whitelist targets, and governance write keys live there
- `POLICY_OWNER_KEY` and `WHITELIST_POLICY_ADDRESS` are future on-chain governance extensions, not current demo blockers

Wallet note:

- the long-term direction is `Onchain OS` managed-address-first selection, with env values as explicit overrides
- some live paths may still require an explicit wallet env while that cleanup is being finished

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

## Demo Focus

The main hackathon story is:

- OmRate contributes the intelligence layer
- x402 can sit inside the OmRate data-access narrative
- Uniswap Skill contributes planning and pool-selection evidence
- Phalanx applies policy/risk/approval/runtime orchestration
- `Onchain OS` executes the live chain action

For the current demo window:

- primary recording target: stable `deposit` live mainline
- full roundtrip is now available when you want the stronger lifecycle proof

See:

- `docs/live-demo-runbook.md`
- `docs/hackathon/xlayer-demo-checklist.md`
- `docs/uniswap-v3-direct-execution.md`
- `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`

## Telegram Operator Surface

Once the runtime is `READY`, the bound Telegram owner chat supports bounded operator queries such as:

- readiness / pending approvals
- portfolio / balances / positions
- recent events / guardian actions / tx refs
- why blocked / what next
- whitelist / policy summary
- risk summary / guardian assessment
- owner wallet / agent wallet / binding summary

This is intentionally a bounded operator surface, not a general chat assistant.

## Host-Specific Setup

- Cursor: use the checked-in `.cursor/rules/` and `.cursor/hooks.json`
- Claude Code: see `.claude-plugin/INSTALL.md`
- OpenAI Codex CLI: see `.codex/INSTALL.md`
- OpenClaw: see `.openclaw/INSTALL.md`
- OpenCode: see `.opencode/INSTALL.md`

## MCP

This repo includes a stdio MCP server. Start from:

- `.mcp.json.example`
- `src/mcp/stdio.ts`

When MCP stdio is enabled, startup output is written to `stderr` to keep the protocol stream clean.

## Security

- Never commit `.env`, `config.env`, `service.env`, wallet keys, API secrets, or real credentials.
- Use `config.env.example` and `service.env.example` as templates only.
- Treat local hooks as helpful, not sufficient; CI is the shared quality floor.
- Review third-party tool installation in Docker before host installation.
- Keep MCP env values local and out of version control.

## License

No public license is declared yet. Until a formal license is added, treat the repo as internal/private and do not assume redistribution rights.
