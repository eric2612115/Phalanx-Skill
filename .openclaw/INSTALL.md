# OpenClaw Install

Status: supported now through **manual setup**.

## Read first

- `docs/agent-pack/DECISIONS.md`
- `docs/agent-pack/GOVERNANCE.md`
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md`

## Install

1. Clone the repository locally.
2. Run `npm install`.
3. Point OpenClaw at this repo as the working project.
4. Ensure the agent entry docs are read first: `AGENTS.md` and `.cursor/rules/index.mdc`.

## Verify

Run:

```bash
npm run guard:ai
```

If your changes touch runtime behavior, tests, or startup wiring, follow `docs/agent-pack/PRE_MERGE_CHECKLIST.md` for `npm test` and `npm run build`.

## Secrets

- Never commit `.env`, `config.env`, wallet material, or API credentials.
- Use example env files only as templates.

## MCP

For MCP-capable OpenClaw flows, start from `.mcp.json.example` and provide env values locally rather than in version control.
