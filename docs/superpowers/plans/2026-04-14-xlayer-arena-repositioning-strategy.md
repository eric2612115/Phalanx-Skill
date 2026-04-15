# X Layer Arena Repositioning Strategy

**Status:** Active strategy document for the current hackathon submission and same-day demo recording.

**Primary objective:** Position `Phalanx-Skill` as a self-custodial, local-first, X Layer-relevant Agentic application built on top of `Onchain OS`, `Uniswap Skill`, and `OmRate`, then close the smallest set of gaps required for a stable recorded demo and credible judging outcome.

**Submission target:** `X Layer Arena`

**Recording target for today:** a stable, replayable deposit live mainline. The full `deposit -> tokenId discovery -> withdraw` roundtrip is now also live-proven, but `deposit` remains the default recording cut because it is the simplest story to replay cleanly. The fuller product story layers in proactive allocation plus `x402` visibility when the demo env is enabled.

---

## 1. Final Product Positioning

`Phalanx-Skill` should not be pitched as a generic cloud agent platform, a standalone wallet infra stack, or a thin skill wrapper.

It should be pitched as:

> **A self-custodial, local-first Agentic runtime for X Layer-oriented DeFi operations that uses OKX Onchain OS as the execution substrate, OmRate as the paid intelligence layer, and Uniswap Skill as the LP planning layer.**

Core positioning rules:

- `Phalanx-Skill` does **not** replace wallet custody, signing, or broadcast infrastructure that OKX already provides through `onchainos`.
- `Phalanx-Skill` does **not** ask users to trust a hosted SaaS with private keys.
- `Phalanx-Skill` does own the agent runtime layer:
  - MCP entry and tool orchestration
  - policy and whitelist gating
  - risk checks
  - Telegram approval routing
  - action resume after approval
  - planner-to-execution handoff
  - operator-facing runtime evidence

This positioning turns three likely reviewer objections into strengths:

- `Why depend on onchainos?` Because reusing the official execution substrate is the correct trust-boundary decision.
- `Why local-first / single-operator?` Because self-custody is a feature, not an incomplete SaaS story.
- `Why no cloud control plane?` Because the first product promise is safe local operator execution, not hosted key custody.

Non-goals for the current submission:

- building a hosted execution service
- replacing OKX signing or custody
- becoming a general marketplace-style skill registry
- solving every protocol or operator-console workflow before the deadline

---

## 2. Judge-Facing Mainline Narrative

The submission should present one dominant story and keep secondary capabilities in supporting roles.

### Mainline story

1. An operator runs a local/self-hosted Phalanx runtime with an OKX Agentic Wallet.
2. The runtime receives an execution intent through MCP.
3. Phalanx uses OmRate as the cross-protocol intelligence layer, with x402-ready access when required.
4. Phalanx uses the Uniswap planning path to choose the correct LP target and execution shape.
5. Phalanx applies policy, risk, whitelist, and approval controls before mutation.
6. If the route is not yet approved, Telegram delivers a human approval step.
7. After approval, the runtime resumes the original action through `RuntimeCore`.
8. OKX Onchain OS executes the live transaction path.
9. The runtime produces operator-usable evidence: approval outcome, action summary, and transaction references.

### What the judges should remember

- This is an **Agentic application**, not just a skill pack.
- The product is **self-custodial and local-first**.
- The runtime already proves a live path:
  - Telegram approval
  - local-first whitelist update
  - action resume
  - correct Uniswap V3 pool selection
  - live deposit via `onchainos wallet contract-call`
  - returned tx refs
  - tokenId discovery and live withdraw in the roundtrip proof

### How each judging dimension is satisfied

**Onchain OS / Uniswap integration and innovation (25%)**

- `onchainos` is the real execution boundary, not mocked decoration.
- Uniswap Skill is used for planner/discovery and feeds a real runtime handoff.
- Phalanx adds governance, approval, and execution orchestration on top of those surfaces.

**X Layer ecosystem integration (25%)**

- The project is explicitly positioned for X Layer usage and x402-linked paid intelligence.
- X Layer relevance is not ornamental; it is part of the paid-data and execution narrative.

**AI interaction experience (25%)**

- MCP initiates the action path.
- Telegram provides approval and bounded operator interaction.
- The runtime gives a coherent machine-plus-human workflow rather than isolated tools.

**Product completeness (25%)**

- The mainline demo shows a real operator flow from intent to live execution.
- The repo contains tests, runbooks, and replayable rehearsal paths.
- The remaining gaps are framed as bounded extensions, not missing foundations.

---

## 3. Current State And Gap Analysis

This section is the source of truth for the current delivery state. It should replace stale assumptions in older docs.

### Already proven

- `guard:ai` false-positive handling for extracted files/untracked files is fixed.
- `npm run init` and the readiness contract match the installable local-operator model.
- `OMRATE_API_BASE_URL` has a stable default and `OMRATE_API_KEY` is optional.
- `POLICY_OWNER_KEY` and `WHITELIST_POLICY_ADDRESS` are future extensions, not demo blockers.
- Telegram approval has been exercised live:
  - message delivered
  - callback received
  - `RuntimeCore` resumed execution
- whitelist flow is now `local-first`, with optional on-chain governance.
- LP `poolAddress` is correctly recognized for whitelist/governance targeting.
- Uniswap planner selection bugs have been fixed:
  - correct pool version selection
  - pair-aware token matching
- direct Uniswap V3 live deposit lane is working:
  - `approve`
  - `multicall(mint, refundETH)`
- TypeScript build has passed after the current modification set.
- focused tests have passed for live LP execution and planner behavior.
- a real live deposit path completed and returned transaction references.

### Current proven live mainline

- Telegram message
- `host.handleTelegramMessage`
- pending approval
- Telegram approve
- `host.handleTelegramCallback`
- local whitelist update
- resume original action
- planner selects the correct pool
- `onchainos wallet contract-call`
- approve step
- deposit step
- `status: completed`
- tx refs returned

### Still incomplete

- fuller Telegram LP position reporting
- final wallet address resolution model where Onchain OS managed addresses are primary and env values are overrides only
- a no-override final demo config that can be replayed without ad hoc CLI patching
- a clearer allocation/x402 rehearsal path that is as replayable as the deposit-default cut

### Interpretation

The product is no longer at the "prove one transaction is possible" stage.

The main problem is now:

> **Package the proven deposit mainline as a credible, replayable, clearly-positioned Agentic application, while closing the smallest number of remaining gaps that most increase judge confidence.**

---

## 4. Deadline-Driven Priorities

### P0: must finish before recording and submission

These items directly affect whether the repo looks coherent, real, and replayable.

#### P0.1 Onchain OS managed address auto-resolution

Goal:

- make Onchain OS managed address discovery the default wallet source
- demote `PHALANX_WALLET_ADDRESS` and similar envs to explicit override behavior

Why it matters:

- aligns the product with the OKX Agentic Wallet trust model
- removes old architecture residue from the recorded demo
- reduces operator error during replay

Acceptance signal:

- deposit mainline works without relying on legacy wallet env override assumptions

#### P0.2 One-command deposit rehearsal / recording path

Goal:

- add a stable operator script that prepares and runs the deposit-focused mainline used in recording

Why it matters:

- the recording should not depend on manual shell memory
- the repo needs a single command judges can understand

Acceptance signal:

- one documented command can drive the deposit-focused rehearsal
- the command emits or captures proof artifacts needed for recording

#### P0.3 README and runbook realignment

Goal:

- update `README.md` and active runbooks so they describe the product as it exists now, not as it looked in an earlier phase

Why it matters:

- AI reviewers score what the repo says and what the repo does
- stale docs create trust loss even when code is good

Acceptance signal:

- docs clearly reflect:
  - local-first operator model
  - Onchain OS dependence as design, not accident
  - current proven deposit mainline
  - current remaining gaps

#### P0.4 Evidence bundle checklist

Goal:

- define exactly what screenshots, tx refs, terminal outputs, and Telegram states must be captured during recording rehearsal

Why it matters:

- prevents last-minute demo chaos
- makes judging evidence legible

Acceptance signal:

- one checklist exists and can be followed in order during rehearsal

### P1: do if time permits before submission

#### P1.1 Allocation / x402 full-story packaging

Why it matters:

- makes the fuller product story as legible as the default deposit cut
- prevents judges from assuming x402 / proactive allocation are absent just because the default recording path is deposit-first

But:

- this is not today's recording blocker

#### P1.2 Telegram LP position detail query

Why it matters:

- strengthens AI interaction quality
- makes the operator story feel more like a product

Minimum viable shape:

- `poolAddress`
- `tokenId`
- `tickLower`
- `tickUpper`
- `liquidity`
- `inRange`
- `withdrawable state`

#### P1.3 CI quality floor expansion

Current reviewer risk:

- CI emphasizes `guard:ai`, but not the full quality loop

Desired shape:

- `npm run guard:ai`
- `npm run test`
- `npm run build`

Reason:

- makes the repo feel like a product artifact, not just a governed codebase

### P2: post-hackathon productization

- deeper `host.ts` decomposition
- richer operator console surfaces
- release and packaging hardening
- broader protocol support
- more formal audit/deploy/release documentation

---

## 5. README, Demo, GitHub, And Submission Packaging

### README goals

`README.md` should become the judge-facing product entrypoint.

It should answer, quickly:

- what this product is
- why it exists
- why it is local-first
- how it uses `Onchain OS`, `Uniswap Skill`, and `OmRate`
- what is already proven live
- how to reproduce the demo path

### README sections to add or rewrite

- `What Phalanx Is`
- `Why Local-First And Self-Custodial`
- `How Onchain OS, OmRate, And Uniswap Skill Work Together`
- `Current Proven Capabilities`
- `Current Live Mainline`
- `Quick Demo Path`
- `Architecture Overview`
- `Trust Model`
- `Hackathon Positioning In X Layer`
- `Known Gaps And Next Steps`

### Demo video structure

Target duration: `1-3 minutes`

Suggested structure:

1. show runtime identity and local-first setup
2. show MCP-driven intent or operator-triggered mainline
3. show Telegram approval request
4. approve in Telegram
5. show resumed execution
6. show Onchain OS live execution evidence
7. show returned tx refs
8. optionally show position lookup or withdraw preview if ready

### GitHub repo packaging

The repository should feel submission-ready:

- top-level README is current
- no stale contradictory product claims
- active runbook matches the demo
- code and docs both emphasize local-first operator control
- hackathon-relevant commands are easy to discover

### Submission form guidance

The form and public description should repeat the same product sentence:

> Phalanx is a self-custodial, local-first Agentic runtime for X Layer-oriented DeFi operations, using OKX Onchain OS for execution, OmRate for paid intelligence, and Uniswap Skill for LP planning.

### X / social post guidance

The post should highlight:

- Agentic Wallet
- Telegram approval
- paid intelligence / x402 path
- live LP deposit proof
- X Layer relevance

Avoid generic "AI + DeFi" language. Lead with the trust model and the live proof.

---

## 6. Reviewer Objections And Recommended Answers

### `Why depend so much on onchainos?`

Recommended answer:

`Because the correct product boundary is to reuse OKX's execution substrate rather than reimplement signing and broadcast ourselves. Phalanx adds the governance, approval, planner handoff, and runtime orchestration layer on top of that secure base.`

### `Why is this local-first instead of a cloud platform?`

Recommended answer:

`Because self-custody is the product principle. We are not asking users to hand private-key authority to a hosted SaaS. The operator controls the runtime, while Phalanx adds policy, approval, and execution discipline.`

### `Why not build your own wallet infra?`

Recommended answer:

`That would weaken, not strengthen, the trust story for this submission. Replacing the official execution substrate would create more surface area and more questions.`

### `Is this a product or still a prototype?`

Recommended answer:

`It is a working local-first operator product with a proven live deposit mainline and a live-proven withdraw roundtrip, plus a small number of clearly-scoped remaining enhancements such as richer position reporting, managed-wallet cleanup, and stronger allocation/x402 packaging.`

### `Why no hosted control plane / HA / SaaS management layer?`

Recommended answer:

`That is intentionally out of scope for the current trust model. The first product promise is safe local execution with an Agentic Wallet, not hosted key custody.`

---

## 7. Post-Hackathon Productization Route

The hackathon version should evolve without losing its trust model.

### Near-term

- enrich Telegram LP position reporting
- harden replay scripts and evidence generation
- make managed wallet resolution the default everywhere
- package the allocation/x402 story as clearly as the deposit-default recording path

### Mid-term

- expand operator-facing observability
- improve release and upgrade documentation
- reduce `host.ts` orchestration weight
- strengthen CI and published verification expectations

### Longer-term

- formalize execution-provider contracts around Onchain OS without replacing it
- package richer policy bundles and operator controls
- extend protocol coverage while preserving the same runtime boundary

### Productization rule

Do not trade away self-custody just to look more SaaS-like.

The right long-term path is:

- better operator experience
- better replayability
- better evidence
- better packaging

not hosted private-key control.

---

## 8. Acceptance Criteria For This Strategy

This strategy is being followed correctly only if:

- the recorded demo centers on the proven deposit mainline
- docs stop describing already-fixed blockers as current blockers
- the product is presented as a local-first Agentic application, not a generic skill pack
- `Onchain OS`, `Uniswap Skill`, and `OmRate` each have a clear and non-overlapping role
- the remaining work list is short, concrete, and believable
- `withdraw` is not described as unfinished when the current repo state already treats it as live-proven

---

## 9. Immediate Execution Decision

For the current hackathon window, the recommended execution order is:

1. close wallet auto-resolution
2. create the one-command deposit rehearsal path
3. realign `README.md` and the live runbook
4. record the stable deposit mainline
5. if time remains, push allocation/x402 packaging and LP detail reporting

This is the highest-confidence path to a repository that both automated judges and human reviewers can score as credible, coherent, and deserving.
