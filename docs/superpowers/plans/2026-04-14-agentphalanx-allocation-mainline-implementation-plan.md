# AgentPhalanx Allocation Mainline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current live deposit-oriented runtime into a proactive `AgentPhalanx` allocation mainline with managed-wallet-first execution, visible x402 payment evidence, `Aave + Morpho + Uniswap LP` orchestration, Telegram operator reporting, replayable profiles, and outward-facing rename alignment.

**Architecture:** Preserve the current layering: `host` remains composition root, `runtime` owns lifecycle and resumable approvals, `executors` route allocation actions, `adapters` translate external systems, and `telegram` formats runtime truth. Add one shared execution-evidence contract and one proactive allocation orchestration lane instead of scattering logic across scripts, adapters, and Telegram formatters.

**Tech Stack:** TypeScript, Node.js, Vitest, existing `Onchain OS` adapters, `OmRate` / x402 integration, existing `Aave` / `Morpho` / `Uniswap` execution paths, Telegram live notifier, MCP/runtime host

---

## Scope And Non-Goals

**In scope**

- managed-wallet-first resolution with explicit override visibility
- normalized x402 payment evidence visible in logs, proof JSON, and Telegram
- proactive allocation orchestration covering `Aave`, `Morpho`, and `Uniswap LP`
- whitelist gate -> Telegram approval -> resume semantics for the LP leg
- grouped tx-link reporting and portfolio push to Telegram
- replay/demo flow profiles with fewer manual overrides
- outward-facing rename from `Phalanx-Skill` to `AgentPhalanx`

**Out of scope**

- replacing `Onchain OS`
- rewriting every internal `PHALANX_*` identifier in one pass
- building a hosted control plane
- broad protocol expansion beyond `Aave`, `Morpho`, and `Uniswap LP`
- frontend or backend ownership changes outside this repo

---

## File Map

**Create**

- `src/runtime/execution-evidence.ts` — single normalized contract for wallet/payment/milestone evidence
- `src/demo/allocation-mainline.ts` — orchestration helpers for proactive allocation mainline
- `src/runtime/approval-resume.ts` — focused helpers for resumable approval metadata and duplicate-consumption protection
- `scripts/smoke-allocation-mainline.ts` — one-command proof-oriented run for the full allocation story
- `tests/execution-evidence.test.ts` — contract tests for wallet/payment/milestone normalization
- `tests/allocation-mainline.test.ts` — orchestration contract tests for the proactive allocation flow
- `tests/agentphalanx-branding.test.ts` — protects outward rename surfaces and key labels

**Modify**

- `src/adapters/onchainos.ts` — canonical wallet resolution, x402 payment result normalization, any missing execution evidence helpers
- `src/adapters/omrate.ts` — payment-aware OmRate execution must surface required/attempted/settled evidence
- `src/demo/rebalance-flow.ts` — either adapt or delegate to the new allocation mainline where overlap exists
- `src/runtime/events.ts` — extend event shape to carry execution evidence cleanly
- `src/runtime/core.ts` — publish evidence-bearing runtime events at the right lifecycle boundaries
- `src/runtime/approval-router.ts` — approval association, expiry, duplicate-consumption protection, resume safety
- `src/executors/skill-backed.ts` — route allocation actions through managed-wallet-first resolution and evidence emission
- `src/adapters/lp-execution.ts` — consume canonical wallet resolution and propagate LP-specific evidence
- `src/adapters/lp-position-query.ts` — enrich LP detail reporting for Telegram/operator queries
- `src/app/host.ts` — compose the new orchestration lane and report/push hooks without absorbing domain logic
- `src/telegram/live.ts` — grouped completion reports, x402/wallet context, portfolio push
- `src/telegram/operator-catalog.ts` — query-family expansion / naming polish
- `src/telegram/operator-queries.ts` — expose execution context, LP detail, and portfolio push payloads
- `src/telegram/operator-formatters.ts` — richer LP detail, wallet/payment context, portfolio summary formatting
- `src/operator/providers/portfolio-provider.ts` — portfolio and LP detail data for Telegram/operator queries
- `src/install/operator-init.ts` — init output should show wallet/x402 baseline more clearly
- `src/install/checks.ts` — readiness checks aligned with managed-wallet-first semantics
- `src/config/store.ts` — profile loading and normalized config access
- `package.json` — add full-mainline smoke command and outward metadata updates
- `README.md` — rename plus full flow docs
- `docs/live-demo-runbook.md` — full allocation flow and verification steps
- `docs/hackathon/xlayer-demo-checklist.md` — proof checklist for the proactive allocation story
- `AGENTS.md`
- `CLAUDE.md`
- `.mcp.json.example`
- `.codex/INSTALL.md`
- `.openclaw/INSTALL.md`
- `.opencode/INSTALL.md`
- `.claude-plugin/INSTALL.md`

**Tests To Update**

- `tests/runtime-host.test.ts`
- `tests/demo-rebalance-flow.test.ts`
- `tests/telegram-live.test.ts`
- `tests/telegram-operator-router.test.ts`
- `tests/operator-providers.test.ts`
- `tests/skill-backed-executor.test.ts`
- `tests/config-store.test.ts`
- `tests/install-operator.test.ts`
- `tests/mcp-approval-flow.test.ts`
- `tests/smoke-deposit-mainline.test.ts`
- `tests/uniswap-v3-execution.test.ts`

---

## Chunk 1: Define Shared Execution Evidence

### Task 1: Create the single-source wallet/payment/milestone evidence contract

**Files:**

- Create: `src/runtime/execution-evidence.ts`
- Modify: `src/runtime/events.ts`
- Test: `tests/execution-evidence.test.ts`

- [ ] **Step 1: Write failing tests for normalized wallet evidence**

Cover:

- managed wallet selected in live mode when available
- explicit override remains allowed but marked as override
- test fallback appears only outside live mode
- evidence object exposes `resolvedAddress`, `source`, `chain`, `reason`, `overrideActive`

- [ ] **Step 2: Run the focused evidence tests to verify failure**

Run: `npm run test -- tests/execution-evidence.test.ts`

Expected: FAIL because the contract file does not exist yet.

- [ ] **Step 3: Write failing tests for x402 payment evidence**

Cover:

- baseline-ready vs payment-required vs payment-attempted vs payment-settled are distinct
- `paymentWrapped` means the runtime actually switched into payment transport
- degraded payment path still emits explanatory evidence

- [ ] **Step 4: Implement `src/runtime/execution-evidence.ts`**

Include helpers for:

- wallet evidence normalization
- payment evidence normalization
- milestone merging / summary rendering

- [ ] **Step 5: Extend `src/runtime/events.ts` to carry execution evidence**

Add a typed field for normalized execution evidence instead of burying everything in freeform summaries.

- [ ] **Step 6: Re-run the focused evidence tests**

Run: `npm run test -- tests/execution-evidence.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the evidence contract**

```bash
git add src/runtime/execution-evidence.ts src/runtime/events.ts tests/execution-evidence.test.ts
git commit -m "feat: add shared execution evidence contract"
```

---

## Chunk 2: Make Managed Wallet And x402 Evidence Canonical

### Task 2: Route all relevant execution lanes through the canonical wallet resolver

**Files:**

- Modify: `src/adapters/onchainos.ts`
- Modify: `src/executors/skill-backed.ts`
- Modify: `src/adapters/lp-execution.ts`
- Modify: `src/install/checks.ts`
- Modify: `src/install/operator-init.ts`
- Test: `tests/skill-backed-executor.test.ts`
- Test: `tests/config-store.test.ts`
- Test: `tests/install-operator.test.ts`

- [ ] **Step 1: Write failing tests for managed-wallet-first behavior in live execution**

Cover:

- live execution prefers managed address
- explicit env wallet is labeled override-only
- init/readiness copy reflects managed-wallet-first semantics

- [ ] **Step 2: Run the focused wallet-selection tests**

Run: `npm run test -- tests/skill-backed-executor.test.ts tests/config-store.test.ts tests/install-operator.test.ts`

Expected: FAIL on the new precedence and visibility expectations.

- [ ] **Step 3: Update `src/adapters/onchainos.ts` to emit canonical wallet evidence**

Do not leave separate precedence logic in `lp-execution`, `guardian`, or install surfaces.

- [ ] **Step 4: Update executor and LP paths to consume the shared wallet evidence**

Avoid duplicating `PHALANX_WALLET_ADDRESS` / `AGENT_WALLET_ADDRESS` branching outside the canonical helper.

- [ ] **Step 5: Align init/readiness copy**

Init should say whether:

- managed wallet is discoverable
- override is active
- x402 baseline is ready

- [ ] **Step 6: Re-run the focused wallet tests**

Run: `npm run test -- tests/skill-backed-executor.test.ts tests/config-store.test.ts tests/install-operator.test.ts`

Expected: PASS.

### Task 3: Normalize x402 execution evidence in OmRate and Onchain OS paths

**Files:**

- Modify: `src/adapters/omrate.ts`
- Modify: `src/adapters/onchainos.ts`
- Test: `tests/adapter-contracts.test.ts`
- Test: `tests/demo-rebalance-flow.test.ts`

- [ ] **Step 1: Write failing tests for x402 evidence propagation**

Cover:

- OmRate execution reports whether x402 was required
- payment attempt / wrapped transport / settlement evidence are exposed
- degraded payment still returns structured evidence

- [ ] **Step 2: Run the focused x402 tests**

Run: `npm run test -- tests/adapter-contracts.test.ts tests/demo-rebalance-flow.test.ts`

Expected: FAIL on the new evidence expectations.

- [ ] **Step 3: Implement evidence propagation in OmRate and Onchain OS adapters**

Keep adapter duties translation-focused; do not move lifecycle branching into adapters.

- [ ] **Step 4: Re-run the focused x402 tests**

Run: `npm run test -- tests/adapter-contracts.test.ts tests/demo-rebalance-flow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the wallet/x402 canonicalization work**

```bash
git add src/adapters/onchainos.ts src/adapters/omrate.ts src/executors/skill-backed.ts src/adapters/lp-execution.ts src/install/checks.ts src/install/operator-init.ts tests/skill-backed-executor.test.ts tests/config-store.test.ts tests/install-operator.test.ts tests/adapter-contracts.test.ts tests/demo-rebalance-flow.test.ts
git commit -m "feat: make wallet and x402 evidence canonical"
```

---

## Chunk 3: Build The Proactive Allocation Mainline

### Task 4: Create the orchestration lane for `Aave + Morpho + Uniswap LP`

**Files:**

- Create: `src/demo/allocation-mainline.ts`
- Modify: `src/demo/rebalance-flow.ts`
- Modify: `src/runtime/core.ts`
- Modify: `src/runtime/intents.ts` (only if a new action/intention name is introduced)
- Modify: `src/executors/skill-backed.ts`
- Modify: `src/app/host.ts`
- Create: `tests/allocation-mainline.test.ts`
- Modify: `tests/runtime-host.test.ts`
- Modify: `tests/demo-rebalance-flow.test.ts`

- [ ] **Step 1: Write the failing orchestration contract tests**

Cover:

- funding-ready -> OmRate -> x402 -> allocation plan path
- `Aave` leg evidence
- `Morpho` leg evidence
- `Uniswap LP` blocked-for-approval evidence
- approval resume leads back into the original LP segment

- [ ] **Step 2: Run the focused orchestration tests**

Run: `npm run test -- tests/allocation-mainline.test.ts tests/runtime-host.test.ts tests/demo-rebalance-flow.test.ts`

Expected: FAIL because the mainline orchestration contract is not implemented.

- [ ] **Step 3: Implement `src/demo/allocation-mainline.ts`**

Responsibilities:

- orchestrate the mainline stages
- collect normalized execution evidence
- prepare action payloads for each protocol leg
- stop cleanly at approval gates

- [ ] **Step 4: Integrate the orchestration lane through runtime/executor/host wiring**

Requirements:

- `host` remains composition root only
- `runtime` remains the owner of pause/resume lifecycle
- executor chooses the right protocol backend per allocation leg
- if a new state-changing action name is introduced for allocation orchestration, update `src/runtime/intents.ts` in this step

- [ ] **Step 5: Re-run the focused orchestration tests**

Run: `npm run test -- tests/allocation-mainline.test.ts tests/runtime-host.test.ts tests/demo-rebalance-flow.test.ts`

Expected: PASS.

### Task 5: Harden approval association and resume safety

**Files:**

- Create: `src/runtime/approval-resume.ts` (only if needed to keep runtime files focused)
- Modify: `src/runtime/approval-router.ts`
- Modify: `src/runtime/core.ts`
- Test: `tests/mcp-approval-flow.test.ts`
- Test: `tests/runtime-host.test.ts`

- [ ] **Step 1: Write failing tests for stale/duplicate approval handling**

Cover:

- approval records retain `intentId`, resume segment, id, createdAt, expiry
- duplicated callback is rejected
- expired approval is rejected
- already-consumed approval cannot resume twice

- [ ] **Step 2: Run the focused approval tests**

Run: `npm run test -- tests/mcp-approval-flow.test.ts tests/runtime-host.test.ts`

Expected: FAIL on the new safety expectations.

- [ ] **Step 3: Implement approval association and duplicate-consumption protection**

Do not let Telegram own approval truth; it only delivers the human decision.

- [ ] **Step 4: Re-run the focused approval tests**

Run: `npm run test -- tests/mcp-approval-flow.test.ts tests/runtime-host.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the proactive allocation mainline**

```bash
git add src/demo/allocation-mainline.ts src/demo/rebalance-flow.ts src/runtime/core.ts src/runtime/approval-router.ts src/runtime/approval-resume.ts src/executors/skill-backed.ts src/app/host.ts tests/allocation-mainline.test.ts tests/runtime-host.test.ts tests/demo-rebalance-flow.test.ts tests/mcp-approval-flow.test.ts
git commit -m "feat: add proactive allocation mainline"
```

---

## Chunk 4: Upgrade Telegram Into The Operator Console

### Task 6: Add grouped completion reports and execution-context visibility

**Files:**

- Modify: `src/telegram/live.ts`
- Modify: `src/operator/providers/event-provider.ts`
- Modify: `src/runtime/events.ts`
- Modify: `tests/telegram-live.test.ts`

- [ ] **Step 1: Write failing tests for grouped completion reports**

Cover:

- one message includes action status, wallet source, x402 summary, and grouped tx links
- reporting failure is distinguishable from execution failure
- portfolio follow-up push can be triggered after a material allocation change

- [ ] **Step 2: Run the focused Telegram live tests**

Run: `npm run test -- tests/telegram-live.test.ts`

Expected: FAIL on the expanded completion-report contract.

- [ ] **Step 3: Implement grouped execution reporting**

Use runtime evidence as the source of truth; do not reconstruct state independently in Telegram.

- [ ] **Step 4: Re-run the focused Telegram live tests**

Run: `npm run test -- tests/telegram-live.test.ts`

Expected: PASS.

### Task 7: Expand operator queries for wallet, LP detail, and portfolio push

**Files:**

- Modify: `src/telegram/operator-catalog.ts`
- Modify: `src/telegram/operator-queries.ts`
- Modify: `src/telegram/operator-formatters.ts`
- Modify: `src/operator/providers/portfolio-provider.ts`
- Modify: `src/adapters/lp-position-query.ts`
- Test: `tests/operator-providers.test.ts`
- Test: `tests/telegram-operator-router.test.ts`

- [ ] **Step 1: Write failing tests for richer LP position detail and wallet/payment visibility**

Cover:

- LP detail includes pool, tokenId, ticks, liquidity, in-range state, withdrawability
- wallet source and x402/payment summary are queryable
- portfolio formatting can show allocation buckets and post-action push summary

- [ ] **Step 2: Run the focused operator-surface tests**

Run: `npm run test -- tests/operator-providers.test.ts tests/telegram-operator-router.test.ts`

Expected: FAIL on the richer payload/formatter expectations.

- [ ] **Step 3: Implement the provider/query/formatter changes**

Keep query families bounded; do not turn Telegram into open-ended NL routing.

- [ ] **Step 4: Re-run the focused operator-surface tests**

Run: `npm run test -- tests/operator-providers.test.ts tests/telegram-operator-router.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Telegram operator-console upgrade**

```bash
git add src/telegram/live.ts src/telegram/operator-catalog.ts src/telegram/operator-queries.ts src/telegram/operator-formatters.ts src/operator/providers/portfolio-provider.ts src/adapters/lp-position-query.ts src/operator/providers/event-provider.ts tests/telegram-live.test.ts tests/operator-providers.test.ts tests/telegram-operator-router.test.ts
git commit -m "feat: upgrade telegram operator reporting"
```

---

## Chunk 5: Make Demo / Replay Profile-Driven

### Task 8: Add flow profiles and a one-command allocation smoke path

**Files:**

- Modify: `src/config/store.ts`
- Modify: `package.json`
- Create: `scripts/smoke-allocation-mainline.ts`
- Modify: `scripts/smoke-deposit-mainline.ts`
- Modify: `tests/config-store.test.ts`
- Modify: `tests/smoke-deposit-mainline.test.ts`
- Create: `tests/allocation-mainline.test.ts` (reuse if created earlier)

- [ ] **Step 1: Write failing tests for flow-profile config loading**

Cover:

- `allocation_mainline`, `deposit_only`, `roundtrip`, and `rehearsal` profiles load deterministically
- `config.env` and `service.env` ownership remains intact
- proof output contains wallet and payment evidence

- [ ] **Step 2: Run the focused profile/smoke tests**

Run: `npm run test -- tests/config-store.test.ts tests/smoke-deposit-mainline.test.ts tests/allocation-mainline.test.ts`

Expected: FAIL on the new profile-driven expectations.

- [ ] **Step 3: Implement profile loading in config**

Keep user-facing config simple; service/demo toggles belong in `service.env`.

- [ ] **Step 4: Implement `scripts/smoke-allocation-mainline.ts`**

The script must:

- run the proactive allocation story
- emit structured proof JSON
- surface grouped tx refs and portfolio push milestones

- [ ] **Step 5: Register the stable command in `package.json`**

Add a script such as:

- `smoke:allocation-mainline`

- [ ] **Step 6: Re-run the focused profile/smoke tests**

Run: `npm run test -- tests/config-store.test.ts tests/smoke-deposit-mainline.test.ts tests/allocation-mainline.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the replay-profile work**

```bash
git add src/config/store.ts package.json scripts/smoke-allocation-mainline.ts scripts/smoke-deposit-mainline.ts tests/config-store.test.ts tests/smoke-deposit-mainline.test.ts tests/allocation-mainline.test.ts
git commit -m "feat: add profile-driven allocation rehearsal"
```

---

## Chunk 6: Complete The Outward AgentPhalanx Rename And Verification

### Task 9: Rename outward-facing product surfaces to `AgentPhalanx`

**Files:**

- Modify: `README.md`
- Modify: `docs/live-demo-runbook.md`
- Modify: `docs/hackathon/xlayer-demo-checklist.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `.mcp.json.example`
- Modify: `.codex/INSTALL.md`
- Modify: `.openclaw/INSTALL.md`
- Modify: `.opencode/INSTALL.md`
- Modify: `.claude-plugin/INSTALL.md`
- Modify: `package.json`
- Modify: `src/index.ts`
- Create: `tests/agentphalanx-branding.test.ts`

- [ ] **Step 1: Write failing branding/doc tests**

Protect:

- outward product name is `AgentPhalanx`
- compatibility-sensitive technical identifiers like `PHALANX_*` are not blindly removed
- install/demo docs tell the same product story

- [ ] **Step 2: Run the focused branding tests**

Run: `npm run test -- tests/agentphalanx-branding.test.ts`

Expected: FAIL because the outward rename is incomplete.

- [ ] **Step 3: Update outward-facing metadata and docs**

Do not rewrite internal env prefixes in this slice unless compatibility is preserved.

- [ ] **Step 4: Re-run the branding tests**

Run: `npm run test -- tests/agentphalanx-branding.test.ts`

Expected: PASS.

### Task 10: Run the full verification loop, including live rehearsal

**Files:**

- Review: all modified files in prior chunks

- [ ] **Step 1: Run the full automated test suite**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Run governance guard**

Run: `npm run guard:ai`

Expected: PASS.

- [ ] **Step 4: Run the allocation mainline smoke**

Run: `npm run smoke:allocation-mainline`

Expected:

- wallet source visible
- OmRate/x402 evidence visible
- `Aave` and `Morpho` legs visible
- `Uniswap LP` approval gate visible
- approval resume visible
- grouped tx links visible
- portfolio push visible

- [ ] **Step 5: Re-run live proof smokes that remain contract-critical**

Run:

- `npm run smoke:deposit-mainline`
- `npm run smoke:uniswap-lp-roundtrip`

Expected:

- existing proven deposit path remains stable
- LP roundtrip remains closed after the new orchestration/evidence work

- [ ] **Step 6: Update docs if verification exposed reality gaps**

Keep README, runbook, and checklist aligned with actual validated behavior.

- [ ] **Step 7: Commit the rename + verification finish**

```bash
git add README.md docs/live-demo-runbook.md docs/hackathon/xlayer-demo-checklist.md AGENTS.md CLAUDE.md .mcp.json.example .codex/INSTALL.md .openclaw/INSTALL.md .opencode/INSTALL.md .claude-plugin/INSTALL.md package.json src/index.ts tests/agentphalanx-branding.test.ts
git commit -m "chore: finish agentphalanx outward rename"
```

---

## Final Acceptance Criteria

This plan is complete only when all of the following are true:

- managed wallet resolution is single-source, visible, and override-aware
- x402 readiness and payment execution are visible as distinct runtime evidence
- the proactive allocation mainline shows `Aave + Morpho + Uniswap LP` orchestration with approval pause/resume
- Telegram sends one grouped completion report with tx links and portfolio push
- replay is profile-driven and needs materially fewer manual patches
- outward-facing product copy consistently says `AgentPhalanx`
- `npm run test`, `npm run build`, and `npm run guard:ai` pass
- live smoke verification confirms the proactive allocation story and preserves existing proven deposit/LP roundtrip paths

---

Plan complete and saved to `docs/superpowers/plans/2026-04-14-agentphalanx-allocation-mainline-implementation-plan.md`. Ready to execute?
