# AgentPhalanx agents (Phalanx-Skill)

**AgentPhalanx** is the product-facing name; this repository folder remains `Phalanx-Skill` and compatibility-sensitive identifiers such as `PHALANX_*` env keys are unchanged.

Read these in order before making changes:

1. `docs/agent-pack/DECISIONS.md`
2. `docs/agent-pack/GOVERNANCE.md`
3. `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
4. `.cursor/rules/index.mdc`
5. `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`
6. `docs/superpowers/plans/2026-04-14-xlayer-arena-revamp-plan.md`
7. `docs/live-demo-runbook.md`

## What this repo is

**AgentPhalanx** (implemented in `Phalanx-Skill`) is a self-custodial, local-first action-plane runtime for X Layer-oriented DeFi operations. It uses `Onchain OS` as the execution substrate, `OmRate` as the paid intelligence layer, and `Uniswap Skill` as the LP planning layer.

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
- Prefer shared root routers and one SSOT over host-specific prompt folders.
- Treat `config.env` as local-only; never commit real secrets.
- Treat the live `deposit -> tokenId discovery -> withdraw` roundtrip as verified; do not overclaim richer LP reporting beyond what the README and runbook currently state.
- Protect the already-proven deposit live mainline from regression.

## MCP

The repo includes a stdio MCP server for **AgentPhalanx**. See `.mcp.json.example` (uses `PHALANX_*` env keys) and the README install/verify sections for external wiring.
