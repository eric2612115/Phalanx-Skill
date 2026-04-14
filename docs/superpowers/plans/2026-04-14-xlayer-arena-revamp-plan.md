# X Layer Arena Revamp Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the already-proven live deposit path into a stable, replayable, judge-ready X Layer Arena submission, then add the highest-value optional upgrades if time remains.

**Architecture:** Keep `RuntimeCore` and the current `Onchain OS -> approval -> resume -> live execution` mainline intact. Do not redesign custody, do not replace `onchainos`, and do not broaden into a hosted control plane. Instead, finish the missing operator-facing edges: managed wallet auto-resolution, one-command deposit rehearsal, current docs and runbooks, and proof-oriented demo flow. `withdraw` and richer LP reporting remain additive upgrades after the recording path is stable.

**Tech Stack:** TypeScript, Node.js, Vitest, existing Phalanx runtime/host/telegram modules, Onchain OS, Uniswap planner integration, OmRate/x402 integration

---

## Scope And Non-Goals

**P0 scope:**

- make Onchain OS managed wallet discovery the default path
- add a one-command deposit-focused rehearsal/demo script
- update `README.md` and active runbooks to match the actual product
- define and validate the recording checklist for today's demo

**P1 scope if time remains:**

- close `deposit -> tokenId discovery -> withdraw` live roundtrip
- add a Telegram LP position detail query surface
- expand CI to run `guard:ai + test + build`

**Out of scope for this round:**

- hosted SaaS control plane
- reimplementing signing or custody outside `onchainos`
- broad runtime redesign
- unrelated protocol expansion
- deep `host.ts` cleanup unless required by a focused change in this plan

---

## File Map

**Create:**

- `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md` — judge-facing strategy and active source of truth for the submission
- `docs/superpowers/plans/2026-04-14-xlayer-arena-revamp-plan.md` — this implementation plan
- `scripts/smoke-deposit-mainline.ts` — stable operator-run rehearsal script for today's recording path
- `tests/smoke-deposit-mainline.test.ts` — script-adjacent contract coverage for required env, orchestration, and proof output
- `docs/hackathon/xlayer-demo-checklist.md` — ordered recording checklist and proof capture list

**Modify (P0):**

- `src/adapters/onchainos.ts` — expose or stabilize managed-address discovery helpers and any command/result parsing needed by wallet auto-resolution
- `src/executors/skill-backed.ts` — make managed Onchain OS address selection primary, env wallet values override-only
- `src/adapters/lp-execution.ts` — wire managed address selection into the live LP execution path if this is the current execution boundary
- `src/config/store.ts` — align wallet config semantics and demo-ready summaries with auto-resolution
- `src/app/host.ts` — expose only the minimum surfaces needed by the new deposit rehearsal path or proof output
- `package.json` — add a stable rehearsal command
- `README.md` — rewrite around the current product and proven live path
- `docs/live-demo-runbook.md` — align the runbook with current reality and the new rehearsal command
- `config.env.example` — align wallet/env comments with override-only semantics and current demo assumptions
- `.github/workflows/ai-governance.yml` — optional P1 CI expansion

**Modify (P1):**

- `src/adapters/uniswap.ts` or `src/adapters/lp-execution.ts` — if tokenId discovery or withdraw payload shaping belongs there
- `src/operator/providers/portfolio-provider.ts` — richer LP detail retrieval if already used by Telegram/operator reads
- `src/telegram/operator-formatters.ts` — LP position detail rendering
- `src/telegram/operator-queries.ts` — route for LP detail lookup
- `tests/uniswap-v3-execution.test.ts` — withdraw closure and tokenId discovery coverage
- `tests/operator-providers.test.ts` — LP detail provider coverage
- `tests/telegram-operator-router.test.ts` or `tests/telegram-live.test.ts` — Telegram LP detail query coverage

---

## Current Baseline To Preserve

The worker must not regress the following already-proven path:

- Telegram approval request delivered
- approval callback received
- local-first whitelist update
- original action resumed through `RuntimeCore`
- correct Uniswap pool selected
- `onchainos wallet contract-call` path used for live execution
- approve step and deposit step completed
- live tx refs returned

If any P0 change breaks that baseline, stop and fix the regression before proceeding.

---

## Chunk 1: Make Managed Wallet Resolution The Default

### Task 1: Replace legacy env-first wallet selection with Onchain OS managed-address auto-resolution

**Files:**

- Modify: `src/adapters/onchainos.ts`
- Modify: `src/executors/skill-backed.ts`
- Modify: `src/adapters/lp-execution.ts`
- Modify: `src/config/store.ts`
- Test: `tests/skill-backed-executor.test.ts`
- Test: `tests/uniswap-v3-execution.test.ts`
- Test: `tests/config-store.test.ts`
- **Step 1: Write failing tests for managed wallet precedence**

Add focused tests that prove:

- when Onchain OS exposes a managed address for the requested chain, that address is selected by default
- `PHALANX_WALLET_ADDRESS` / `AGENT_WALLET_ADDRESS` act as explicit overrides rather than silent primary selection
- LP execution on Base can derive the correct default live address without an env override
- readiness/config summaries describe the new semantics correctly
- **Step 2: Run the focused wallet-selection tests to verify failure**

Run:

`npm test -- tests/skill-backed-executor.test.ts tests/uniswap-v3-execution.test.ts tests/config-store.test.ts`

Expected:

- FAIL on the new managed-address-first expectations
- **Step 3: Implement the minimal managed-address resolution path**

Implementation notes:

- do not invent a parallel wallet registry
- keep `onchainos` as the source of truth for managed addresses
- preserve explicit override behavior for controlled troubleshooting
- avoid pushing new business logic into `src/app/host.ts`
- **Step 4: Re-run the focused wallet-selection tests**

Run:

`npm test -- tests/skill-backed-executor.test.ts tests/uniswap-v3-execution.test.ts tests/config-store.test.ts`

Expected:

- PASS
- **Step 5: Run the TypeScript build**

Run:

`npm run build`

Expected:

- PASS

---

## Chunk 2: Add A Stable One-Command Deposit Rehearsal

### Task 2: Create a replayable deposit-focused script for recording and judging

**Files:**

- Create: `scripts/smoke-deposit-mainline.ts`
- Create: `tests/smoke-deposit-mainline.test.ts`
- Modify: `package.json`
- Modify: `docs/live-demo-runbook.md`
- Modify: `README.md`
- **Step 1: Write the failing script contract test**

Add coverage that proves the script:

- validates required env for the deposit-focused live mainline
- drives the existing mainline instead of inventing a second execution path
- emits a deterministic proof-friendly output shape
- clearly reports whether the run reached:
  - approval requested
  - approval resumed
  - deposit attempted
  - deposit completed
  - tx refs captured
- **Step 2: Run the focused script contract test to verify failure**

Run:

`npm test -- tests/smoke-deposit-mainline.test.ts`

Expected:

- FAIL because the script and output contract do not exist yet
- **Step 3: Implement the deposit rehearsal script**

Implementation notes:

- this script is for today's recording path, not a new permanent orchestration layer
- keep it thin and reuse existing host/runtime/approval flow
- prefer machine-readable JSON output with a short human summary
- do not silently mutate unrelated config beyond the current local-operator assumptions
- **Step 4: Register the stable command**

Modify `package.json` to add a stable script name such as:

- `smoke:deposit-mainline`

Use that exact command consistently in docs and rehearsal notes.

- **Step 5: Re-run the script contract test**

Run:

`npm test -- tests/smoke-deposit-mainline.test.ts`

Expected:

- PASS
- **Step 6: Run the deposit rehearsal script locally**

Run:

`npm run smoke:deposit-mainline`

Expected:

- structured output for recording
- approval and deposit phases visible
- tx refs included when live execution succeeds

---

## Chunk 3: Rewrite The Judge-Facing Docs Around The Current Truth

### Task 3: Update README, runbook, and env guidance to match the actual product and live state

**Files:**

- Modify: `README.md`
- Modify: `docs/live-demo-runbook.md`
- Modify: `config.env.example`
- Reference: `docs/superpowers/plans/2026-04-14-xlayer-arena-repositioning-strategy.md`
- **Step 1: Rewrite the README structure**

The README must clearly show:

- what the product is
- why it is local-first and self-custodial
- how `Onchain OS`, `OmRate`, and `Uniswap Skill` work together
- what is already proven live today
- the quick path to replay the mainline
- what remains incomplete but non-blocking
- **Step 2: Update the live demo runbook**

The runbook must:

- use the new stable rehearsal command
- describe today's recording target as `deposit mainline first`
- separate proven capabilities from in-progress enhancements
- explain wallet-address auto-resolution and env override semantics
- list exact proof artifacts to capture
- **Step 3: Update `config.env.example` comments**

The example must:

- reflect managed-address-first behavior
- demote wallet envs to override-only when applicable
- keep only current demo-critical guidance near the top
- avoid stale blockers that are no longer true
- **Step 4: Re-read docs for consistency**

Check that:

- README, runbook, and config comments say the same thing
- they do not describe chain-governance as a required blocker
- they do not imply the old wallet-resolution model is still primary

---

## Chunk 4: Add A Demo Checklist And Proof Bundle Contract

### Task 4: Make recording repeatable and evidence-driven

**Files:**

- Create: `docs/hackathon/xlayer-demo-checklist.md`
- Modify: `docs/live-demo-runbook.md`
- Modify: `README.md`
- **Step 1: Write the demo checklist**

The checklist must be ordered and operator-friendly:

1. verify config and wallet selection
2. start runtime
3. trigger action path
4. capture Telegram approval
5. approve in Telegram
6. capture resumed execution
7. capture tx refs
8. capture final summary

- **Step 2: Define the proof bundle**

Include:

- terminal output excerpts
- Telegram approval screenshot
- Telegram success/result screenshot if available
- tx refs
- proof JSON from the rehearsal command
- any optional planner or pool-selection evidence
- **Step 3: Cross-link the checklist from active docs**

Update README and runbook so the checklist is easy to find before recording.

---

## Chunk 5: Live Rehearsal And Same-Day Verification

### Task 5: Verify the exact path that will be recorded today

**Files:**

- Review: all P0 files changed earlier
- Test: `tests/uniswap-v3-execution.test.ts`
- Test: `tests/uniswap-official-planner.test.ts`
- Test: `tests/smoke-deposit-mainline.test.ts`
- **Step 1: Run focused automated verification**

Run:

`npm test -- tests/uniswap-v3-execution.test.ts tests/uniswap-official-planner.test.ts tests/smoke-deposit-mainline.test.ts`

Expected:

- PASS
- **Step 2: Run the TypeScript build**

Run:

`npm run build`

Expected:

- PASS
- **Step 3: Run the deposit mainline rehearsal**

Run:

`npm run smoke:deposit-mainline`

Expected:

- no stale wallet-resolution issue
- approval path visible
- resumed execution visible
- deposit completion visible
- tx refs captured
- **Step 4: Capture the proof bundle for recording**

Collect:

- rehearsal command output
- Telegram approval screenshot
- Telegram callback/result state if visible
- tx refs
- any pool-selection evidence used in the explanation
- **Step 5: Run `guard:ai`**

Run:

`npm run guard:ai`

Expected:

- PASS

---

## Chunk 6: Optional Product-Completeness Upgrades

### Task 6: If P0 is stable, close withdraw roundtrip

**Files:**

- Modify: `src/adapters/lp-execution.ts`
- Modify: `src/adapters/onchainos.ts`
- Modify: `src/app/host.ts`
- Test: `tests/uniswap-v3-execution.test.ts`
- Test: `tests/runtime-host.test.ts`
- **Step 1: Write failing tests for tokenId discovery and withdraw handoff**

Add tests that prove:

- a successful deposit can be followed by tokenId discovery
- tokenId discovery feeds a valid withdraw payload
- the withdraw path can complete without hand-editing hidden values
- **Step 2: Run the focused withdraw tests to verify failure**

Run:

`npm test -- tests/uniswap-v3-execution.test.ts tests/runtime-host.test.ts`

Expected:

- FAIL on tokenId discovery and/or withdraw closure expectations
- **Step 3: Implement the minimal withdraw closure**

Implementation notes:

- avoid adding a broad local metadata cache unless necessary
- prefer fresh position discovery from Onchain OS where possible
- keep this as an additive roundtrip completion step, not a redesign
- **Step 4: Re-run the focused withdraw tests**

Run:

`npm test -- tests/uniswap-v3-execution.test.ts tests/runtime-host.test.ts`

Expected:

- PASS
- **Step 5: Run a real withdraw rehearsal if deposit is still stable**

Run:

the appropriate live or focused roundtrip command available in the repo

Expected:

- deposit -> discovery -> withdraw path completes or yields a clearly bounded remaining issue

### Task 7: If P0 is stable, add Telegram LP position detail query

**Files:**

- Modify: `src/operator/providers/portfolio-provider.ts`
- Modify: `src/telegram/operator-queries.ts`
- Modify: `src/telegram/operator-formatters.ts`
- Test: `tests/operator-providers.test.ts`
- Test: `tests/telegram-operator-router.test.ts`
- **Step 1: Write failing tests for LP detail query**

Add tests that prove a Telegram/operator query can return:

- `poolAddress`
- `tokenId`
- `tickLower`
- `tickUpper`
- `liquidity`
- `inRange` or equivalent range state
- withdrawability summary
- **Step 2: Run the focused LP detail tests to verify failure**

Run:

`npm test -- tests/operator-providers.test.ts tests/telegram-operator-router.test.ts`

Expected:

- FAIL on the new LP detail query expectations
- **Step 3: Implement the minimal detail query path**

Implementation notes:

- prefer one bounded query rather than turning Telegram into a general portfolio explorer
- reuse existing provider/query layers
- keep formatting concise and operator-focused
- **Step 4: Re-run the focused LP detail tests**

Run:

`npm test -- tests/operator-providers.test.ts tests/telegram-operator-router.test.ts`

Expected:

- PASS

---

## Chunk 7: Optional CI Hardening

### Task 8: Expand CI to the shared quality floor if time remains

**Files:**

- Modify: `.github/workflows/ai-governance.yml`
- **Step 1: Update CI to include tests and build**

Add:

- `npm run test`
- `npm run build`

after dependency install and before the final workflow success state.

- **Step 2: Review for practicality**

Check that:

- the workflow does not add fake or flaky checks
- the command order matches local expectations
- **Step 3: If CI cannot be safely changed before deadline, defer cleanly**

Document the deferral in the final notes rather than rushing a risky workflow change.

---

## Final Acceptance Criteria

The plan is successfully executed for today's submission only when:

- managed wallet auto-resolution is the default path
- a stable deposit rehearsal command exists and is documented
- `README.md` and `docs/live-demo-runbook.md` match the current product truth
- the recording checklist exists and can be followed in order
- the deposit mainline can be rehearsed and recorded with proof artifacts
- `guard:ai` and `build` pass after the P0 work

Stretch completion for extra polish:

- withdraw roundtrip is live-closed
- Telegram LP position detail query is available
- CI runs `guard:ai + test + build`

---

## Execution Guidance

- Execute `P0` fully before touching `P1`.
- Do not broaden into structural cleanup unless a focused P0 or P1 task truly requires it.
- When a choice exists between "more elegant" and "more replayable today", choose replayability.
- Treat the existing live deposit success as the core asset; protect it.

Plan complete and saved to `docs/superpowers/plans/2026-04-14-xlayer-arena-revamp-plan.md`. Ready to execute?