# Phalanx Installable Operator Package Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `Phalanx-Skill` into an installable operator package that can be cloned, installed, initialized, claimed through Telegram, used for daily operator queries/approvals, and rehearsed through the existing rebalance demo mainline.

**Architecture:** Keep `RuntimeCore` as the only mutation/approval pipeline and add two bounded surfaces around it: an install/init surface for operator bootstrap and a Telegram operator facade for read/query/explain workflows. Reuse the existing Guardian, MCP, approval, and demo orchestration paths; do not introduce a second execution path or a general-purpose chat agent.

**Tech Stack:** TypeScript, Node.js, Vitest, grammY, viem, existing Phalanx runtime/guardian/Telegram modules

---

## Scope And Non-Goals

**In scope:**
- `git clone -> npm install -> npm run init` bootstrap flow
- Telegram owner claim + setup wizard + operator query surface
- Query coverage for:
  - readiness / pending approvals
  - portfolio / balances / positions
  - recent events / guardian actions / tx refs
  - why blocked / what next
  - current whitelist / policy summary
  - risk summary / guardian last assessment
  - owner wallet / agent wallet / binding summary
- Demo hardening for the existing Guardian -> rebalance -> optional swap -> LP deposit -> approval -> resume path
- Clear fallback/boundary replies for unsupported Telegram requests
- Readiness model changes that match the agreed product assumptions

**Out of scope:**
- Open-ended LLM chat agent behavior
- Natural-language execution parsing such as "help me rebalance" as a freeform command
- Multi-turn option comparison / plan selection
- Marketplace packaging or registry publish work
- Cross-repo backend/frontend changes

---

## File Map

**Create:**
- `src/install/operator-init.ts` — structured init workflow that computes operator/demo readiness from config, fixed defaults, and capability probes
- `src/install/checks.ts` — low-level bootstrap/readiness checks for Telegram, OKX/onchainos, OmRate, governance, RPC, and wallet binding
- `src/install/formatters.ts` — human-readable CLI formatting for init results and next-step guidance
- `scripts/init-operator.ts` — CLI entrypoint for `npm run init`
- `src/telegram/operator-catalog.ts` — bounded operator query catalog and aliases
- `src/telegram/operator-router.ts` — routes READY-state Telegram text into setup / operator query / fallback lanes
- `src/telegram/operator-queries.ts` — query dispatch layer that calls focused providers
- `src/telegram/operator-formatters.ts` — Telegram text formatting for operator query results
- `src/telegram/fallback.ts` — unsupported request handling and capability-boundary responses
- `src/operator/providers/status-provider.ts` — runtime readiness and pending-approval view
- `src/operator/providers/portfolio-provider.ts` — portfolio / balances / positions view
- `src/operator/providers/event-provider.ts` — recent runtime events, guardian actions, and tx refs
- `src/operator/providers/explain-provider.ts` — explain the latest blocked/rejected outcome and suggested next step
- `src/operator/providers/policy-provider.ts` — whitelist and policy-summary view
- `src/operator/providers/risk-provider.ts` — risk observability and guardian last-assessment view
- `src/operator/providers/binding-provider.ts` — owner binding, agent wallet, config/wallet summary
- `tests/install-operator.test.ts` — init/readiness contract tests
- `tests/telegram-operator-router.test.ts` — Telegram router/query/fallback tests
- `tests/operator-providers.test.ts` — provider-level focused tests

**Modify:**
- `src/config/store.ts` — update readiness contract and fixed-default env behavior
- `config.env.example` — reflect operator-facing required/optional inputs and fixed defaults
- `package.json` — add `npm run init` and any renamed rehearsal command aliases
- `src/app/host.ts` — expose only the minimum query/reporting surfaces needed by providers
- `src/telegram/live.ts` — wire the operator router into READY-state message handling
- `src/telegram/setup.ts` — preserve owner-claim writeback and align setup messaging with init flow
- `src/guardian/service.ts` — expose stable access to last guardian assessment or equivalent query input
- `src/demo/rebalance-flow.ts` — tighten structured outputs needed by Telegram/report/query surfaces
- `README.md` — installation, init, Telegram operator usage, and rehearsal flow
- `docs/live-demo-runbook.md` — align the operator install story and demo steps with the new init/operator package
- `tests/runtime-host.test.ts` — host/provider access coverage
- `tests/demo-rebalance-flow.test.ts` — demo output shape and reportability coverage
- `tests/telegram-live.test.ts` — live Telegram contract tests for the router and formatting

**Potentially modify if needed for exact integration points:**
- `src/adapters/omrate.ts` — use fixed OmRate base defaults without requiring operator input
- `src/adapters/x402.ts` — align readiness summaries with the new "onchainos wallet is the x402 baseline" product assumption
- `src/adapters/onchainos.ts` — expose capability probes or wallet-summary helpers reused by init/providers

---

## Readiness Contract To Implement

**Required human-entered inputs during Phase 1 init:**
- `TELEGRAM_BOT_TOKEN`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `POLICY_OWNER_KEY` (required for full demo-ready governance path)
- `WHITELIST_POLICY_ADDRESS` (required for full demo-ready governance path)
- `PHALANX_OWNER_EVM_ADDRESS` (required for owner-withdraw demo/operator path)
- `BASE_RPC_URL` (required for LP/withdraw/mainline execution on Base)
- `OMRATE_API_KEY` is optional

**Derived / fixed / auto-persisted values:**
- `TELEGRAM_ALLOWED_USER_ID` is auto-written on first owner claim; do not require it at init time
- `OMRATE_API_BASE_URL` is fixed to `https://api.omrate.com` for operator flow; do not prompt the user for it
- `XLAYER_RPC_URL` uses the official default; do not prompt the user for it
- `AGENT_WALLET_ADDRESS` / `PHALANX_WALLET_ADDRESS` should be discovered from onchainos bootstrap or explicitly confirmed by init, not treated as a random manual env field
- x402 is a guaranteed baseline once onchainos + agentic wallet are ready; Phase 1 readiness must not require `PHALANX_X402_PRIVATE_KEY`

**Readiness levels to expose in init output:**
- `operator_ready` — Telegram + OKX/onchainos + wallet + OmRate access baseline are ready
- `demo_ready` — operator_ready plus governance, owner-withdraw, and Base execution prerequisites are ready
- `partial` — install is not fully blocked, but one or more named paths remain unavailable

---

## Chunk 1: Fix The Operator Readiness Model

### Task 1: Replace the current live-ready assumptions with operator-ready and demo-ready states

**Files:**
- Modify: `src/config/store.ts`
- Modify: `config.env.example`
- Test: `tests/install-operator.test.ts`

- [ ] **Step 1: Write failing readiness-contract tests**

Add tests that prove:
- `OMRATE_API_KEY` is optional
- `TELEGRAM_ALLOWED_USER_ID` is not required before first owner claim
- fixed defaults for OmRate base and xLayer RPC can satisfy readiness without user-entered env
- x402 baseline readiness does not depend on `PHALANX_X402_PRIVATE_KEY`
- `operator_ready` and `demo_ready` are distinct outcomes, not one boolean

- [ ] **Step 2: Run the readiness tests to verify they fail**

Run: `npm test -- tests/install-operator.test.ts`

Expected: FAIL because the current readiness model still requires `OMRATE_API_KEY`, `OMRATE_API_BASE_URL`, and `TELEGRAM_ALLOWED_USER_ID`

- [ ] **Step 3: Implement the new readiness model**

Implementation notes:
- preserve backwards compatibility where possible, but change the operator-facing contract
- keep fixed defaults and derived values explicit in code comments
- do not mix CLI formatting into `src/config/store.ts`
- if a new readiness summary type is introduced, keep it in `src/config/store.ts` or a closely-related install module, not inside Telegram code

- [ ] **Step 4: Update `config.env.example` to match the new contract**

The example file must:
- show only human-entered required values as blank
- mark `OMRATE_API_KEY` as optional
- note that `TELEGRAM_ALLOWED_USER_ID` is auto-written on first claim
- note fixed defaults for OmRate base and xLayer RPC instead of asking the operator to guess them

- [ ] **Step 5: Re-run the readiness tests**

Run: `npm test -- tests/install-operator.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the readiness contract update**

```bash
git add src/config/store.ts config.env.example tests/install-operator.test.ts
git commit -m "feat: redefine operator and demo readiness"
```

---

## Chunk 2: Add A Real `npm run init` Bootstrap Flow

### Task 2: Build the install/init workflow and CLI

**Files:**
- Create: `src/install/operator-init.ts`
- Create: `src/install/checks.ts`
- Create: `src/install/formatters.ts`
- Create: `scripts/init-operator.ts`
- Modify: `package.json`
- Test: `tests/install-operator.test.ts`

- [ ] **Step 1: Write failing init-flow tests**

Add tests that prove init:
- loads or creates `config.env` from `config.env.example`
- reports required missing values separately from optional ones
- reports OmRate access as `x402 baseline ready` when onchainos wallet/bootstrap is ready even without `OMRATE_API_KEY`
- distinguishes `operator_ready`, `demo_ready`, and partial readiness
- prints next steps such as "message the bot privately to claim owner"

- [ ] **Step 2: Run init-flow tests to verify failure**

Run: `npm test -- tests/install-operator.test.ts`

Expected: FAIL because the init workflow and CLI do not exist yet

- [ ] **Step 3: Implement low-level checks**

Checks to include:
- Telegram bot token configured
- OKX/onchainos credential presence
- agentic wallet / execution wallet summary availability
- OmRate base fixed default and optional API-key branch
- governance write prerequisites
- owner-withdraw prerequisites
- Base RPC presence
- official xLayer RPC default presence

Do not:
- perform destructive writes beyond creating/updating local config
- trigger owner claim automatically
- run execution mutations during init

- [ ] **Step 4: Implement the init formatter and CLI**

The CLI should:
- print a sectioned summary
- clearly distinguish required vs optional
- print next-step guidance
- exit non-zero only when `operator_ready` is false
- avoid echoing secrets

- [ ] **Step 5: Register the command**

Modify `package.json` to add:
- `init`: `tsx scripts/init-operator.ts`

- [ ] **Step 6: Re-run init tests**

Run: `npm test -- tests/install-operator.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the init workflow**

```bash
git add src/install src/config/store.ts scripts/init-operator.ts package.json tests/install-operator.test.ts
git commit -m "feat: add operator init workflow"
```

---

## Chunk 3: Expose Stable Query Surfaces From Host And Guardian

### Task 3: Add bounded host/provider access without turning `host.ts` into a query hub

**Files:**
- Create: `src/operator/providers/status-provider.ts`
- Create: `src/operator/providers/portfolio-provider.ts`
- Create: `src/operator/providers/event-provider.ts`
- Create: `src/operator/providers/explain-provider.ts`
- Create: `src/operator/providers/policy-provider.ts`
- Create: `src/operator/providers/risk-provider.ts`
- Create: `src/operator/providers/binding-provider.ts`
- Modify: `src/app/host.ts`
- Modify: `src/guardian/service.ts`
- Test: `tests/operator-providers.test.ts`
- Test: `tests/runtime-host.test.ts`

- [ ] **Step 1: Write failing provider tests**

Add focused tests that prove providers can return:
- runtime readiness + pending approvals
- portfolio / balances / positions summary
- recent events + tx refs + guardian actions
- latest blocked/rejected explanation with next-step text
- whitelist/policy summary
- risk observability and guardian last assessment
- owner binding / wallet / config summary

- [ ] **Step 2: Run provider/host tests to verify failure**

Run: `npm test -- tests/operator-providers.test.ts tests/runtime-host.test.ts`

Expected: FAIL because the provider modules and host accessors do not exist yet

- [ ] **Step 3: Add minimal host accessors**

Implementation notes:
- add only the smallest surfaces needed by providers
- keep heavy logic out of `src/app/host.ts`
- if host needs to expose last guardian assessment, prefer storing/querying a structured summary rather than scraping Telegram text
- preserve the existing runtime event source of truth

- [ ] **Step 4: Implement providers with strict responsibilities**

Rules:
- providers fetch/assemble data
- formatters do not fetch data
- providers must not perform state-changing actions
- `risk-provider` is observability only, not a new risk engine
- `explain-provider` should return a bounded `what happened / why / what next` shape

- [ ] **Step 5: Re-run provider/host tests**

Run: `npm test -- tests/operator-providers.test.ts tests/runtime-host.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the provider surface**

```bash
git add src/operator src/app/host.ts src/guardian/service.ts tests/operator-providers.test.ts tests/runtime-host.test.ts
git commit -m "feat: add operator query providers"
```

---

## Chunk 4: Add Telegram Operator Queries, Explain, And Fallback

### Task 4: Build a bounded Telegram operator facade

**Files:**
- Create: `src/telegram/operator-catalog.ts`
- Create: `src/telegram/operator-router.ts`
- Create: `src/telegram/operator-queries.ts`
- Create: `src/telegram/operator-formatters.ts`
- Create: `src/telegram/fallback.ts`
- Modify: `src/telegram/live.ts`
- Modify: `src/telegram/setup.ts`
- Test: `tests/telegram-operator-router.test.ts`
- Test: `tests/telegram-live.test.ts`

- [ ] **Step 1: Write failing Telegram router tests**

Add tests that prove:
- READY-state Telegram text routes into the bounded catalog
- the catalog supports all seven agreed query families
- "why blocked" maps to the explain provider
- unsupported requests return boundary/fallback replies
- setup/approval flows still work without regression

- [ ] **Step 2: Run Telegram router tests to verify failure**

Run: `npm test -- tests/telegram-operator-router.test.ts tests/telegram-live.test.ts`

Expected: FAIL because READY-state operator routing is not implemented

- [ ] **Step 3: Implement the operator catalog**

The catalog should:
- use bounded aliases and keywords
- cover the seven agreed query families
- not pretend to be a general LLM router
- make unsupported capability boundaries explicit

- [ ] **Step 4: Implement query routing and formatting**

Implementation notes:
- `live.ts` should remain transport glue
- `operator-router.ts` should classify and dispatch, not format final prose itself
- `operator-formatters.ts` should keep Telegram messages concise, operator-friendly, and consistent
- `fallback.ts` should list supported capabilities and redirect the user toward valid requests

- [ ] **Step 5: Re-run Telegram router/live tests**

Run: `npm test -- tests/telegram-operator-router.test.ts tests/telegram-live.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the Telegram operator facade**

```bash
git add src/telegram src/operator tests/telegram-operator-router.test.ts tests/telegram-live.test.ts
git commit -m "feat: add telegram operator query facade"
```

---

## Chunk 5: Harden Demo Mainline For Operator Use

### Task 5: Make the existing demo path queryable, explainable, and install-story aligned

**Files:**
- Modify: `src/demo/rebalance-flow.ts`
- Modify: `src/app/host.ts`
- Modify: `src/telegram/live.ts`
- Modify: `tests/demo-rebalance-flow.test.ts`
- Modify: `tests/runtime-host.test.ts`

- [ ] **Step 1: Write failing demo-surface tests**

Add tests that prove:
- Guardian/mainline demo outputs contain enough structured information for Telegram reports and operator queries
- optional swap, selected pool, approval state, and tx refs are queryable after the flow runs
- blocked LP actions can later be explained through the operator facade

- [ ] **Step 2: Run focused demo tests to verify failure**

Run: `npm test -- tests/demo-rebalance-flow.test.ts tests/runtime-host.test.ts`

Expected: FAIL because the current outputs are not yet packaged for operator queries/explanations

- [ ] **Step 3: Tighten the structured outputs**

Implementation notes:
- do not invent a second demo state machine
- keep `src/demo/rebalance-flow.ts` as orchestration, not Telegram logic
- make sure event summaries and tx refs are consistently available to the event/explain providers
- preserve the current whitelist-approval resume path through `RuntimeCore`

- [ ] **Step 4: Re-run demo tests**

Run: `npm test -- tests/demo-rebalance-flow.test.ts tests/runtime-host.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the demo hardening**

```bash
git add src/demo/rebalance-flow.ts src/app/host.ts src/telegram/live.ts tests/demo-rebalance-flow.test.ts tests/runtime-host.test.ts
git commit -m "feat: harden demo outputs for operator package"
```

---

## Chunk 6: Docs, Runbook, And Final Verification

### Task 6: Document the installable operator package and verify the package flow

**Files:**
- Modify: `README.md`
- Modify: `docs/live-demo-runbook.md`
- Modify: `config.env.example`
- Modify: `package.json`
- Modify if needed: any files touched in earlier chunks

- [ ] **Step 1: Update the README install story**

Document:
- `clone -> npm install -> npm run init`
- Telegram owner claim and setup
- operator queries and what they cover
- approval/report behavior
- OmRate access model: x402 baseline, API key optional

- [ ] **Step 2: Update the live demo runbook**

Document:
- required human-entered values
- fixed defaults and auto-persisted values
- how to complete init
- how to claim owner
- how to rehearse the demo path
- which Telegram questions should succeed during the demo

- [ ] **Step 3: Run the focused regression suite**

Run:
`npm test -- tests/install-operator.test.ts tests/operator-providers.test.ts tests/telegram-operator-router.test.ts tests/telegram-live.test.ts tests/runtime-host.test.ts tests/demo-rebalance-flow.test.ts`

Expected: PASS

- [ ] **Step 4: Run guard and build**

Run:
- `npm run guard:ai`
- `npm run build`

Expected:
- `guard:ai` returns OK
- `build` completes without TypeScript errors

- [ ] **Step 5: Run the operator init command locally**

Run:
- `npm run init`

Expected:
- prints a structured readiness summary
- shows next-step guidance
- does not print secrets

- [ ] **Step 6: Run the live/dry rehearsal path appropriate to local credentials**

Run at least one of:
- `PHALANX_SMOKE_SYNTHETIC_READY=1 npm run smoke:live`
- `npm run smoke:telegram-approval`

If full live demo credentials are present, also run:
- `npm run smoke:uniswap-lp-roundtrip`

Expected:
- the chosen rehearsal path completes and yields operator-usable evidence

- [ ] **Step 7: Commit docs and verification fixes**

```bash
git add README.md docs/live-demo-runbook.md config.env.example package.json
git commit -m "docs: publish installable operator workflow"
```

---

## Final Acceptance Criteria

Phase 1 is complete only when all of the following are true:

- A new operator can follow `README.md` to `npm install` and `npm run init`
- `npm run init` produces actionable readiness output matching the agreed product assumptions
- owner claim auto-persists `TELEGRAM_ALLOWED_USER_ID`
- Telegram can answer all seven agreed query families
- Telegram can explain the latest blocked/rejected outcome with a next-step suggestion
- unsupported Telegram requests are redirected to bounded capabilities instead of answered as a general assistant
- the existing rebalance demo mainline can be rehearsed without inventing a second execution path
- docs, tests, `guard:ai`, and build all pass

---

Plan complete and saved to `docs/superpowers/plans/2026-04-12-phalanx-installable-operator-package.md`. Ready to execute?
