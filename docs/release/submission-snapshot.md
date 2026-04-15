# AgentPhalanx Submission Snapshot

This document defines the minimum release/submission posture for the current private `AgentPhalanx` snapshot.

## Snapshot Identity

- product name: `AgentPhalanx`
- repository / npm compatibility id: `Phalanx-Skill` / `phalanx-skill`
- package version: `0.1.0`
- snapshot date: `2026-04-14`
- release posture: private submission artifact, not public package distribution

## Verified On This Snapshot

Fresh local verification for this snapshot:

- `npm run test`
- `npm run build`
- `npm run guard:ai`

Current story boundary:

- default recording cut: stable `deposit` mainline
- stronger lifecycle proof: live-proven `deposit -> tokenId discovery -> withdraw`
- fuller product story: proactive allocation + `x402` visibility when the allocation demo env is enabled

## Tag And Version Convention

Use these conventions for future internal cuts:

- npm/package version: keep semver in `package.json`
- repo tag for private review cuts: `agentphalanx-v<package-version>`
- optional dated demo tag when multiple review cuts share one semver: `agentphalanx-YYYYMMDD-<label>`

Examples:

- `agentphalanx-v0.1.0`
- `agentphalanx-20260414-demo`
- `agentphalanx-20260414-arena`

## Submission Packaging Rules

- treat `README.md` as the judge-facing entrypoint
- keep `docs/live-demo-runbook.md` as the operator replay source of truth
- keep `docs/hackathon/xlayer-demo-checklist.md` as the recording checklist
- keep `docs/telegram-first-acceptance-matrix.md` as the Telegram/operator acceptance contract

## License / Redistribution Posture

- package metadata declares `UNLICENSED`
- root `LICENSE` states private/internal evaluation use and all-rights-reserved posture
- do not imply public reuse, redistribution, or marketplace packaging rights
