# Phalanx-Skill Packaging Decisions

## Support matrix

| Host | Status | Install mode | Notes |
|---|---|---|---|
| Cursor | Supported now | Manual repo checkout + existing `.cursor/` assets | No fake `.cursor-plugin` metadata |
| Claude Code | Supported now | Manual repo checkout + root router docs | `.claude-plugin/INSTALL.md` is documentation only, not a claimed marketplace package |
| OpenAI Codex CLI | Supported now | Manual repo checkout + thin host guide | Uses repo docs plus optional MCP wiring |
| OpenClaw | Supported now | Manual repo checkout + thin host guide | Manual setup only |
| OpenCode | Supported now | Manual repo checkout + thin host guide | Manual setup only |
| Generic MCP-capable client | Supported now | Example config via `.mcp.json.example` | Uses the real stdio server entrypoint |

## Installable vs publishable

- **Installable now:** Yes. External users can clone the repo, install dependencies, read the SSOT docs, and wire the repo into supported hosts manually.
- **Publishable now:** No claim. This repo remains `private` and does not yet claim npm or marketplace release readiness.
- **`npx skills add` support:** Deferred. There is no verified public registry/package contract for this repo yet, so the install story remains manual and truthful.

## Primary install story

The primary install story for this phase is:

1. clone the repo
2. run `npm install`
3. read `docs/agent-pack/GOVERNANCE.md`
4. follow the relevant host `INSTALL.md`
5. verify with `npm run guard:ai`

This phase does **not** promise a registry-backed one-command installer.

## Final directory tree diff

```text
docs/
  agent-pack/
    DECISIONS.md
    GOVERNANCE.md
    PRE_MERGE_CHECKLIST.md
.codex/
  INSTALL.md
.openclaw/
  INSTALL.md
.opencode/
  INSTALL.md
.claude-plugin/
  INSTALL.md
AGENTS.md
CLAUDE.md
.mcp.json.example
README.md
package.json
```

## Rejected or deferred formats

- `.cursor-plugin/` is deferred because no stable, documented packaging format was verified in this session. Cursor is supported through the checked-in `.cursor/rules/` and `.cursor/hooks.json` assets plus README instructions.
- Claude marketplace/plugin automation is deferred. `.claude-plugin/INSTALL.md` is a thin manual-install guide, not a claim of marketplace compatibility.
- npm publishing metadata is intentionally not expanded into a release promise until package ownership, release policy, and public tarball boundaries are explicitly approved.

## Packaging constraints

- Do not weaken `.cursor/rules/`, hooks, `guard:ai`, or CI to make installation look easier.
- Do not duplicate long governance prose across host guides.
- Do not ship secrets, `config.env`, or local-only credentials in any future published artifact.
