# Claude Code Install

**AgentPhalanx** is the product name for this action-plane runtime (repository folder: `Phalanx-Skill`).

Status: supported now through **manual setup**.

This directory is a thin host-facing guide only. It does **not** claim a verified marketplace or plugin-manifest format for Claude Code in this repo.

## Read first

- `docs/agent-pack/DECISIONS.md`
- `docs/agent-pack/GOVERNANCE.md`
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- `CLAUDE.md`

## Install

1. Clone the repository locally.
2. Run `npm install`.
3. Open the repository in Claude Code as a normal project workspace.
4. Ensure the repo entry docs are read before editing: `CLAUDE.md`, then `.cursor/rules/index.mdc`.

## Verify

Run:

```bash
npm run guard:ai
```

Run `npm test` and `npm run build` when required by `docs/agent-pack/PRE_MERGE_CHECKLIST.md`.

## Secrets

- Never commit `.env`, `config.env`, wallet material, or real API credentials.
- Use example env files as templates only.

## MCP

If you want Claude Code to talk to the AgentPhalanx MCP server, start from `.mcp.json.example` and wire `PHALANX_*` env values locally.
