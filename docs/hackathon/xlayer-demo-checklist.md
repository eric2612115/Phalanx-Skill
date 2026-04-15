# X Layer Demo Checklist

Use this checklist for the current hackathon recording and submission rehearsal for **AgentPhalanx** (checkout: `Phalanx-Skill`).

## Goal

Primary target:

- stable `deposit` live mainline

Stronger optional proof:

- show the already live-proven `deposit -> tokenId discovery -> withdraw` lifecycle after the default deposit cut

## Preflight

1. Confirm `config.env` is present and matches the current live setup.
2. Confirm the active wallet selection is correct for the current chain.
3. Confirm small test funds are already in the Agentic Wallet.
4. Confirm Telegram bot and owner chat are working, and that only one bot poller is active for this token.
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
3. Open the private bot chat and confirm `/start` / `/help` respond in the intended owner chat.
4. Trigger the LP deposit path.
5. Capture the Telegram approval request.
6. Approve in Telegram.
7. Capture the resumed runtime execution.
8. Capture the live tx refs.

If you are recording the fuller allocation story instead of the default deposit cut:

1. Confirm `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1`.
2. Confirm `PHALANX_FLOW_PROFILE` is compatible with the allocation story.
3. Capture grouped tx links plus `x402 summary` / runtime evidence after the flow completes.

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

> AgentPhalanx is a self-custodial, local-first Agentic runtime for X Layer-oriented DeFi operations, using OKX Onchain OS for execution, OmRate for paid intelligence, and Uniswap Skill for LP planning.
