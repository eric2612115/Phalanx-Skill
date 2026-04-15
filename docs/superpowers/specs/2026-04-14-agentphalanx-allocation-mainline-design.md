# AgentPhalanx Allocation Mainline Design

## Summary

This spec defines the next product-shaping slice for `AgentPhalanx`: a replayable, operator-visible allocation mainline where the runtime initializes an operator, resolves the active Agentic Wallet, observes funding, pays for OmRate intelligence through x402 when required, allocates funds across `Aave` and `Morpho`, pauses for Telegram approval before `Uniswap LP` allocation when whitelist policy blocks the route, resumes after approval, publishes grouped transaction links, and pushes an updated portfolio summary back to Telegram.

The design also defines the rename boundary from `Phalanx-Skill` to `AgentPhalanx`, while keeping runtime compatibility where hard renames would risk live-flow regressions.

## Product Goal

The product should feel like a proactive, self-custodial allocator rather than a collection of tools the user manually interrogates.

The viewer of the demo should be able to understand, in order:

1. the user bootstraps the runtime and gets an OKX Agentic Wallet
2. the user funds the wallet
3. the runtime actively requests OmRate intelligence
4. the runtime visibly handles x402 payment when required
5. the runtime allocates capital into `Aave` and `Morpho`
6. the runtime tries to allocate into `Uniswap LP`, hits whitelist policy, and requests approval
7. the user approves in Telegram
8. the runtime resumes and completes the LP deposit
9. the runtime pushes grouped tx links and a portfolio update back to Telegram

## Non-Goals

- Replacing `Onchain OS` as the execution or custody boundary
- Turning Telegram into a general-purpose chat assistant
- Reworking backend/data-plane ownership out of `OmRate-Backend`
- Renaming every internal symbol, env prefix, or file path in one risky migration
- Shipping a hosted SaaS control plane

## Canonical Full Flow

The canonical product flow for this slice is:

1. User runs init and provides required operator information
2. Runtime provisions or resolves the OKX Agentic Wallet and shows its source
3. User deposits funds into the Agentic Wallet
4. Runtime detects funds are available for execution
5. Runtime requests OmRate intelligence for allocation
6. OmRate request indicates payment is required
7. Runtime performs x402 payment and records payment evidence
8. Runtime computes an allocation plan
9. Runtime executes the `Aave` allocation leg
10. Runtime executes the `Morpho` allocation leg
11. Runtime attempts the `Uniswap LP` allocation leg
12. Whitelist/policy blocks the LP route and creates a pending approval
13. Telegram delivers the approval request
14. User approves in Telegram
15. `RuntimeCore` resumes the original action
16. Runtime executes the `Uniswap LP` deposit
17. Runtime sends one grouped Telegram completion report with tx links
18. Runtime sends or updates a portfolio summary in Telegram

This full flow becomes the product-level source of truth for demo, replay, telemetry, and docs.

## Architecture Overview

The architecture remains layered:

- `src/app/host.ts` stays a composition root
- `src/runtime/**` owns the canonical intent lifecycle and execution evidence stream
- `src/executors/**` map allocation intents to backend execution lanes
- `src/adapters/**` translate `Onchain OS`, `OmRate`, x402, and protocol-specific operations
- `src/telegram/**` renders operator-facing messages and bounded queries from runtime truth

The new work is not a second orchestration system. It is a tightening of the existing runtime so all critical stages become visible, replayable, and product-shaped.

Telegram remains a transport and presentation surface. It must not become the owner of approval state, whitelist policy, or lifecycle branching; those remain runtime concerns and are only rendered or acknowledged through Telegram.

## Design Pillar 1: Managed Wallet Resolution Must Be Single-Source And Explainable

### Current problem

Wallet resolution currently works, but the product surface still treats explicit env addresses as common practice and does not consistently explain why a given address was selected. This creates operator confusion and hides whether the runtime is behaving according to the Agentic Wallet trust model.

### Design

Create one canonical wallet-resolution contract, produced from `Onchain OS` state plus explicit override inputs. All live execution lanes that require a wallet must consume the same normalized result.

The normalized result should expose:

- `resolvedAddress`
- `source`: `managed`, `explicit_override`, or `test_fallback`
- `chain`
- `reason`
- `overrideActive`

### Rules

- `Onchain OS managed wallet` is the default source in live mode
- `AGENT_WALLET_ADDRESS` / `PHALANX_WALLET_ADDRESS` remain explicit troubleshooting overrides
- test-only fallback stays available outside live mode
- wallet resolution for x402 payment and execution must use the same source of truth

### Operator visibility

The active wallet and its source must be visible in:

- runtime logs
- smoke/demo proof JSON
- operator status queries
- Telegram summary/report messages where relevant

## Design Pillar 2: x402 Payment Must Be Visible As An Execution Stage

### Current problem

x402 readiness exists in pieces, but there is not yet one operator-visible contract that distinguishes:

- baseline readiness
- payment-aware planning
- actual payment attempt
- payment settlement/degraded outcome

Without this, operators cannot monitor whether OmRate intelligence really used paid access, and demo viewers cannot see that x402 is part of the runtime mainline rather than a hidden implementation detail.

### Design

Define a normalized payment evidence contract shared across runtime, logs, smoke proof, and Telegram formatting.

The contract should expose:

- `mode`: `plain`, `x402_optional`, `x402_required`
- `baselineReady`
- `paymentAttempted`
- `paymentWrapped`
- `paymentSettled`
- `summary`
- optional `receipt` or provider proof metadata when available

`paymentWrapped` specifically means the runtime successfully switched into an x402-capable payment transport. It is intentionally separate from `paymentAttempted`, because a request can be payment-aware or payment-attempted without successfully entering the wrapped transport path.

### Required distinctions

Three states must be separated:

1. `baseline`
   - whether the runtime is capable of x402-backed access
2. `plan-time`
   - whether the requested OmRate call is payment-aware or payment-required
3. `run-time`
   - whether payment actually happened, degraded, or failed

### Observability requirement

The runtime must emit enough evidence so that an operator can answer:

- did this action use OmRate?
- was x402 required?
- did payment actually happen?
- if not, did it degrade or fail?
- did the action continue afterward?

## Design Pillar 3: Allocation Must Be Productized As A Proactive Mainline

### Current problem

The repo already proves several pieces individually, but the product story must shift from "tool invocations that can be demonstrated" to "a proactive allocator that acts, pauses for governance, then completes."

### Design

Create or tighten one allocation-oriented mainline that explicitly stages:

- funding readiness
- OmRate intelligence
- x402 payment when required
- allocation decisions
- `Aave` execution
- `Morpho` execution
- `Uniswap LP` attempt
- whitelist/approval pause
- approval resume
- LP completion
- grouped reporting
- portfolio push

### Runtime milestones

The canonical execution evidence should expose milestone booleans or states for:

- `wallet_resolved`
- `funding_ready`
- `omrate_requested`
- `x402_required`
- `x402_payment_attempted`
- `x402_payment_settled`
- `allocation_planned`
- `aave_executed`
- `morpho_executed`
- `uniswap_blocked_for_approval`
- `approval_requested`
- `approval_resumed`
- `uniswap_executed`
- `tx_refs_captured`
- `portfolio_push_sent`

### Why this matters

This is what makes allocation feel agentic. The user is not manually stepping protocol by protocol. The runtime is taking initiative, surfacing risk boundaries, then closing the loop.

## Design Pillar 4: Telegram Becomes A Bounded Operator Console

Telegram is not a freeform assistant. It is the mobile operator panel for `AgentPhalanx`.

It formats runtime truth and returns operator decisions, but it does not own orchestration policy.

### Responsibilities

1. `control`
   - approval requests and decisions
   - clear blocked reason / next step guidance
2. `observe`
   - runtime readiness
   - wallet source
   - x402/payment state
   - recent execution summary
3. `inspect`
   - LP position detail
   - grouped tx links
   - portfolio status

### Required query families

- readiness / status
- agent wallet / wallet source
- recent events / recent execution evidence
- why blocked / risk summary
- current portfolio
- LP position detail

### LP position detail minimum shape

The LP detail surface must, at minimum, show:

- `chain`
- `protocol`
- `poolAddress`
- `tokenId`
- `platformId`
- `token0`
- `token1`
- `feeTier`
- `tickLower`
- `tickUpper`
- `currentTick` or equivalent range state
- `inRange`
- `liquidity`
- `withdrawable`
- `lastUpdatedAt`

### Completion report shape

When an action completes, Telegram should send one grouped completion report, not a scatter of unrelated messages.

Recommended order:

1. action + final status
2. wallet source and execution context
3. x402/payment summary
4. action-specific result summary
5. grouped tx refs with clickable explorer links

After that, the runtime may send a portfolio summary push if the action materially changed allocation state.

## Design Pillar 5: Demo / Replay Must Be Profile-Driven

### Current problem

The repo is much closer to stable, but replay still risks requiring manual env overrides or operator memory. This weakens the product story and makes the full flow harder to rehearse consistently.

### Design

Keep the split between:

- `config.env`: user/operator-facing values
- `service.env`: service/runtime defaults

Then introduce a small number of explicit flow profiles that control which orchestration path runs. Example profiles:

- `allocation_mainline`
- `deposit_only`
- `roundtrip`
- `rehearsal`

### Profile responsibilities

A flow profile can define:

- whether OmRate/x402 lane is enabled
- whether `Aave` / `Morpho` / `Uniswap` allocation legs run
- whether Telegram approval is expected
- whether grouped tx reporting is enabled
- whether portfolio push follows execution

### Replay output contract

Smoke/demo JSON should include:

- wallet evidence
- payment evidence
- execution milestones
- grouped tx refs
- high-level human summary

This output becomes the shared proof bundle for recordings, operational debugging, and future CI/smoke assertions.

## Design Pillar 6: Rename To AgentPhalanx Must Be Real But Safe

### Product rename goal

The product should be presented as `AgentPhalanx`, not `Phalanx-Skill`, because the repo now represents an agent runtime and operator plane rather than a single skill package.

### Rename strategy

This spec recommends a two-layer rename:

#### Must rename now

- README title and core product copy
- runbook and install docs
- Telegram-facing product name
- MCP-facing product name where user-visible
- package description and public-facing metadata
- demo/proof/report labels

#### Keep compatibility for now

- `PHALANX_*` env prefixes
- some internal symbols and file names
- old script aliases where removal would break current operator usage

### Reason

The product identity must change now, but runtime compatibility should not be risked by a one-shot internal rename of every technical identifier.

## Error Handling And Recovery

The design must prefer bounded failures over silent ambiguity.

### Examples

- If wallet resolution picks an explicit override, the runtime should say so
- If OmRate is requested but x402 payment degrades, the runtime should expose the degraded reason
- If `Aave` succeeds and `Morpho` fails, the execution evidence should show partial completion rather than collapse into one generic failure
- If `Uniswap LP` is blocked, the operator should see that this is a whitelist/approval gate, not an execution bug
- If Telegram delivery fails, the runtime should record that reporting failed even if execution succeeded

### Approval association and resume safety

Pending approvals must be modeled as resumable runtime state rather than Telegram-owned state.

At minimum, a pending approval must retain:

- the originating `intentId`
- the execution segment to resume
- a unique approval identifier
- created-at and expiry metadata
- a terminal state that prevents duplicate acceptance

Resume behavior must reject stale, duplicated, or already-consumed approvals. On restart or replay, the runtime should either restore a safe resumable approval record or explicitly mark the approval as expired/cancelled rather than silently accepting an ambiguous callback.

## Testing And Verification Strategy

### Required automated coverage

- wallet resolution precedence and source visibility
- x402 baseline / payment-required / payment-settled evidence
- allocation orchestration milestone reporting
- Telegram grouped completion reports
- LP position detail formatting
- flow-profile config loading and replay output
- rename-sensitive docs and user-facing surfaces

### Required verification commands after implementation

- `npm run test`
- `npm run build`
- `npm run guard:ai`

### Required live verification for this feature slice

- the proactive allocation mainline is exercised end-to-end
- `Aave` and `Morpho` allocation evidence is visible
- `Uniswap LP` gate -> Telegram approval -> resume -> deposit path is visible
- grouped tx links are delivered to Telegram
- portfolio push is delivered after execution
- proof output contains wallet and x402 evidence

## Rollout Phasing

### Phase 1

- unify wallet and x402 evidence contracts
- expose the evidence through runtime logs and smoke proof
- complete the proactive allocation mainline with visible milestones

### Phase 2

- finish richer Telegram LP and portfolio reporting
- add grouped completion reports and portfolio pushes everywhere they matter
- make replay profiles stable enough for repeated demos

### Phase 3

- finish any remaining outward `AgentPhalanx` rename stragglers that were not safely completed in earlier phases
- keep temporary compatibility aliases where needed
- schedule a later cleanup pass for internal identifiers and legacy env naming

## Product Distance Assessment

After this spec is implemented, `AgentPhalanx` would be close to a strong v1 operator product, but not fully product-complete.

Expected state after implementation:

- the core proactive allocation story is real, not implied
- the trust model is coherent
- monitoring and replay are substantially better
- Telegram becomes a real operator surface
- the rename is credible to outside users

What would still remain after this spec:

- deeper production hardening across flaky dependencies and retries
- release packaging/versioning discipline
- better operator analytics/monitoring beyond runtime evidence
- broader wallet/protocol lifecycle polish
- final cleanup of compatibility aliases and legacy naming

In product terms, successful implementation of this spec should move the repo from "promising advanced demo system" to roughly "75-85% of a credible first operator product," with the remaining gap concentrated in hardening, packaging, and long-tail operational polish rather than missing core product behavior.
