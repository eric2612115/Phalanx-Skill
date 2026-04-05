# Phalanx Skill

Isolated future skill/action-plane repository intended to integrate with Phalanx.

## Purpose

This repository is reserved for the future agent-facing execution layer that should
not be mixed into the normal OmRate frontend or backend data-plane code.

## Current status

This repository is intentionally not under active implementation yet. It is being
kept as the future home for the Phalanx-side skill that will call OmRate APIs and
handle x402 payment flows when Phalanx itself is ready.

## Out of scope

- UI components
- Generic market data fetchers
- Direct database access
- Reimplementing backend auth or persistence

## Expected future scope

- Agent wallet and signing flows
- x402 payment and settlement integrations
- Execution-channel adapters
- Stable action interfaces that call OmRate backend APIs
- Policy-aware orchestration for agent actions

## Relationship to other repositories

- `OmRate-Backend`: data plane, auth, DB, admin, API source of truth
- `OmRate-frontend`: user-facing product UI
- `Phalanx-Skill`: future action-plane repo, to be implemented after Phalanx core is ready
