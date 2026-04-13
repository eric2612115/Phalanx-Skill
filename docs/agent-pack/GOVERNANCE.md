# Phalanx-Skill Governance

This is the shared source of truth for humans and agents installing or modifying `Phalanx-Skill`.

## What governs this repo

- Cursor rules: `.cursor/rules/index.mdc`
- Cursor hooks: `.cursor/hooks.json`
- Repo guard: `scripts/ai-governance-guard.mjs`
- Local validation command: `npm run guard:ai`
- CI baseline: `.github/workflows/ai-governance.yml`

## Read these first

- Packaging decisions: `docs/agent-pack/DECISIONS.md`
- Pre-merge checks: `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- AI governance implementation history: `docs/superpowers/plans/2026-04-12-phalanx-ai-governance-rules.md`
- Multi-host productization plan: `docs/superpowers/plans/2026-04-12-phalanx-multi-host-productization.md`

## Short rule summary

- Keep `src/app/host.ts` as a composition root.
- Do not grow large adapters without considering extraction first.
- Do not hide approval, lifecycle, or governance policy inside adapters.
- If a change spans multiple major layers, write or update a plan before broad edits.
- Run `npm run guard:ai` before closing out boundary-sensitive work.

## Shared quality floor

Local hooks are useful, but CI is the final shared enforcement layer. If local hooks are disabled, the expectation does not change:

- `guard:ai` still applies
- docs and tests still need to stay aligned with runtime behavior
- broad changes still need planning, not silent sprawl
