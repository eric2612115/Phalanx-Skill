# AgentPhalanx agents (Phalanx-Skill)

**AgentPhalanx** remains the product-facing name, but this repository is being converged into **`Phalanx-Skill`**, the secure DeFi action kernel. Compatibility-sensitive identifiers such as `PHALANX_*` env keys remain unchanged during the split.

Read these in order before making changes:

1. `docs/agent-pack/DECISIONS.md`
2. `docs/agent-pack/GOVERNANCE.md`
3. `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
4. `.cursor/rules/index.mdc`
5. `docs/kernel-migration-matrix.md`
6. `docs/superpowers/specs/2026-04-15-dephalanx-phalanx-skill-split-design.md`
7. `docs/live-demo-runbook.md`

## What this repo is

`Phalanx-Skill` is the secure action-plane kernel for the broader `AgentPhalanx` product story. It keeps high-level action contracts, policy/risk/approval gates, execution adapters, and evidence. It should not regain ownership of Telegram surfaces, mission loops, or long-term operator memory.

## Critical commands

```bash
npm install
npm run guard:ai
npm run test
npm run build
npm start
```

Use `npm run start:compat` only when you explicitly need the old mixed runtime during the migration.

## Key constraints

- Keep `src/app/host.ts` as a composition root.
- Do not hide policy or governance decisions inside adapters.
- Prefer shared root routers and one SSOT over host-specific prompt folders.
- Treat `config.env` as local-only; never commit real secrets.
- Treat Telegram, mission-loop, and operator UX modules as migration targets, not places to add fresh kernel behavior.
- Use `docs/kernel-migration-matrix.md` before touching `src/telegram/**`, `src/guardian/**`, `src/operator/**`, `src/demo/**`, or long-term memory modules.
- Treat the live `deposit -> tokenId discovery -> withdraw` roundtrip as verified; do not overclaim richer LP reporting beyond what the README and runbook currently state.
- Protect the already-proven deposit live mainline from regression.

## MCP

The repo includes a stdio MCP server for **AgentPhalanx**. See `.mcp.json.example` (uses `PHALANX_*` env keys) and the README install/verify sections for external wiring.
