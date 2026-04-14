# X Layer Demo Checklist

Use this checklist for the current hackathon recording and submission rehearsal.

## Goal

Primary target:

- stable `deposit` live mainline

Bonus target:

- `withdraw` roundtrip lifecycle proof for a stronger end-to-end story

## Preflight

1. Confirm `config.env` is present and matches the current live setup.
2. Confirm the active wallet selection is correct for the current chain.
3. Confirm small test funds are already in the Agentic Wallet.
4. Confirm Telegram bot and owner chat are working.
5. Run:

```bash
npm run build
npm run guard:ai
```

6. Run focused tests:

```bash
npm test -- tests/uniswap-v3-execution.test.ts tests/uniswap-official-planner.test.ts
```

## Runtime Proof

1. Start the runtime.
2. Capture startup summary and readiness.
3. Trigger the LP deposit path.
4. Capture the Telegram approval request.
5. Approve in Telegram.
6. Capture the resumed runtime execution.
7. Capture the live tx refs.

## Evidence To Save

- startup summary
- Telegram approval screenshot
- terminal output showing resumed execution
- tx refs
- any planner/pool-selection evidence used in the narration

## Optional Extra Proof

Capture only if already stable:

- post-deposit position discovery
- tokenId evidence
- withdraw execution evidence
- post-withdraw state

## Submission Reminder

When describing the project, keep the wording consistent:

> Phalanx is a self-custodial, local-first Agentic runtime for X Layer-oriented DeFi operations, using OKX Onchain OS for execution, OmRate for paid intelligence, and Uniswap Skill for LP planning.
