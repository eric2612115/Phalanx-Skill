# Codex CLI Install

**AgentPhalanx** is the product name for this action-plane runtime (repository folder: `Phalanx-Skill`).

Status: supported now through **manual setup**.

## Read first

- `docs/agent-pack/DECISIONS.md`
- `docs/agent-pack/GOVERNANCE.md`
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md`

## Install

1. Clone the repository locally.
2. Run `npm install`.
3. Open the repo in your Codex-compatible CLI workflow.
4. Make sure the agent reads `AGENTS.md` and `.cursor/rules/index.mdc` before editing.

## Verify

Run:

```bash
npm run guard:ai
```

Run `npm test` and `npm run build` when the checklist in `docs/agent-pack/PRE_MERGE_CHECKLIST.md` says they are required.

## Secrets

- Never commit `.env`, `config.env`, wallet keys, or real operational credentials.
- Use `config.env.example` and existing repo examples as templates only.

## MCP

If your Codex-compatible host supports MCP, use `.mcp.json.example` as the starting point for local wiring.
