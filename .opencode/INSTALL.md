# OpenCode Install

Status: supported now through **manual setup**.

## Read first

- `docs/agent-pack/DECISIONS.md`
- `docs/agent-pack/GOVERNANCE.md`
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md`

## Install

1. Clone the repository locally.
2. Run `npm install`.
3. Open the repo in OpenCode.
4. Make sure the agent uses `AGENTS.md` as the repo entry point and follows `.cursor/rules/index.mdc` for governance.

## Verify

Run:

```bash
npm run guard:ai
```

Use `npm test` and `npm run build` when required by `docs/agent-pack/PRE_MERGE_CHECKLIST.md`.

## Secrets

- Never commit `.env`, `config.env`, or real wallet/API secrets.
- Keep local configuration out of version control.

## MCP

If OpenCode supports MCP wiring, use `.mcp.json.example` as a local starting point and keep secrets in local env configuration only.
