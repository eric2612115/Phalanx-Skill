# Phalanx-Skill Agents

Read these in order before making changes:

1. `docs/agent-pack/DECISIONS.md`
2. `docs/agent-pack/GOVERNANCE.md`
3. `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
4. `.cursor/rules/index.mdc`

## What this repo is

`Phalanx-Skill` is the OmRate action-plane repository for wallet execution, signing, x402 flows, MCP exposure, and governance-aware orchestration against backend APIs.

## Critical commands

```bash
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

## MCP

The repo includes a stdio MCP server. See `.mcp.json.example` and the README install/verify sections for external wiring.
