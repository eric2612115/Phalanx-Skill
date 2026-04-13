# Phalanx-Skill Pre-Merge Checklist

Run this checklist before opening or merging a PR.

## Always

1. Run `npm run guard:ai`
2. Confirm host docs and SSOT instructions still match
3. Confirm no secrets or real credentials were added

## Run `npm test` when

- action flow changed
- approval flow changed
- adapter behavior changed
- runtime gating behavior changed
- MCP behavior changed
- operator-facing script behavior changed

## Run `npm run build` when

- TypeScript exports changed
- startup wiring changed
- env loading changed
- MCP startup path changed
- package metadata affects executable/runtime entry behavior

## Docs must be updated when

- required env vars changed
- install steps changed
- host support status changed
- MCP setup changed
- verification commands changed

## If verification was skipped

Document exactly:

- what was not run
- why it was skipped
- what still needs manual follow-up
