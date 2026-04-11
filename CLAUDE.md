# Phalanx Skill

Read `.cursor/rules/index.mdc` first.

This repository is an **active** action-plane implementation for Phalanx: wallet execution, signing, x402-related client behavior, and orchestration that calls OmRate backend APIs. It does not own the database, session issuance, or frontend UI.

- Prefer small, test-backed changes; run `npm run test` before claiming a change is done.
- Use the shared OmRate root rules for cross-repo boundaries and sync triggers when ownership or trust boundaries change.
