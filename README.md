# Phalanx-Skill

**AgentPhalanx** remains the outward-facing product name for the current demo/runtime story, but this repository is being converged into **`Phalanx-Skill`**, a **secure DeFi action kernel**. It keeps the high-level `MCP / API / action` surface, `policy / whitelist / approval / risk` gates, execution adapters, and runtime evidence, while product-shell concerns such as Telegram ownership, mission loops, and long-term operator memory move to `DePhalanx`.

**Compatibility note:** the checkout folder, npm package id, and compatibility-sensitive identifiers such as `PHALANX_*` env keys remain unchanged during this split.

## Project Overview

`Phalanx-Skill` is the secure execution kernel of AgentPhalanx. It exposes bounded high-level action surfaces, enforces whitelist and approval gates, and captures execution evidence without owning the outer chat/channel product shell.

## Architecture Overview

The intended dependency direction is:

`OpenClaw -> DePhalanx -> Phalanx-Skill -> Onchain OS`

`Phalanx-Skill` owns:

- stable `MCP / API / action` contracts
- `policy`, `whitelist`, `approval`, and `risk` enforcement
- execution-side protocol adapters
- pending action state, resume semantics, and tx evidence

`Phalanx-Skill` does not own:

- Telegram / Discord / Slack product ownership
- mission loop and long-running operator shell logic
- mandate cognition and portfolio allocation reasoning

## Deployment Address

Current demo/runtime deployment model:

- `Phalanx-Skill`: local Node.js runtime
- OmRate execution-side endpoint: [https://api.omrate.com](https://api.omrate.com)
- Repo: [git@github.com:eric2612115/Phalanx-Skill.git](git@github.com:eric2612115/Phalanx-Skill.git)

**Full guide (current mixed operator flow, setup, config, commands, x402):** [docs/operator-guide.md](docs/operator-guide.md)

**Status:** the full **deposit → tokenId → withdraw** roundtrip is **live-proven**; deeper smoke notes and failure cases are in [docs/live-demo-runbook.md](docs/live-demo-runbook.md).

## Skill-first start

```bash
git clone git@github.com:eric2612115/Phalanx-Skill.git
cd Phalanx-Skill
npm install
npm start
```

`npm start` now points to the skill-only bootstrap path. If you still need the old mixed runtime while the split is in progress, use:

```bash
npm run init
npm run start:compat
```

**Boundary:** `npm start` = kernel-first startup; `npm run start:compat` = temporary mixed runtime path while Telegram/product ownership is still being migrated out.

## What this repo owns

- Secure DeFi action contracts over `MCP / API`
- Runtime `policy`, `whitelist`, `approval`, and `risk` gates
- Controlled protocol adapters for execution-facing flows
- Execution evidence, tx refs, pending state, and resume semantics

## Onchain OS Skill / Uniswap Skill Usage

- `Phalanx-Skill` is the layer that integrates execution-side capabilities from `Onchain OS`.
- It keeps `Onchain OS` behind bounded action contracts instead of exposing raw execution directly to the outer brain host.
- It also supports execution-facing protocol lanes such as `Uniswap`, `Aave`, and `Morpho`.
- In the demo path, the `Uniswap` leg is intentionally approval-gated so the kernel can return `pending_approval` rather than silently broadening execution authority.

## What moves out

- Telegram / Discord / Slack ownership
- Mission loop / guardian ownership
- Long-term operator memory and preference UX
- Portfolio-level strategy and `PhalanxLayer` cognition

See [docs/kernel-migration-matrix.md](docs/kernel-migration-matrix.md) for the explicit module-by-module split.

## What you need

- Node.js `>= 22`, `git`
- OKX API trio + Agentic wallet login email (see `config.env.example`)
- Optional: `OMRATE_API_KEY` (omit to use **x402-first** paid calls)

## Minimal config

- **User inputs:** `config.env` (from `config.env.example`)
- **Runtime defaults:** `service.env` (from `service.env.example`)

Typical execution-side keys: `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`, `OKX_AGENTIC_WALLET_LOGIN_EMAIL`, `PHALANX_OWNER_EVM_ADDRESS`. `TELEGRAM_BOT_TOKEN` remains part of the current compatibility flow, but Telegram ownership is not the long-term product surface of `Phalanx-Skill`.

OmRate API base (default in `service.env`): [https://api.omrate.com](https://api.omrate.com)

## Common commands (copy)

```bash
npm run smoke:live
npm run guard:ai
```

## Operating Mechanism

At runtime the kernel receives a bounded action request, validates it through policy and whitelist checks, executes only the allowed protocol steps, captures tx evidence, and returns either:

- `completed` with execution evidence
- `pending_approval` with resume metadata
- `approval_resolution` after a host such as `DePhalanx` calls `phalanx_approval_decision`
- explicit failure when the route is unsupported or blocked

This makes `Phalanx-Skill` the execution truth layer while letting `DePhalanx` own the operator conversation and approval UX.

## X Layer Positioning

Within the X Layer ecosystem, `Phalanx-Skill` is positioned as a reusable secure DeFi execution kernel for agentic portfolio flows. It is designed to let a product layer include X Layer allocations and x402-powered intelligence without giving the outer brain unrestricted fund-moving authority.

## Team

- Eric
- X: `@PeakSan958457`

## AI editor entry

If you open this repo in Cursor, Claude Code, Codex-compatible tools, or another AI editor, start from:

- `README.md` for repo boundary and product context
- `AGENTS.md` or `CLAUDE.md` for repo routing
- `docs/kernel-migration-matrix.md` for the active split map
- `docs/agent-pack/DECISIONS.md` for the shared support matrix and SSOT
- `.cursor/rules/` only when the host understands Cursor rules directly
- `.mcp.json.example` if you want MCP wiring

## Documentation links

| Doc | Purpose |
| --- | --- |
| [docs/operator-guide.md](docs/operator-guide.md) | Full operator setup, Telegram flow, config, x402, commands |
| [docs/README.md](docs/README.md) | Map of all docs |
| [docs/kernel-migration-matrix.md](docs/kernel-migration-matrix.md) | Explicit keep/split/move map during the `Phalanx-Skill` convergence |
| [docs/live-demo-runbook.md](docs/live-demo-runbook.md) | Runbook, smoke prerequisites, failure discipline |
| [docs/agent-pack/DECISIONS.md](docs/agent-pack/DECISIONS.md) | AI-editor support matrix; contributors read this |

## Security

Do not commit `config.env`, `service.env`, or real keys. Use `*.example` files only as templates.

## License

`UNLICENSED` and private by default. See `LICENSE`.
