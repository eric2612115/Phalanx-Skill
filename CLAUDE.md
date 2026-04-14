# Phalanx Skill

Read these first:
- `docs/agent-pack/DECISIONS.md`
- `docs/agent-pack/GOVERNANCE.md`
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- `.cursor/rules/index.mdc`
- `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`
- `docs/superpowers/plans/2026-04-14-xlayer-arena-revamp-plan.md`
- `docs/live-demo-runbook.md`

This repository is an **active** self-custodial, local-first action-plane implementation for Phalanx. It uses `Onchain OS` for execution, `OmRate` for paid intelligence, and `Uniswap Skill` for LP planning. It does not own the database, session issuance, or frontend UI.

- Prefer small, test-backed changes.
- Run `npm run guard:ai` before closing out boundary-sensitive work.
- Run `npm run test` before claiming a behavior change is done.
- Use the shared OmRate root rules for cross-repo boundaries and sync triggers when ownership or trust boundaries change.
- Keep the deposit live mainline stable; `withdraw` is still an in-progress enhancement unless re-verified.
