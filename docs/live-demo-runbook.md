# Live Demo Runbook

This runbook verifies the current Phalanx live-capable runtime on a single machine.

## 1. Prepare `config.env`

Minimum fields for real live mode:

- `PHALANX_RUNTIME_MODE=live`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `OMRATE_API_KEY`
- `OMRATE_API_BASE_URL`
- `XLAYER_RPC_URL`
- `POLICY_OWNER_KEY`
- `WHITELIST_POLICY_ADDRESS`
- `PHALANX_OWNER_EVM_ADDRESS`
- `AGENT_WALLET_ADDRESS` or `PHALANX_WALLET_ADDRESS`

Optional:

- `PHALANX_ENABLE_MCP_STDIO=1`
- `PHALANX_GUARDIAN_ENABLED=1`
- `PHALANX_GUARDIAN_INTERVAL_MS=60000`
- `PHALANX_EVENT_STORE_PATH=.phalanx-runtime-events.json`
- x402 / Uniswap / Pancake env values for payment and LP quote/read paths
- `PHALANX_BASE_GAS_RESERVE_WEI`
- `PHALANX_XLAYER_GAS_RESERVE_WEI`

`TEST_WALLET_ADDRESS` is now a dry-run / synthetic fallback only. Real live execution should point at the current OKX Agentic Wallet via `AGENT_WALLET_ADDRESS` or `PHALANX_WALLET_ADDRESS`.

## 2. Re-run installer review before host-side third-party use

```bash
npm run review:docker:all
```

Compare against:

- `docs/third-party-install-review.md`
- `docs/third-party-review-baseline.md`

## 3. Run startup smoke

```bash
npm run smoke:live
```

Expected:

- startup summary prints `mode`
- readiness shows missing fields or `liveReady: true`
- `phalanx_status` path returns successfully

## 3.5 Fund the Agentic Wallet before real execution

Before any real live execution:

1. transfer a small amount of test funds into the OKX Agentic Wallet address
2. confirm the active wallet and balances with `onchainos wallet balance`
3. only then continue to LP / x402 / owner-withdraw live checks

## 4. Verify orchestration path without real funds

```bash
PHALANX_SMOKE_SYNTHETIC_READY=1 npm run smoke:live
```

Expected:

- portfolio path executes
- `phalanx_uniswap_liquidity_plan` returns planner evidence plus `runtimeDownstream.executionAction=depositLpPosition`
- blocked `depositLpPosition` on `uniswap-v3` returns `pending_approval`
- approval callback data is generated
- callback resumes the LP execution lane through `RuntimeCore`
- `withdrawToOwner` also returns `pending_approval` and resumes after callback
- smoke output includes `skillReadiness` for `onchainos`, `Uniswap liquidity-planner` discovery/plan, and `uniswapPlannerExecution` (official `SKILL.md` load + validation when `PHALANX_UNISWAP_SKILL_ROOT` points at an installed `Uniswap/uniswap-ai` tree)
- smoke output also includes a `pancakeswapOnchainos` capability probe so Pancake LP support can be assessed without changing the main demo line

## 5. Start runtime host

Without MCP stdio:

```bash
PHALANX_DRY_RUN_KEEPALIVE=0 npm run dev
```

With MCP stdio enabled:

```bash
PHALANX_ENABLE_MCP_STDIO=1 npm run dev
```

Note: when MCP stdio is enabled, startup output is written to `stderr` to avoid corrupting the MCP protocol stream.

`PHALANX_GUARDIAN_ENABLED` is read from the merged runtime config, so setting it in `config.env` is sufficient.

## 6. Real Telegram verification

When `TELEGRAM_BOT_TOKEN` is valid and `PHALANX_RUNTIME_MODE=live`:

1. start the runtime
2. send a private message to the bot
3. complete owner claim if not already bound
4. verify approval messages arrive in the same private chat

## 7. Real onchainos / OmRate / whitelist / LP verification

Run these incrementally with test wallets and small amounts already deposited into the Agentic Wallet:

1. onchainos capability probe and confirm `payment x402-pay` / `swap execute` are present
2. portfolio read
3. whitelist live check
4. whitelist expansion for the blocked `uniswap-v3` LP route -> Telegram approval -> callback resume
5. OmRate free path
6. OmRate x402-enabled path, ideally with `onchainos payment x402-pay` as the proof surface
7. Uniswap planner readiness check and downstream LP payload handoff into `depositLpPosition`
8. owner withdraw path: `withdrawToOwner` or `sweepToOwner` -> Telegram approval -> callback resume
9. only then attempt a tiny live execution

### 7.1 Uniswap LP roundtrip checklist

Use the dedicated live roundtrip script when you want a replayable proof bundle:

```bash
npm run smoke:uniswap-lp-roundtrip
```

Required env before running:

- `PHALANX_LP_INVESTMENT_ID`
- `PHALANX_LP_AMOUNT`
- `PHALANX_LP_AMOUNT_SECONDARY`
- `PHALANX_LP_TICK_LOWER`
- `PHALANX_LP_TICK_UPPER`

Optional env:

- `PHALANX_LP_CHAIN=base`
- `PHALANX_LP_TOKEN_A`, `PHALANX_LP_TOKEN_B`
- `PHALANX_LP_TOKEN`
- `PHALANX_LP_TOKEN_SECONDARY`
- `PHALANX_LP_AMOUNT_SECONDARY`
- `PHALANX_LP_DISCOVERY_PAGES`
- `PHALANX_LP_WITHDRAW_PLATFORM_ID`
- `PHALANX_LP_WITHDRAW_TOKEN_ID`
- `PHALANX_LP_WITHDRAW_RATIO`
- `PHALANX_LP_WITHDRAW_AMOUNT`
- `PHALANX_LP_RANGE` as planner-only context

Interpretation rules:

1. `phalanx_uniswap_liquidity_plan` is the planning source of truth for pool candidates and suggested range context
2. `onchainos defi list` / `positions` / `position-detail` are the execution-time discovery sources for `investmentId`, `platformId`, and `tokenId`
3. no local metadata cache is used in this round; before withdraw, refresh identifiers from `onchainos`
4. operator-supplied LP amounts must already be in minimal units
5. live Uniswap V3 execution on Base now uses direct `NonfungiblePositionManager` calldata through `onchainos wallet contract-call`, not the default high-level `onchainos defi invest/withdraw` LP route

Judge-facing explanation:

- reference note: `docs/uniswap-v3-direct-execution.md`
- keep this note in the demo packet so reviewers understand this is a deliberate integration fix, not an omitted feature

Expected evidence from the script:

- planner output with downstream payload template
- product discovery pages scanned against the requested `investmentId`
- deposit action result and Telegram callback result
- post-deposit positions / position-detail output
- derived withdraw payload
- withdraw action result and Telegram callback result
- post-withdraw positions / position-detail output

## 8. Productization gates before demo

Confirm all of the following before recording or presenting:

1. `ExecutionCoordinator` is the shared multi-step engine for `contract-call -> tx progress polling -> next step`
2. Guardian emits runtime events and terminal guardian outcomes can produce Telegram execution reports
3. non-whitelisted execution routes into governance approval, updates runtime whitelist state, and can resume the original action
4. MCP registration, dispatch, approval flow, host integration, and parser contracts are covered by automated tests

Recommended verification command:

```bash
npm test -- tests/execution-coordinator.test.ts tests/guardian-cycle.test.ts tests/mcp-approval-flow.test.ts tests/transport-live.test.ts tests/runtime-host.test.ts tests/adapter-contracts.test.ts
```

## 9. Demo script

For the short-term governance demo, prefer fixed policy items over raw address prompts:

- `aave-v3`
- `morpho-vaults`
- `uniswap-v3`
- `pancakeswap-v3`
- `whitelist-admin`

When an execution path needs a concrete address, keep that address in the payload or adapter mapping, but keep the user-facing approval text centered on the policy item.

### Segment A: autonomous rebalance

Goal:

- show Guardian creating an execution intent
- show RuntimeCore event stages
- show Telegram post-execution report with reason, risk note, and tx refs

Suggested setup:

1. start runtime with `PHALANX_GUARDIAN_ENABLED=1`
2. feed a portfolio snapshot or synthetic guardian cycle with drift above threshold
3. confirm event log shows `guardian_detected -> intent_received -> executed`
4. show Telegram report text and tx refs

Expected talking points:

- execution is autonomous only because the relevant policy items are already allowlisted, such as `aave-v3` and `morpho-vaults`
- the report is post-action, not pre-approval
- the reason and risk notes come from the structured runtime event model, not ad-hoc log scraping

### Segment B: x402 inside the flow

Goal:

- show OmRate/x402 settlement as part of the same runtime narrative, not as a separate toy step

Suggested evidence:

1. trigger the OmRate path that requires payment
2. capture the x402 settlement proof and resulting runtime summary
3. keep this as a short insert inside the rebalance or market-query flow

### Segment C: non-allowlisted action -> governance -> continue

Goal:

- show a non-allowlisted policy item being stopped by policy
- show Telegram approval request
- show whitelist contract write and resumed execution

Suggested setup:

1. invoke `phalanx_uniswap_liquidity_plan` first and capture `runtimeDownstream.payloadTemplate`
2. invoke `phalanx_action` with `action=depositLpPosition`, `target=uniswap-v3`, and a filled-in payload template
3. confirm MCP returns `pending_approval`
4. approve in Telegram
5. confirm callback summary says the `uniswap-v3` policy item was widened and the LP add-liquidity action resumed
6. invoke the same `depositLpPosition` action again and confirm it executes without another approval
7. keep `pancakeswap-v3` as a secondary capability probe rather than the main blocked demo target
8. if you need real-chain closure instead of governance-only proof, run `npm run smoke:uniswap-lp-roundtrip` after the approval path is confirmed

### Segment D: funds return to owner

Goal:

- show that funds can be returned from the active Agentic Wallet to the fixed owner wallet
- show this path is approval-gated and separate from whitelist governance

Suggested setup:

1. invoke `phalanx_action` with `action=withdrawToOwner` or `action=sweepToOwner`
2. confirm MCP returns `pending_approval`
3. approve in Telegram
4. confirm callback resumes owner withdrawal directly, without any whitelist expansion
5. confirm gas reserve remains on-chain after `sweepToOwner`

## 10. Evidence checklist

Capture these artifacts during the demo rehearsal:

- startup summary showing `mode`, readiness, and guardian surface state
- test output from the productization regression suite
- Telegram approval screenshot for blocked `Uniswap LP add liquidity`
- roundtrip script JSON output containing requested `investmentId`, scanned discovery pages, and derived withdraw identifiers
- Telegram approval screenshot for `withdraw to owner` or `sweep to owner`
- Telegram execution report screenshot for guardian execution
- tx hashes or synthetic governance refs for whitelist write and resumed execution
- event log snippet showing correlated `intentId` / `correlationId`
- Uniswap planner evidence showing official skill discovery plus downstream runtime target/action/payload template
- x402 settlement line or proof artifact
- proof that the same `uniswap-v3` LP action executes without another approval after the policy item is widened
- proof that LP withdraw identifiers were refreshed from `onchainos positions` / `position-detail` rather than a stale local cache
- proof that owner withdrawal uses direct approval rather than whitelist governance

## 11. Validation gates

### Short-term demo ready

- fixed policy items are the user-facing governance subject
- `uniswap-v3` LP is blocked before approval and resumes after approval
- `pancakeswap-v3` remains on the same LP execution interface and is probed separately for live capability
- owner withdrawal is fixed-destination, approval-gated, and preserves gas reserve on sweep
- local whitelist persistence stores the symbolic policy item
- chain-visible governance, when enabled, may separately use a concrete contract address
- execution-time `onchainos` security checks remain downstream of approval

### Medium-term bundle ready

- a fixed policy item can seed a future policy bundle draft
- bundle payloads can expand into address/action/token scopes without replacing the approval router
- the agent can explain bundle meaning, risk, and pruning suggestions
- adding bundle support does not require rewriting the current governance state machine

## 12. Fallback paths

Use these fallback modes when live dependencies are partially unavailable:

- if Telegram is unavailable, show `getTelegramApprovalOutbox()` / callback data through the smoke path
- if Guardian market input is not live-ready, inject a synthetic drifted portfolio and still demonstrate the runtime event flow
- if whitelist contract write is not ready on the current machine, stop before the governance segment and do not claim live completion
- if Uniswap planner skill is unavailable, run the official discovery/readiness proof first and keep execution on the onchainos side only after planner readiness is restored
- if x402 payment is unavailable, keep the run focused on coordinator and governance proof, and treat x402 as a separate evidence bundle

## 13. Safety reminders

- Do not use main funds for first-run verification.
- Keep third-party install review in Docker.
- Treat quote/read success separately from live execution success.
- Preserve normalized logs and summaries for every failed step.
