# Agentic Rebalance Demo Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a replayable demo flow where Guardian/Telegram proactively proposes a rebalance, Phalanx pays x402 to OmRate for pool data, optionally swaps assets with OnchainOS, requests Telegram whitelist approval for `uniswap-v3`, deposits into Uniswap LP, and reports the result back to the user.

**Architecture:** Keep the existing Phalanx runtime as the control plane and add one thin orchestration lane for the demo. Reuse the current host, Telegram approval, Guardian cycle, Uniswap planner, OnchainOS swap, and direct Uniswap V3 LP execution path; only add the missing x402 payment integration and a deterministic orchestration layer that can be rehearsed repeatedly.

**Tech Stack:** TypeScript, Node.js, Phalanx host/runtime, OnchainOS CLI/skills, grammY Telegram bot, viem, Vitest

---

## File Map

**Create:**
- `docs/superpowers/plans/2026-04-08-agentic-rebalance-demo-flow.md` — this plan
- `src/demo/rebalance-flow.ts` — deterministic demo orchestration helpers for `x402 -> OmRate -> planner -> optional swap -> deposit`
- `scripts/demo-agentic-rebalance.ts` — operator-run rehearsal script that drives the full demo lane and captures proof output
- `tests/demo-rebalance-flow.test.ts` — focused orchestration tests for the new demo lane

**Modify:**
- `src/adapters/x402.ts` — replace local-key assumptions with an OnchainOS Agentic Wallet payment path for live x402
- `src/adapters/onchainos.ts` — add any missing x402 payment command/result helpers needed by the demo lane
- `src/adapters/omrate.ts` — expose a payment-aware OmRate execution path that can be invoked inside the demo orchestration
- `src/adapters/lp-execution.ts` — remain the single LP deposit execution boundary; the demo lane must feed this adapter rather than inventing a second deposit path
- `src/guardian/service.ts` — allow a demo-friendly Guardian trigger shape that carries user-facing rationale into Telegram/runtime events
- `src/app/host.ts` — wire the demo orchestration output into Guardian-triggered runtime handling and Telegram reporting
- `src/telegram/live.ts` — improve user-facing Telegram text for the proactive rebalance proposal, approval, and result report
- `src/executors/skill-backed.ts` — keep `swap` and `depositLpPosition` available to the demo lane with the correct live wallet defaults
- `package.json` — register a stable rehearsal command for the new end-to-end demo script
- `README.md` — document the full demo path, required env, and operator commands
- `docs/live-demo-runbook.md` — update the demo script section and evidence checklist for the new mainline flow

**Test:**
- `tests/adapter-contracts.test.ts`
- `tests/guardian-cycle.test.ts`
- `tests/mcp-approval-flow.test.ts`
- `tests/runtime-host.test.ts`
- `tests/uniswap-v3-execution.test.ts`
- `tests/demo-rebalance-flow.test.ts`

---

## Chunk 1: x402 Payment Via Agentic Wallet

### Task 1: Replace local-key-first x402 assumptions with OnchainOS-backed payment

**Files:**
- Modify: `src/adapters/x402.ts`
- Modify: `src/adapters/onchainos.ts`
- Test: `tests/adapter-contracts.test.ts`

- [ ] **Step 1: Write the failing x402 payment adapter tests**

Add tests that prove:
- when live x402 is enabled, the adapter no longer requires `PHALANX_X402_PRIVATE_KEY`
- the adapter can parse a `402 PAYMENT REQUIRED` response, select an accepted payment method, call the OnchainOS payment command, and build the replay proof/header
- missing Agentic Wallet / missing OnchainOS binary still returns structured failure rather than throwing
- success/failure shape is defined against one explicit OnchainOS payment contract, not an unspecified helper

- [ ] **Step 2: Run the focused test selection to verify it fails**

Run: `npm test -- tests/adapter-contracts.test.ts`

Expected: FAIL on the new x402 contract expectations

- [ ] **Step 3: Freeze the OnchainOS x402 contract before implementation**

Write down inside the code comments and test fixtures:
- which OnchainOS command is being called
- the exact fields expected back from stdout
- how those fields map to the replay proof/header
- which env vars are required for live execution

Do not proceed to adapter implementation until the command/result contract is explicit in the tests.

- [ ] **Step 4: Implement the minimal OnchainOS-backed x402 payment path**

Implementation notes:
- keep `src/adapters/x402.ts` focused on x402 parsing, proof building, and fetch/replay orchestration
- move actual signing/payment execution behind an OnchainOS helper in `src/adapters/onchainos.ts`
- prefer the active Agentic Wallet as the x402 buyer
- preserve structured degraded results for non-live or unconfigured environments

- [ ] **Step 5: Re-run the focused x402 tests**

Run: `npm test -- tests/adapter-contracts.test.ts`

Expected: PASS for the new x402 coverage

- [ ] **Step 6: Commit the x402 payment foundation**

```bash
git add src/adapters/x402.ts src/adapters/onchainos.ts tests/adapter-contracts.test.ts
git commit -m "feat: route x402 payments through agentic wallet"
```

---

## Chunk 2: Paid OmRate Query To Planner Handoff

### Task 2: Build a deterministic demo orchestration layer

**Files:**
- Create: `src/demo/rebalance-flow.ts`
- Modify: `src/adapters/omrate.ts`
- Modify: `src/adapters/lp-execution.ts`
- Test: `tests/demo-rebalance-flow.test.ts`

- [ ] **Step 1: Write the failing orchestration tests**

Add tests that prove the new orchestration layer:
- queries OmRate with x402-aware execution
- converts the paid OmRate response into a normalized candidate set
- invokes the existing Uniswap planner handoff
- returns a concrete execution bundle that includes planner output and a `depositLpPosition` payload seed

- [ ] **Step 2: Run the new orchestration tests to verify failure**

Run: `npm test -- tests/demo-rebalance-flow.test.ts`

Expected: FAIL because the orchestration module does not exist yet

- [ ] **Step 3: Implement the minimal orchestration module**

Implementation notes:
- keep `src/demo/rebalance-flow.ts` as a pure orchestration unit with injected dependencies
- do not embed Telegram or Guardian side effects here
- return a structured object with:
  - OmRate request/result summary
  - planner request/result summary
  - selected pool metadata
  - optional swap recommendation
  - final LP deposit payload seed that is explicitly shaped for `executeLpPositionIntent`

Responsibility note:
- `src/demo/rebalance-flow.ts` prepares the LP deposit payload
- `src/adapters/lp-execution.ts` remains the only execution adapter for the actual LP deposit
- do not add a second deposit execution path inside the demo module

- [ ] **Step 4: Run the orchestration tests again**

Run: `npm test -- tests/demo-rebalance-flow.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the paid-data orchestration layer**

```bash
git add src/demo/rebalance-flow.ts src/adapters/omrate.ts src/adapters/lp-execution.ts tests/demo-rebalance-flow.test.ts
git commit -m "feat: add paid omrate to planner demo orchestration"
```

---

## Chunk 3: Optional Swap As Mainline Demo Step

### Task 3: Make swap a first-class preparation step in the demo lane

**Files:**
- Modify: `src/demo/rebalance-flow.ts`
- Modify: `src/executors/skill-backed.ts`
- Test: `tests/demo-rebalance-flow.test.ts`
- Test: `tests/adapter-contracts.test.ts`

- [ ] **Step 1: Write the failing swap-path tests**

Add tests that prove:
- when the current wallet assets do not match the selected LP shape, the orchestration emits a concrete `swap` action
- when assets already match, the orchestration skips swap cleanly
- the swap payload maps onto the existing `executeOnchainosSwapExecution` contract without inventing a second swap lane

- [ ] **Step 2: Run the focused swap tests to verify failure**

Run: `npm test -- tests/demo-rebalance-flow.test.ts tests/adapter-contracts.test.ts`

Expected: FAIL on the new conditional swap expectations

- [ ] **Step 3: Implement the minimal swap-branch logic**

Implementation notes:
- keep swap optional but first-class
- represent it as a preparation step, not a separate demo
- prefer exact file/path reuse in `skill-backed.ts`; do not fork swap execution logic
- if wallet defaults or execution entry points are needed earlier, make that change here and update Chunk 2 tests rather than creating a parallel execution shortcut

- [ ] **Step 4: Re-run the focused swap tests**

Run: `npm test -- tests/demo-rebalance-flow.test.ts tests/adapter-contracts.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the swap preparation branch**

```bash
git add src/demo/rebalance-flow.ts src/executors/skill-backed.ts tests/demo-rebalance-flow.test.ts tests/adapter-contracts.test.ts
git commit -m "feat: add swap preparation step to rebalance demo"
```

---

## Chunk 4: Guardian/Telegram Mainline UX

### Task 4: Connect Guardian detection to the new demo lane and user-facing Telegram narrative

**Files:**
- Modify: `src/guardian/service.ts`
- Modify: `src/app/host.ts`
- Modify: `src/telegram/live.ts`
- Test: `tests/guardian-cycle.test.ts`
- Test: `tests/runtime-host.test.ts`
- Test: `tests/mcp-approval-flow.test.ts`

- [ ] **Step 1: Write the failing Guardian/Telegram tests**

Add tests that prove:
- Guardian can emit a proactive rebalance proposal carrying rationale
- Telegram receives a user-facing proposal/report before whitelist approval in mocked contract tests
- when `uniswap-v3` is blocked, the existing approval router still sends the whitelist approval request
- after approval, the action resumes and the result report includes pool choice, optional swap summary, and tx refs

- [ ] **Step 2: Run the Guardian/host/approval tests to verify failure**

Run: `npm test -- tests/guardian-cycle.test.ts tests/runtime-host.test.ts tests/mcp-approval-flow.test.ts`

Expected: FAIL on the new proactive demo flow expectations

- [ ] **Step 3: Implement the minimal host/reporting integration**

Implementation notes:
- keep the current whitelist approval router unchanged
- add a demo-friendly reporting layer around it, not a second approval system
- ensure the proposal message and the approval message are distinct
- keep result reporting tied to runtime events so the proof bundle remains consistent
- automated tests here are contract/mock tests only; real Telegram delivery is verified in Chunk 6 live rehearsal

- [ ] **Step 4: Re-run the Guardian/host/approval tests**

Run: `npm test -- tests/guardian-cycle.test.ts tests/runtime-host.test.ts tests/mcp-approval-flow.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the proactive TG demo UX**

```bash
git add src/guardian/service.ts src/app/host.ts src/telegram/live.ts tests/guardian-cycle.test.ts tests/runtime-host.test.ts tests/mcp-approval-flow.test.ts
git commit -m "feat: wire proactive rebalance telegram demo flow"
```

---

## Chunk 5: Live Rehearsal Script And Proof Bundle

### Task 5: Add a single operator-run script for the full demo lane

**Files:**
- Create: `scripts/demo-agentic-rebalance.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/live-demo-runbook.md`
- Test: `tests/demo-rebalance-flow.test.ts`

- [ ] **Step 1: Write the failing script contract test (or script-adjacent module test)**

Add coverage that proves the script:
- loads required env
- drives `x402 -> OmRate -> planner -> optional swap -> whitelist-gated deposit`
- captures proof output in a deterministic JSON shape for rehearsals

- [ ] **Step 2: Run the script-adjacent test to verify failure**

Run: `npm test -- tests/demo-rebalance-flow.test.ts`

Expected: FAIL on the new script contract

- [ ] **Step 3: Implement the rehearsal script and docs**

Implementation notes:
- register the stable script name `smoke:agentic-rebalance-demo` in `package.json` and use that exact command everywhere
- include env guards for:
  - OmRate base/API key
  - x402 enablement
  - Agentic Wallet address
  - Telegram bot/user binding
  - swap token inputs when swap is required
  - Uniswap LP deposit inputs
- update `README.md` and `docs/live-demo-runbook.md` so judges and operators can see:
  - why x402 is now in the mainline flow
  - where swap appears in the story
  - what proof to capture
  - what fallback to use if a dependency is down

- [ ] **Step 4: Run the focused rehearsal test again**

Run: `npm test -- tests/demo-rebalance-flow.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the operator rehearsal path**

```bash
git add scripts/demo-agentic-rebalance.ts package.json README.md docs/live-demo-runbook.md tests/demo-rebalance-flow.test.ts
git commit -m "feat: add agentic rebalance demo rehearsal script"
```

---

## Chunk 6: Final Verification And Rehearsal

### Task 6: Verify locally, then perform one live rehearsal

**Files:**
- Modify if needed: any files touched in earlier chunks
- Test: `tests/adapter-contracts.test.ts`
- Test: `tests/demo-rebalance-flow.test.ts`
- Test: `tests/guardian-cycle.test.ts`
- Test: `tests/mcp-approval-flow.test.ts`
- Test: `tests/runtime-host.test.ts`
- Test: `tests/uniswap-v3-execution.test.ts`

- [ ] **Step 1: Run the automated verification suite**

Run: `npm test -- tests/adapter-contracts.test.ts tests/demo-rebalance-flow.test.ts tests/guardian-cycle.test.ts tests/mcp-approval-flow.test.ts tests/runtime-host.test.ts tests/uniswap-v3-execution.test.ts`

Expected: PASS with 0 failed tests

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 3: Run the live demo rehearsal script**

Run: `npm run smoke:agentic-rebalance-demo`

Expected:
- Guardian/TG proposal visible
- x402 payment visible
- OmRate response visible
- planner output visible
- optional swap visible when required
- whitelist approval visible
- Uniswap LP deposit succeeds
- Telegram result report includes tx refs

- [ ] **Step 4: Capture the proof bundle**

Collect:
- Telegram screenshot of the proactive rebalance proposal
- x402 payment evidence
- OmRate paid response excerpt
- planner output / payload template
- swap quote/execution evidence if swap was used
- Telegram whitelist approval screenshot
- Uniswap deposit tx hash
- Telegram result report screenshot
- final rehearsal JSON output

- [ ] **Step 5: Commit final fixes**

```bash
git add src/adapters/x402.ts src/adapters/onchainos.ts src/adapters/omrate.ts src/adapters/lp-execution.ts src/demo/rebalance-flow.ts src/guardian/service.ts src/app/host.ts src/telegram/live.ts src/executors/skill-backed.ts scripts/demo-agentic-rebalance.ts package.json README.md docs/live-demo-runbook.md tests/adapter-contracts.test.ts tests/demo-rebalance-flow.test.ts tests/guardian-cycle.test.ts tests/mcp-approval-flow.test.ts tests/runtime-host.test.ts tests/uniswap-v3-execution.test.ts
git commit -m "feat: close agentic rebalance demo flow"
```

---

## Execution Notes

- Keep `withdraw LP` out of the mainline demo. It remains proof/backstop only.
- Keep owner withdrawal out of the mainline demo. It is a separate capability proof.
- Do not add local metadata persistence in this round unless live rehearsal proves it is necessary.
- Prefer operator-stable inputs over broader automation when they reduce demo risk.
- If a dependency is flaky, keep a fallback proof path in the runbook rather than silently changing the story.

Plan complete and saved to `docs/superpowers/plans/2026-04-08-agentic-rebalance-demo-flow.md`. Ready to execute?
