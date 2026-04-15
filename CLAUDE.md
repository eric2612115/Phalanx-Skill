# AgentPhalanx (Phalanx-Skill)

**AgentPhalanx** is the outward-facing product name, but this checkout is being converged into **`Phalanx-Skill`**, the secure DeFi action kernel. The checkout folder and compatibility identifiers remain `Phalanx-Skill` / `phalanx-skill` / `PHALANX_*` as documented in `README.md`.

Read these first:
- `docs/agent-pack/DECISIONS.md`
- `docs/agent-pack/GOVERNANCE.md`
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- `.cursor/rules/index.mdc`
- `docs/kernel-migration-matrix.md`
- `docs/superpowers/specs/2026-04-15-dephalanx-phalanx-skill-split-design.md`
- `docs/live-demo-runbook.md`

This repository is the **active** `Phalanx-Skill` kernel for the broader **AgentPhalanx** product story. It keeps execution-safe action contracts, policy/risk/approval gates, `Onchain OS` execution integration, and evidence. It does not own the long-term Telegram product shell, mission-loop behavior, or portfolio-intelligence layer that will live in `DePhalanx`.

- Prefer small, test-backed changes.
- Run `npm run guard:ai` before closing out boundary-sensitive work.
- Run `npm run test` before claiming a behavior change is done.
- Use the shared OmRate root rules for cross-repo boundaries and sync triggers when ownership or trust boundaries change.
- Do not add new kernel dependencies on `src/telegram/**`, `src/guardian/**`, `src/operator/**`, or product-shell memory modules unless the split spec explicitly says so.
- Keep the deposit live mainline stable; the `deposit -> tokenId discovery -> withdraw` roundtrip is live-proven, so treat `withdraw` as re-verified rather than as an unfinished enhancement.
- Prefer the shared root docs (`README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/agent-pack/*`) over per-host prompt folders.
