# Phalanx-Skill Packaging Decisions

## Support matrix

| Host | Status | Install mode | Notes |
|---|---|---|---|
| Cursor | Supported now | Manual repo checkout + shared root docs | `.cursor/` stays as the only editor-native rule bundle |
| Claude Code | Supported now | Manual repo checkout + shared root docs | Use `README.md` + `CLAUDE.md` + shared docs |
| OpenAI Codex CLI | Supported now | Manual repo checkout + shared root docs | Use `README.md` + `AGENTS.md` + shared docs |
| OpenClaw | Supported now | Manual repo checkout + shared root docs | Use shared root docs rather than host-specific install wrappers |
| OpenCode | Supported now | Manual repo checkout + shared root docs | Use shared root docs rather than host-specific install wrappers |
| Generic MCP-capable client | Supported now | Example config via `.mcp.json.example` | Uses the real stdio server entrypoint |

## Installable vs publishable

- **Installable now:** Yes. External users can clone the repo, install dependencies, read the SSOT docs, and wire the repo into supported hosts manually.
- **Publishable now:** No claim. This repo remains `private` and does not yet claim npm or marketplace release readiness.
- **`npx skills add` support:** Deferred. There is no verified public registry/package contract for this repo yet, so the install story remains manual and truthful.

## Primary install story

The primary install story for this phase is:

1. clone the repo
2. run `npm install`
3. read `README.md`
4. read `AGENTS.md` or `CLAUDE.md`
5. read `docs/agent-pack/GOVERNANCE.md`
6. verify with `npm run guard:ai`

This phase does **not** promise a registry-backed one-command installer.

## Current hackathon positioning

For the current `X Layer Arena` submission, the repo should be understood as:

- a self-custodial, local-first Agentic application
- built on top of `Onchain OS` as the execution substrate
- using `OmRate` as the paid intelligence layer
- using `Uniswap Skill` as the LP planning layer

It should **not** be described as:

- a hosted wallet-control SaaS
- a replacement for OKX custody/signing infrastructure
- a generic skill marketplace package

## Final directory tree diff

```text
docs/
  agent-pack/
    DECISIONS.md
    GOVERNANCE.md
    PRE_MERGE_CHECKLIST.md
.cursor/
  rules/
  hooks.json
.agents/
  skills/
AGENTS.md
CLAUDE.md
.mcp.json.example
README.md
package.json
```

## Rejected or deferred formats

- `.cursor-plugin/` is deferred because no stable, documented packaging format was verified in this session. Cursor is supported through the checked-in `.cursor/rules/` and `.cursor/hooks.json` assets plus root docs.
- Host-specific thin install wrappers (`.claude-plugin/`, `.codex/`, `.openclaw/`, `.opencode/`) are intentionally removed from the product-facing root because they duplicated the same instructions and made the repo look like a host compatibility dump.
- The old multi-host `skills` symlink farm (`.claude/`, `.continue/`, `.roo/`, etc.) is intentionally removed. Shared continuation context now lives in `README.md`, `AGENTS.md`, `CLAUDE.md`, and `docs/agent-pack/*`.
- npm publishing metadata is intentionally not expanded into a release promise until package ownership, release policy, and public tarball boundaries are explicitly approved.

## Packaging constraints

- Do not weaken `.cursor/rules/`, hooks, `guard:ai`, or CI to make installation look easier.
- Do not duplicate long governance prose across host guides.
- Do not ship secrets, `config.env`, or local-only credentials in any future published artifact.
