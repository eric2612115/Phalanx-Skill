# Phalanx Skill

Read these first:
- `docs/agent-pack/DECISIONS.md`
- `docs/agent-pack/GOVERNANCE.md`
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- `.cursor/rules/index.mdc`

This repository is an **active** action-plane implementation for Phalanx: wallet execution, signing, x402-related client behavior, and orchestration that calls OmRate backend APIs. It does not own the database, session issuance, or frontend UI.

- Prefer small, test-backed changes.
- Run `npm run guard:ai` before closing out boundary-sensitive work.
- Run `npm run test` before claiming a behavior change is done.
- Use the shared OmRate root rules for cross-repo boundaries and sync triggers when ownership or trust boundaries change.
