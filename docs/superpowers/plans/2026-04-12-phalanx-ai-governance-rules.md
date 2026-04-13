# Phalanx-Skill AI Governance Rules Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repo-local AI governance system for `Phalanx-Skill` that constrains Cursor agents to preserve architecture boundaries, avoid file bloat, keep tests/docs aligned, and require planning before broad changes.

**Architecture:** Keep the existing repo-scope and operational rules, then add a focused set of repo-local guardrail rules for architecture, file growth, adapter discipline, verification gates, and change budget. The rule index remains the single entry point so future agents discover these constraints before editing code.

**Tech Stack:** Cursor `.mdc` rules, existing Phalanx-Skill repo docs, TypeScript repo structure, repo-local engineering conventions

---

## File Map

**Create:**
- `docs/superpowers/plans/2026-04-12-phalanx-ai-governance-rules.md` - this implementation plan
- `.cursor/rules/architecture-guardrails.mdc` - hard boundaries for runtime, host, executors, and adapters
- `.cursor/rules/file-size-and-splitting.mdc` - anti-bloat rules for large files and responsibility splits
- `.cursor/rules/adapter-discipline.mdc` - structure rules for external integrations and protocol-specific code
- `.cursor/rules/test-and-doc-gates.mdc` - required verification and documentation update gates
- `.cursor/rules/change-budget.mdc` - limits on task scope and mandatory planning triggers

**Modify:**
- `.cursor/rules/index.mdc` - make the new governance rules discoverable from the repo entry point
- `.cursor/rules/operational-checks.mdc` - upgrade reminders into explicit verification gates

**Reference only:**
- `.cursor/rules/repo-scope.mdc`
- `README.md`
- `src/app/host.ts`
- `src/runtime/core.ts`
- `src/adapters/onchainos.ts`
- `src/adapters/lp-execution.ts`
- `src/adapters/omrate.ts`
- `src/adapters/x402.ts`
- `src/executors/skill-backed.ts`

---

## Chunk 1: Governance Entry Point

### Task 1: Upgrade the rule index into a real governance map

**Files:**
- Modify: `.cursor/rules/index.mdc`
- Reference: `.cursor/rules/repo-scope.mdc`
- Reference: `.cursor/rules/operational-checks.mdc`

- [ ] **Step 1: Add a failing repository rule review checklist**

Write down the rule outcomes that must be true after this task:
- the index tells agents which rules must be read before editing
- the index distinguishes scope rules from engineering guardrails
- the index warns that `host.ts` is a composition root, not a business-logic landing zone

- [ ] **Step 2: Read the current index and preserve repo-scope behavior**

Confirm the updated index still describes `Phalanx-Skill` as the action-plane repo and does not override shared OmRate root boundaries.

- [ ] **Step 3: Add explicit pointers to the new rule set**

Update the index so future agents are directed to:
- `architecture-guardrails.mdc` for structural edits
- `file-size-and-splitting.mdc` when touching large files
- `adapter-discipline.mdc` when changing protocol or integration adapters
- `test-and-doc-gates.mdc` when behavior/env/docs change
- `change-budget.mdc` when scope expands across multiple subsystems

- [ ] **Step 4: Re-read the updated index for clarity**

Expected result:
- one short entry point
- no duplicated rule text
- clear navigation instead of abstract guidance

- [ ] **Step 5: Commit the rule index upgrade**

```bash
git add .cursor/rules/index.mdc
git commit -m "docs: map phalanx ai governance rules"
```

---

## Chunk 2: Structural Guardrails

### Task 2: Add architecture boundaries that prevent role drift

**Files:**
- Create: `.cursor/rules/architecture-guardrails.mdc`
- Reference: `src/app/host.ts`
- Reference: `src/runtime/core.ts`
- Reference: `src/executors/governance-aware.ts`
- Reference: `src/executors/skill-backed.ts`
- Reference: `src/adapters/*.ts`

- [ ] **Step 1: Write the failing architecture guardrail scenarios**

Document the scenarios this rule must stop:
- adding domain logic directly into `src/app/host.ts`
- letting `src/runtime/**` depend on Telegram, CLI, or HTTP transport details
- placing whitelist/approval/lifecycle policy inside adapters
- adding new state-changing actions without updating `runtime/intents.ts`

- [ ] **Step 2: Write the minimal rule with explicit allowed and forbidden responsibilities**

The rule must state:
- `src/app/host.ts` is a composition root and transport binder
- `src/runtime/**` owns orchestration and pipeline state transitions
- `src/executors/**` route actions to execution backends
- `src/adapters/**` translate external systems, not policy decisions

- [ ] **Step 3: Add "before editing" checks**

Require agents to answer:
- what layer am I changing?
- does this code belong here or in a new module?
- am I leaking policy into transport/integration code?

- [ ] **Step 4: Re-read the rule against current repo structure**

Expected result:
- rule language matches real file layout
- no idealized architecture that the repo does not already resemble

- [ ] **Step 5: Commit the architecture guardrail**

```bash
git add .cursor/rules/architecture-guardrails.mdc
git commit -m "docs: add phalanx architecture guardrails"
```

### Task 3: Add a file-growth rule to stop god files

**Files:**
- Create: `.cursor/rules/file-size-and-splitting.mdc`
- Reference: `src/app/host.ts`
- Reference: `src/adapters/onchainos.ts`
- Reference: `src/adapters/lp-execution.ts`

- [ ] **Step 1: Write the failing anti-bloat checklist**

Document the behaviors this rule must stop:
- appending new branches to an already heavy file without first evaluating extraction
- mixing parser, builder, retry, execution, and reporting logic in one new module
- expanding one-off protocol logic into shared adapters without separation

- [ ] **Step 2: Write the minimal anti-bloat rule**

The rule must require:
- a split-vs-append decision before modifying a large file
- extraction of new responsibilities into focused helpers/modules when edits are not tiny
- explanation in the agent response when a large file is extended instead of split

- [ ] **Step 3: Add explicit exceptions for small, local fixes**

Keep the rule practical:
- small bug fixes do not force unrelated refactors
- but new features cannot use "small fix" as a pretext to grow a god file

- [ ] **Step 4: Re-read for enforceability**

Expected result:
- rule contains concrete triggers, not vague style advice

- [ ] **Step 5: Commit the anti-bloat rule**

```bash
git add .cursor/rules/file-size-and-splitting.mdc
git commit -m "docs: add phalanx anti-bloat rule"
```

---

## Chunk 3: Integration Discipline

### Task 4: Add adapter rules so external integrations stay comprehensible

**Files:**
- Create: `.cursor/rules/adapter-discipline.mdc`
- Reference: `src/adapters/onchainos.ts`
- Reference: `src/adapters/omrate.ts`
- Reference: `src/adapters/x402.ts`
- Reference: `src/adapters/lp-execution.ts`

- [ ] **Step 1: Write the failing adapter drift checklist**

Document the bad behaviors this rule must prevent:
- hiding business/policy decisions inside parsers
- letting one adapter absorb multiple unrelated protocols without separation
- using unstructured throws where a normalized result is expected
- mixing command construction, subprocess execution, parsing, and domain routing in one new code path

- [ ] **Step 2: Write the minimal adapter rule**

The rule must require:
- clear separation of command building, execution, parsing, and normalization where practical
- structured `completed/failed/tool_missing/degraded` style outcomes for external dependencies
- protocol-specific branches to move into focused modules when they stop being trivial

- [ ] **Step 3: Add explicit non-goals**

The rule must say adapters do not own:
- approval policy
- runtime lifecycle decisions
- whitelist governance logic

- [ ] **Step 4: Re-read against current adapters**

Expected result:
- the rule guides future cleanup without declaring the whole current repo invalid

- [ ] **Step 5: Commit the adapter discipline rule**

```bash
git add .cursor/rules/adapter-discipline.mdc
git commit -m "docs: add phalanx adapter discipline rule"
```

---

## Chunk 4: Verification Gates

### Task 5: Turn verification and docs into mandatory gates

**Files:**
- Create: `.cursor/rules/test-and-doc-gates.mdc`
- Modify: `.cursor/rules/operational-checks.mdc`
- Reference: `README.md`
- Reference: `tests/**/*.test.ts`

- [ ] **Step 1: Write the failing verification checklist**

Document the minimum behaviors required after this task:
- new runtime behavior requires tests or an explicit reason why tests were not added
- env changes require doc updates
- startup/config/export changes require `npm run build`
- completion claims require `npm run test`

- [ ] **Step 2: Update `operational-checks.mdc` to use gate language**

Shift from reminders to explicit expectations:
- what must be run
- when docs must be updated
- what must never be committed

- [ ] **Step 3: Add the new verification rule**

The rule must require:
- test updates for new actions, new adapter branches, and approval-flow changes
- `README.md` or runbook updates when env/runtime behavior changes
- explicit disclosure when verification could not be completed

- [ ] **Step 4: Re-read the rule pair together**

Expected result:
- no duplicated wording
- operational checks stay short
- detailed gate logic lives in the new file

- [ ] **Step 5: Commit the verification rules**

```bash
git add .cursor/rules/operational-checks.mdc .cursor/rules/test-and-doc-gates.mdc
git commit -m "docs: add phalanx verification gates"
```

---

## Chunk 5: Scope Control

### Task 6: Add a change-budget rule so agents stop overreaching

**Files:**
- Create: `.cursor/rules/change-budget.mdc`

- [ ] **Step 1: Write the failing scope checklist**

Document the behaviors this rule must stop:
- solving multiple unrelated problems in one pass
- broad refactors without a prior plan
- touching runtime, host, adapters, and docs in one task without stating a clear scope
- "while I'm here" edits outside the user request

- [ ] **Step 2: Write the minimal change-budget rule**

The rule must require:
- one main problem per task unless the plan says otherwise
- explicit non-goals in larger changes
- planning before multi-subsystem edits
- refusal to silently widen scope

- [ ] **Step 3: Add planning triggers**

Require a plan-first workflow when:
- the change touches more than one major subsystem
- a new feature needs both runtime and adapter work
- a modification changes boundaries, not just behavior

- [ ] **Step 4: Re-read for practicality**

Expected result:
- rule is strong enough to prevent sprawl
- rule still allows normal focused implementation work

- [ ] **Step 5: Commit the scope control rule**

```bash
git add .cursor/rules/change-budget.mdc
git commit -m "docs: add phalanx change budget rule"
```

---

## Chunk 6: Final Validation

### Task 7: Validate that the rule set is enforceable

**Files:**
- Review: `.cursor/rules/index.mdc`
- Review: `.cursor/rules/architecture-guardrails.mdc`
- Review: `.cursor/rules/file-size-and-splitting.mdc`
- Review: `.cursor/rules/adapter-discipline.mdc`
- Review: `.cursor/rules/test-and-doc-gates.mdc`
- Review: `.cursor/rules/change-budget.mdc`
- Review: `.cursor/rules/operational-checks.mdc`

- [ ] **Step 1: Check that every new rule is under 500 lines and focused on one concern**

- [ ] **Step 2: Check that the rules collectively prevent these exact failure modes**
- direct business logic added to `src/app/host.ts`
- new protocol branches piled into a mega-adapter without separation
- runtime behavior changes shipped without tests/docs
- multi-subsystem sprawl without a prior plan

- [ ] **Step 3: Check for contradictions**

Make sure:
- `index.mdc` points to the rules without duplicating them
- `operational-checks.mdc` complements `test-and-doc-gates.mdc`
- no rule conflicts with root tri-repo ownership rules

- [ ] **Step 4: Run a final documentation sanity review**

Expected result:
- a future Cursor agent entering `Phalanx-Skill` has a clear path:
  1. understand repo scope
  2. read the right governance rules
  3. plan before broad edits
  4. verify before claiming success

- [ ] **Step 5: Commit the full governance ruleset**

```bash
git add .cursor/rules/index.mdc .cursor/rules/architecture-guardrails.mdc .cursor/rules/file-size-and-splitting.mdc .cursor/rules/adapter-discipline.mdc .cursor/rules/test-and-doc-gates.mdc .cursor/rules/change-budget.mdc .cursor/rules/operational-checks.mdc docs/superpowers/plans/2026-04-12-phalanx-ai-governance-rules.md
git commit -m "docs: add phalanx ai governance rules"
```

---

## Execution Notes

- Do not collapse all governance into one giant rule file; keep one concern per rule.
- Keep `index.mdc` short and navigational.
- The rules should constrain AI behavior using explicit `Always`, `Never`, `Before`, and `If ... then ...` language rather than abstract values.
- Do not rewrite existing root/shared OmRate ownership rules inside Phalanx-Skill.
- The first implementation pass should optimize for enforceability, not elegance.

Plan complete and saved to `docs/superpowers/plans/2026-04-12-phalanx-ai-governance-rules.md`. Ready to execute?
