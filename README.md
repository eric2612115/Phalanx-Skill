# OmRate Skill

Isolated skill/action-plane repository for OmRate hackathon submission.

## Purpose

This repository is reserved for the agent-facing execution layer that should not
be mixed into the normal OmRate frontend or backend data-plane code.

## Intended scope

- Agent wallet and signing flows
- x402 payment and settlement integrations
- Execution-channel adapters
- Stable action interfaces that call OmRate backend APIs
- Policy-aware orchestration for agent actions

## Out of scope

- UI components
- Generic market data fetchers
- Direct database access
- Reimplementing backend auth or persistence

## Suggested starting structure

When implementation starts, keep a clean module boundary such as:

- `src/skill/clients/`: calls into OmRate backend APIs
- `src/skill/wallets/`: wallet providers and signing
- `src/skill/payments/`: x402 and payment-channel integrations
- `src/skill/policies/`: action-policy checks
- `tests/`: isolated execution and adapter tests

## Relationship to other repositories

- `OmRate-Backend`: data plane, auth, DB, admin, API source of truth
- `OmRate-frontend`: user-facing product UI
- `OmRate-Skill`: dedicated action plane for hackathon and future agent work

## Status

This repo currently contains a clean skeleton only. Implementation should begin
here instead of being mixed back into the frontend or backend repositories.
