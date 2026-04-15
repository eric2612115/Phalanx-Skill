# AgentPhalanx

**AgentPhalanx** is a self-custodial, local-first DeFi agent runtime: you run it locally, operate it through **Telegram**, and use **Onchain OS** + **OKX Agentic Wallet** for execution, with **OmRate** as paid intelligence over `x402` (X Layer preferred). The repo folder is still named `Phalanx-Skill` for tooling compatibility.

**Full guide (setup, config, commands, x402):** [docs/operator-guide.md](docs/operator-guide.md)

**Status:** the full **deposit → tokenId → withdraw** roundtrip is **live-proven**; deeper smoke notes and failure cases are in [docs/live-demo-runbook.md](docs/live-demo-runbook.md).

## Quick start (copy)

```bash
git clone git@github.com:eric2612115/AgentPhalanx.git
cd AgentPhalanx
npm install
npm run init
npm start
```

Then in Telegram (private chat with your bot): `/start` → `/claim` → `confirm`, and finish the wizard.

**Split:** terminal = install + env + `npm start`; Telegram = claim, onboarding, approvals, day-to-day operator commands.

## What you need

- Node.js `>= 22`, `git`, Telegram account
- OKX API trio + Agentic wallet login email (see `config.env.example`)
- Optional: `OMRATE_API_KEY` (omit to use **x402-first** paid calls)

## Minimal config

- **User inputs:** `config.env` (from `config.env.example`)
- **Runtime defaults:** `service.env` (from `service.env.example`)

Typical required keys: `TELEGRAM_BOT_TOKEN`, `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`, `OKX_AGENTIC_WALLET_LOGIN_EMAIL`, `PHALANX_OWNER_EVM_ADDRESS`. After `/claim`, `TELEGRAM_ALLOWED_USER_ID` is usually written for you.

OmRate API base (default in `service.env`): [https://api.omrate.com](https://api.omrate.com)

## Common commands (copy)

```bash
npm run smoke:live
npm run guard:ai
```

## AI editor entry

If you open this repo in Cursor, Claude Code, Codex-compatible tools, or another AI editor, start from:

- `README.md` for product context
- `AGENTS.md` or `CLAUDE.md` for repo routing
- `docs/agent-pack/DECISIONS.md` for the shared support matrix and SSOT
- `.cursor/rules/` only when the host understands Cursor rules directly
- `.mcp.json.example` if you want MCP wiring

## Documentation links

| Doc | Purpose |
| --- | --- |
| [docs/operator-guide.md](docs/operator-guide.md) | Full operator setup, Telegram flow, config, x402, commands |
| [docs/README.md](docs/README.md) | Map of all docs |
| [docs/live-demo-runbook.md](docs/live-demo-runbook.md) | Runbook, smoke prerequisites, failure discipline |
| [docs/agent-pack/DECISIONS.md](docs/agent-pack/DECISIONS.md) | AI-editor support matrix; contributors read this |

## Security

Do not commit `config.env`, `service.env`, or real keys. Use `*.example` files only as templates.

## License

`UNLICENSED` and private by default. See `LICENSE`.
