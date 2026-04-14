# Phalanx-Skill Agents

Read these in order before making changes:

1. `docs/agent-pack/DECISIONS.md`
2. `docs/agent-pack/GOVERNANCE.md`
3. `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
4. `.cursor/rules/index.mdc`
5. `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`
6. `docs/superpowers/plans/2026-04-14-xlayer-arena-revamp-plan.md`
7. `docs/live-demo-runbook.md`

## What this repo is

`Phalanx-Skill` is a self-custodial, local-first action-plane runtime for X Layer-oriented DeFi operations. It uses `Onchain OS` as the execution substrate, `OmRate` as the paid intelligence layer, and `Uniswap Skill` as the LP planning layer.

## Critical commands

```bash
npm run init
npm install
npm run guard:ai
npm run test
npm run build
npm run dev
```

## Key constraints

- Keep `src/app/host.ts` as a composition root.
- Do not hide policy or governance decisions inside adapters.
- Prefer thin host-specific docs that route back to SSOT.
- Treat `config.env` as local-only; never commit real secrets.
- Do not describe `withdraw` or full LP reporting as done unless they are actually verified.
- Protect the already-proven deposit live mainline from regression.

## MCP

The repo includes a stdio MCP server. See `.mcp.json.example` and the README install/verify sections for external wiring.
