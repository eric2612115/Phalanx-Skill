# AgentPhalanx Telegram + Agentic Wallet Productization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentPhalanx behave like the intended product: Telegram-first operator control, Agentic-wallet-backed x402 payment with X Layer priority, resumable Guardian state, and a queueable/cancellable operator workflow suitable for long-running local operation.

**Architecture:** Keep `src/app/host.ts` as the composition root and avoid broad rewrites. Formalize the x402 buyer path behind dedicated selectors/executors, add an explicit Telegram job queue surface instead of overloading approval state, and introduce a small memory/state bridge for Guardian resumability rather than scattering persistence logic across Telegram, host, and adapters.

**Tech Stack:** TypeScript, Node.js, grammy, existing Phalanx runtime/host/telegram modules, Onchain OS CLI, OmRate/x402 integration, MCP-compatible memory service, Vitest.

---

## Scope And Non-Goals

**In scope:**

- make OmRate/x402 mainline use the Agentic wallet path, with `eip155:196` preferred over `eip155:8453`
- add deterministic accept selection and balance-aware fallback logic
- add Telegram job queue, sequence display, cancel/edit callbacks, and observable pending state
- persist Guardian/operator state through a memory service so restart recovery is not purely in-memory
- package the runtime for longer-lived local operation (`npm start` / PM2 / docs)

**Out of scope for this round:**

- replacing Onchain OS as the signing/execution substrate
- turning Telegram into an open-ended chat assistant
- broad frontend/web UI work
- unrelated adapter rewrites outside the x402 / queue / memory path

---

## File Map

**Create:**

- `src/adapters/x402-accept-selection.ts` — sort/filter `accepts[]`, prefer X Layer, evaluate fallback decisions, and produce explicit selection diagnostics
- `src/adapters/x402-balance-probe.ts` — read asset sufficiency for the selected Agentic wallet on candidate chains using injectable hooks
- `src/adapters/x402-agentic-payment.ts` — mainline x402 execution via Onchain OS `payment x402-pay` and proof replay helpers
- `src/telegram/job-queue.ts` — queue model, job ids, ordering, cancel/edit transitions, and serialization helpers
- `src/memory/state-store.ts` — small interface over memory persistence/recovery for portfolio state, user preferences, action history, and x402 reserve cache
- `src/memory/mcp-memory-store.ts` — MCP-backed implementation for the state-store interface
- `scripts/start-runtime.ts` — stable long-running local entrypoint suitable for PM2 / operator docs
- `ecosystem.config.cjs` — PM2 runtime configuration
- `docs/product/agentphalanx-review-narrative.md` — one-page product narrative for reviewers

**Modify:**

- `src/adapters/x402.ts` — stop treating `PHALANX_X402_PRIVATE_KEY` + single-network wrapped fetch as the default product path; keep it only as fallback/debug if still needed
- `src/adapters/omrate.ts` — route x402-required requests through the new accept-selection + Agentic wallet payment path
- `src/adapters/onchainos.ts` — support selected-accept network input and any additional parsing needed for x402 payment evidence
- `src/runtime/execution-evidence.ts` — surface selected network, selected asset, wallet source, payment id, and reserve state
- `src/runtime/events.ts` — add structured event metadata for x402 selection/fallback/funding failures
- `src/app/host.ts` — wire queue + memory store + x402 reporting, but keep public `PhalanxHost` shape stable where possible
- `src/guardian/service.ts` — load saved state on startup, write refreshed state after each cycle, support configurable interval semantics
- `src/telegram/live.ts` — queue display, cancel/edit callbacks, slash commands, richer completion summaries
- `src/telegram/operator-catalog.ts`
- `src/telegram/operator-formatters.ts`
- `src/telegram/operator-queries.ts`
- `src/index.ts` — support the packaged start path and lifecycle wiring
- `src/config/store.ts` — clarify x402 network override semantics and runtime defaults
- `README.md`
- `docs/live-demo-runbook.md`
- `docs/hackathon/xlayer-demo-checklist.md`
- `config.env.example`
- `service.env.example`
- `package.json`

**Test:**

- `tests/adapter-contracts.test.ts`
- `tests/demo-rebalance-flow.test.ts`
- `tests/execution-evidence.test.ts`
- `tests/install-operator.test.ts`
- `tests/operator-providers.test.ts`
- `tests/runtime-host.test.ts`
- `tests/telegram-live.test.ts`
- `tests/telegram-operator-router.test.ts`
- `tests/transport-live.test.ts`
- new focused tests:
  - `tests/x402-accept-selection.test.ts`
  - `tests/x402-agentic-payment.test.ts`
  - `tests/telegram-job-queue.test.ts`
  - `tests/memory-state-store.test.ts`

---

## Chunk 1: Make x402 Mainline Match The Product

### Task 1: Replace the current default x402 buyer path with Agentic-wallet-backed payment

**Files:**

- Create: `src/adapters/x402-accept-selection.ts`
- Create: `src/adapters/x402-balance-probe.ts`
- Create: `src/adapters/x402-agentic-payment.ts`
- Modify: `src/adapters/x402.ts`
- Modify: `src/adapters/omrate.ts`
- Modify: `src/adapters/onchainos.ts`
- Test: `tests/x402-accept-selection.test.ts`
- Test: `tests/x402-agentic-payment.test.ts`
- Test: `tests/adapter-contracts.test.ts`
- **Step 1: Write the failing accept-selection tests**

Cover:

- `eip155:196` beats `eip155:8453` when both are present and payable
- `eip155:8453` is chosen when X Layer is present but insufficient
- explicit failure is returned when no candidate is payable
- debug override semantics for `PHALANX_X402_NETWORK` are documented in behavior, not as a silent default
- **Step 2: Run the focused selection tests to verify failure**

Run: `npm run test -- tests/x402-accept-selection.test.ts`

Expected: FAIL because current mainline does not select across `accepts[]`

- **Step 3: Implement accept ranking and sufficiency checks**

Implementation notes:

- rank by product policy first: `eip155:196` then `eip155:8453`
- evaluate asset sufficiency against the resolved Agentic wallet address, not an unrelated buyer wallet
- return structured failure states such as `no_supported_accept`, `insufficient_funds`, `selection_blocked`
- **Step 4: Wire OmRate execution through the Agentic wallet payment path**

Implementation notes:

- use the selected accept's `network`, `amount`, `asset`, and `payTo`
- call Onchain OS `payment x402-pay` for the selected accept
- replay with `X-PAYMENT`
- keep old wrapped-fetch path only as an explicit fallback/debug branch if still needed
- **Step 5: Add runtime evidence for selected network, wallet, and settlement**

Cover:

- selected network (`196` / `8453`)
- selected asset symbol/address
- wallet source (`agentic_managed`, `override`, `debug_private_key_fallback`)
- payment id / settlement result when the server returns it
- **Step 6: Re-run focused x402 tests**

Run: `npm run test -- tests/x402-accept-selection.test.ts tests/x402-agentic-payment.test.ts tests/adapter-contracts.test.ts`

Expected: PASS

---

## Chunk 2: Make Telegram Behave Like A Real Operator Surface

### Task 2: Add a queue with sequence numbers, cancel, and edit

**Files:**

- Create: `src/telegram/job-queue.ts`
- Modify: `src/app/host.ts`
- Modify: `src/telegram/live.ts`
- Modify: `src/telegram/operator-formatters.ts`
- Modify: `src/telegram/operator-catalog.ts`
- Test: `tests/telegram-job-queue.test.ts`
- Test: `tests/telegram-live.test.ts`
- Test: `tests/transport-live.test.ts`
- **Step 1: Write the failing queue tests**

Cover:

- enqueue 3 jobs and render stable `#1/#2/#3` ordering
- cancel removes the targeted job only
- edit transitions the job into an editable pending state and prompts for new parameters
- queue state remains separate from approval router state
- **Step 2: Run the focused queue tests to verify failure**

Run: `npm run test -- tests/telegram-job-queue.test.ts tests/telegram-live.test.ts`

Expected: FAIL because only approval queue exists today

- **Step 3: Implement queue storage and callback routing**

Implementation notes:

- each job gets a uuid and display sequence
- callback data carries job id + action (`cancel`, `edit`, `approve`, `reject`) in a bounded format
- do not overload approval queue entries with edit/cancel behavior unrelated to approvals
- **Step 4: Add queue rendering and operator-visible summaries**

Cover:

- `waiting... (N ahead)` rendering
- grouped pending jobs view
- completion/removal summaries when jobs execute or are cancelled
- **Step 5: Re-run focused Telegram queue tests**

Run: `npm run test -- tests/telegram-job-queue.test.ts tests/telegram-live.test.ts tests/transport-live.test.ts`

Expected: PASS

---

## Chunk 3: Persist Guardian State Across Restarts

### Task 3: Integrate a memory-backed state store

**Files:**

- Create: `src/memory/state-store.ts`
- Create: `src/memory/mcp-memory-store.ts`
- Modify: `src/guardian/service.ts`
- Modify: `src/app/host.ts`
- Modify: `src/config/store.ts`
- Test: `tests/memory-state-store.test.ts`
- Test: `tests/guardian-cycle.test.ts`
- Test: `tests/runtime-host.test.ts`
- **Step 1: Write failing state-persistence tests**

Cover:

- Guardian writes `portfolio_state` after a cycle
- restart loads the most recent `portfolio_state`
- `user_preferences`, `action_history`, and `x402_balance` survive process restart
- missing/unavailable memory service degrades cleanly instead of crashing startup
- **Step 2: Run the focused memory tests to verify failure**

Run: `npm run test -- tests/memory-state-store.test.ts tests/guardian-cycle.test.ts`

Expected: FAIL because no memory-backed runtime state exists today

- **Step 3: Implement the memory store interface and MCP-backed adapter**

Implementation notes:

- keep a small, explicit interface so runtime code is not tied directly to MCP protocol details
- separate `loadLatestState()` and `persistCycleState()` paths
- record enough metadata to debug stale-state issues (`updatedAt`, `chain`, `source`)
- **Step 4: Wire Guardian startup and post-cycle persistence**

Cover:

- startup restore
- post-cycle save
- reserve-cache update for x402 balance warnings
- **Step 5: Re-run focused memory tests**

Run: `npm run test -- tests/memory-state-store.test.ts tests/guardian-cycle.test.ts tests/runtime-host.test.ts`

Expected: PASS

---

## Chunk 4: Package The Runtime For Real Local Operation

### Task 4: Make runtime startup and long-running behavior production-like

**Files:**

- Create: `scripts/start-runtime.ts`
- Create: `ecosystem.config.cjs`
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `src/guardian/service.ts`
- Test: `tests/install-operator.test.ts`
- Test: `tests/repo-layout.test.ts`
- **Step 1: Write failing startup/packaging tests**

Cover:

- a stable `npm start` entrypoint exists
- PM2 config points to the packaged runtime entry
- Guardian interval defaults are documented and configurable for long-lived operation
- **Step 2: Run the focused packaging tests to verify failure**

Run: `npm run test -- tests/install-operator.test.ts tests/repo-layout.test.ts`

Expected: FAIL because there is no `npm start` / PM2 packaging contract today

- **Step 3: Add `npm start`, PM2 config, and interval semantics**

Implementation notes:

- keep `npm run dev` for local dev
- add `npm start` as the operator-facing long-running entry
- keep Guardian interval configurable, but document the product default separately from test-friendly intervals
- **Step 4: Re-run focused packaging tests**

Run: `npm run test -- tests/install-operator.test.ts tests/repo-layout.test.ts`

Expected: PASS

---

## Chunk 5: Align Docs With The Intended Product

### Task 5: Update README, runbook, checklist, and reviewer narrative

**Files:**

- Create: `docs/product/agentphalanx-review-narrative.md`
- Modify: `README.md`
- Modify: `docs/live-demo-runbook.md`
- Modify: `docs/hackathon/xlayer-demo-checklist.md`
- Modify: `config.env.example`
- Modify: `service.env.example`
- **Step 1: Write the reviewer-facing narrative**

It must clearly explain:

- AgentPhalanx is Telegram-first and local-first
- OmRate/x402 payment uses the Agentic wallet
- X Layer is preferred, Base is fallback
- default demo cut is deposit, fuller story is allocation/x402
- **Step 2: Update operator docs**

Cover:

- preload X Layer USDT into the Agentic wallet before paid OmRate access
- explain gas-free X Layer boundary without implying the asset itself is free
- explain queue/cancel/edit behavior
- explain restart recovery from memory
- explain `npm start` / PM2 flow
- **Step 3: Re-read docs for consistency**

Check that:

- README, runbook, checklist, and reviewer narrative say the same thing
- no doc still claims the default x402 path is a naked private key
- no doc claims PM2 or memory features exist without matching implementation

---

## Final Verification

- **Step 1: Run focused feature suites**

Run:

`npm run test -- tests/x402-accept-selection.test.ts tests/x402-agentic-payment.test.ts tests/telegram-job-queue.test.ts tests/memory-state-store.test.ts tests/runtime-host.test.ts tests/telegram-live.test.ts`

Expected: PASS

- **Step 2: Run full verification**

Run:

`npm run test && npm run build && npm run guard:ai`

Expected: PASS

- **Step 3: Run live/manual proof checks**

Run:

- `PHALANX_X402_SMOKE_BASE_URL="https://api.omrate.com" npm run smoke:x402`
- the relevant Telegram/private-chat manual flow

Expected:

- Agentic wallet is the payer
- selected payment network is `eip155:196` when funded
- Base fallback only occurs when X Layer cannot pay
- Telegram queue/approval/reporting are observable

---

## Acceptance Criteria

This plan is complete only when:

- OmRate mainline x402 uses the Agentic wallet path by default
- X Layer is preferred over Base using explicit selection logic
- Telegram has a real queue with cancel/edit, not just approval buttons
- Guardian state survives restart through a memory-backed store
- the repo has a stable long-running local start path (`npm start` / PM2)
- docs describe the same product the code actually runs

Plan complete and saved to `docs/superpowers/plans/2026-04-15-agentphalanx-telegram-agentic-wallet-productization.md`. Ready to execute?