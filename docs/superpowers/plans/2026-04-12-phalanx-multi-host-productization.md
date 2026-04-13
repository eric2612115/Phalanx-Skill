# Phalanx-Skill Multi-Host Productization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize `Phalanx-Skill` so external developers can install it across multiple AI hosts with one shared source of truth, thin per-host adapters, preserved governance, and a truthful install story.

**Architecture:** Keep the existing runtime, governance rules, hooks, and `guard:ai` flow as the quality floor. Add a packaging/documentation layer on top: one SSOT doc set under `docs/agent-pack/`, short root routers, host-specific thin install folders, MCP example wiring, and a repo/package/install surface that distinguishes “installable” from “publishable.”

**Tech Stack:** Markdown docs, Cursor rules/hooks, Node.js package metadata, npm scripts, MCP stdio server, GitHub Actions

---

## Scope And Non-Goals

**In scope:**
- external install story
- host adapters and routing docs
- MCP productization docs and examples
- package metadata readiness if justified
- CI-anchored governance for all hosts

**Out of scope:**
- refactoring core runtime, policy, risk, or adapter logic unless packaging strictly requires it
- weakening `guard:ai`, rules, hooks, or CI checks
- inventing unsupported marketplace/plugin formats
- claiming npm or `npx skills add` publishability without verification

**Critical distinction:**
- **Installable** means an external user can wire the repo into a host with documented steps.
- **Publishable** means the repo is actually ready to release to npm/registry/marketplace.
- This plan allows completing the first without falsely claiming the second.

---

## File Map

**Create:**
- `docs/superpowers/plans/2026-04-12-phalanx-multi-host-productization.md` - this implementation plan
- `docs/agent-pack/GOVERNANCE.md` - short SSOT governance index for humans and agents
- `docs/agent-pack/PRE_MERGE_CHECKLIST.md` - shared validation checklist for all hosts
- `docs/agent-pack/DECISIONS.md` - packaging/support decision record
- `AGENTS.md` - short root router for agent-capable hosts
- `.codex/INSTALL.md` - thin Codex CLI install guide
- `.openclaw/INSTALL.md` - thin OpenClaw install guide
- `.opencode/INSTALL.md` - thin OpenCode install guide
- `.mcp.json.example` - example MCP server wiring based on the actual stdio entrypoint

**Conditional create:**
- `.claude-plugin/INSTALL.md` or equivalent Claude-facing thin install guide if the current plugin format is not safely automatable
- `.cursor-plugin/` only if a documented, stable format is confirmed; otherwise do not create fake packaging metadata
- `install.sh` and `install.ps1` only if a truthful automation path is implemented and tested

**Modify:**
- `README.md` - external-facing install and product docs
- `CLAUDE.md` - reduce to a short router plus critical commands if needed
- `package.json` - package readiness fields, install helpers, and safe publish surface if justified
- `.github/workflows/ai-governance.yml` - extend only if the productization flow needs stricter CI integration
- `scripts/ai-governance-guard.mjs` - only if productization-specific checks are truly necessary

**Reference:**
- `.cursor/rules/*.mdc`
- `.cursor/hooks.json`
- `.cursor/hooks/*.mjs`
- `src/mcp/stdio.ts`
- `README.md`
- `package-lock.json`

---

## Proposed Final Directory Tree Diff

Before implementation, the worker should aim for a structure close to:

```text
docs/
  agent-pack/
    GOVERNANCE.md
    PRE_MERGE_CHECKLIST.md
    DECISIONS.md
.codex/
  INSTALL.md
.openclaw/
  INSTALL.md
.opencode/
  INSTALL.md
.claude-plugin/              # only if compatible/manual steps are real
  INSTALL.md
.cursor-plugin/              # only if documented and stable
AGENTS.md
CLAUDE.md                    # short router, not long policy copy
.mcp.json.example
README.md
package.json
```

The worker must write this tree diff into `docs/agent-pack/DECISIONS.md` before large edits and explicitly call out any host folder that is intentionally omitted.

---

## Chunk 1: Inventory And Decision Record

### Task 1: Record what is already true before packaging work begins

**Files:**
- Create: `docs/agent-pack/DECISIONS.md`
- Reference: `package.json`
- Reference: `README.md`
- Reference: `src/mcp/stdio.ts`
- Reference: `.cursor/rules/index.mdc`
- Reference: `.github/workflows/ai-governance.yml`

- [ ] **Step 1: Write the support matrix**

Capture:
- which hosts are intended
- which hosts are fully supported now
- which hosts are manual-install only
- which hosts are deferred

- [ ] **Step 2: Write the installable vs publishable decision**

State explicitly:
- whether npm publishing is intended now
- whether the work only prepares the repo for publishing later
- whether `npx skills add` is actually supported now or deferred

- [ ] **Step 3: Record the proposed final tree diff**

Write the planned host folders and SSOT paths before making broad edits.

- [ ] **Step 4: Record rejected or deferred formats**

If `.cursor-plugin/` or `.claude-plugin/` is not backed by a stable spec, say so directly and prefer manual install docs.

- [ ] **Step 5: Review the decision file for honesty**

Expected result:
- no fake host support
- no fake registry story
- no packaging claim without evidence

---

## Chunk 2: SSOT For Governance And Merge Discipline

### Task 2: Create the shared source of truth for all hosts

**Files:**
- Create: `docs/agent-pack/GOVERNANCE.md`
- Create: `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- Reference: `docs/superpowers/plans/2026-04-12-phalanx-ai-governance-rules.md`
- Reference: `.cursor/rules/*.mdc`
- Reference: `.cursor/hooks.json`
- Reference: `scripts/ai-governance-guard.mjs`
- Reference: `.github/workflows/ai-governance.yml`

- [ ] **Step 1: Write `GOVERNANCE.md` as an index, not duplicated policy prose**

It should link to:
- repo rules
- hooks
- `guard:ai`
- CI workflow
- the existing AI governance plan

- [ ] **Step 2: Write `PRE_MERGE_CHECKLIST.md`**

It must include:
- `npm run guard:ai`
- when to run `npm test`
- when to run `npm run build`
- a reminder that CI is the final quality floor even if local hooks are disabled

- [ ] **Step 3: Keep both files thin**

They should route and summarize. Do not restate full rule text already living under `.cursor/rules/`.

- [ ] **Step 4: Review for SSOT discipline**

Expected result:
- all host docs can point here
- no long policy forks exist

---

## Chunk 3: Root Routers

### Task 3: Add short root entry docs for external agent hosts

**Files:**
- Create: `AGENTS.md`
- Modify: `CLAUDE.md`
- Reference: `docs/agent-pack/GOVERNANCE.md`
- Reference: `docs/agent-pack/PRE_MERGE_CHECKLIST.md`

- [ ] **Step 1: Create `AGENTS.md` as a short router**

It should include:
- what this repo is
- where SSOT lives
- critical commands
- governance must-read links

- [ ] **Step 2: Shorten or align `CLAUDE.md`**

Do not delete repo identity. Convert it into a short router to SSOT plus critical commands if it is longer than necessary.

- [ ] **Step 3: Keep both files under roughly 80 lines**

Do not let root routing docs become a second source of truth.

- [ ] **Step 4: Review for consistency**

Expected result:
- `README.md`, `AGENTS.md`, and `CLAUDE.md` all point to the same SSOT and commands

---

## Chunk 4: Thin Per-Host Install Adapters

### Task 4: Add manual-first, truthful host install guides

**Files:**
- Create: `.codex/INSTALL.md`
- Create: `.openclaw/INSTALL.md`
- Create: `.opencode/INSTALL.md`
- Conditional create: `.claude-plugin/INSTALL.md`
- Conditional create: `.cursor-plugin/` only if spec is real
- Reference: `docs/agent-pack/GOVERNANCE.md`
- Reference: `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- Reference: `config.env.example`

- [ ] **Step 1: Write one thin host guide template**

Each host file should contain:
- what the host needs
- where SSOT lives
- how to run `guard:ai`
- secrets warning
- whether the setup is automated or manual

- [ ] **Step 2: Apply the template per host**

Keep host-specific instructions thin. Avoid copying long governance text.

- [ ] **Step 3: Add unsupported/manual-only labels**

If automation is not real, say “manual setup” directly.

- [ ] **Step 4: Decide whether Claude/Cursor packaging metadata is real**

If not verified, do not invent plugin manifests. Prefer an `INSTALL.md` that documents the actual manual steps.

- [ ] **Step 5: Review for divergence**

Expected result:
- each host doc is thin
- all host docs point back to SSOT
- no contradictory instructions exist

---

## Chunk 5: MCP Productization

### Task 5: Expose the real MCP install story

**Files:**
- Create: `.mcp.json.example`
- Reference: `src/mcp/stdio.ts`
- Reference: `src/index.ts`
- Reference: `README.md`

- [ ] **Step 1: Confirm the actual MCP command path**

Use the real stdio server entrypoint already present in the repo. Do not invent a wrapper command unless you actually add it.

- [ ] **Step 2: Create `.mcp.json.example`**

It must reflect:
- real command
- real args if any
- env placeholders only

- [ ] **Step 3: Document scope and security**

State:
- project vs user scope
- required env vars
- secrets handling expectations
- when MCP should be enabled

- [ ] **Step 4: Review for truthfulness**

Expected result:
- the example can be copied with minimal changes
- it matches the actual repo behavior

---

## Chunk 6: Install Story And Package Readiness

### Task 6: Decide and implement the truthful installation path

**Files:**
- Modify: `package.json`
- Conditional create: `install.sh`
- Conditional create: `install.ps1`
- Reference: `package-lock.json`
- Reference: `README.md`

- [ ] **Step 1: Decide the primary install story**

Choose one of:
- real `npx skills add` path if verified
- manual clone/symlink/copy path
- install script path if implemented and tested

- [ ] **Step 2: Prepare package metadata honestly**

Only if justified, add:
- `repository`
- `engines`
- `files`
- `bin`
- package name readiness

- [ ] **Step 3: Prevent bad publish surfaces**

Ensure secrets, local env files, and unrelated large artifacts would not ship in a future package tarball.

- [ ] **Step 4: Add automation only if real**

If install scripts are created, they must reflect actual behavior. If not, keep the install story manual.

- [ ] **Step 5: Review installable vs publishable language**

Expected result:
- the repo may become installable without falsely claiming release readiness

---

## Chunk 7: README Overhaul

### Task 7: Rewrite README for external users without losing repo truth

**Files:**
- Modify: `README.md`
- Reference: `docs/agent-pack/GOVERNANCE.md`
- Reference: `docs/agent-pack/PRE_MERGE_CHECKLIST.md`
- Reference: `.mcp.json.example`

- [ ] **Step 1: Rebuild README section order**

README must include:
- What it is
- Prerequisites
- Install
- Verify
- Development
- Security
- License

- [ ] **Step 2: Add multi-host install section**

Point readers to the thin host folders and SSOT.

- [ ] **Step 3: Add verification section**

Include:
- `npm run guard:ai`
- host install verification
- MCP verification if applicable

- [ ] **Step 4: Keep OmRate boundary summary short**

Link to the tri-repo relationship at a high level. Do not duplicate all internal architecture docs.

- [ ] **Step 5: Review for external readability**

Expected result:
- a new external user can install without reading internal chat history

---

## Chunk 8: CI And Final Verification

### Task 8: Verify the packaging layer without weakening governance

**Files:**
- Modify if needed: `.github/workflows/ai-governance.yml`
- Review: all files created in earlier chunks

- [ ] **Step 1: Verify `guard:ai` remains the shared quality floor**

Do not weaken guard rules to make packaging easier.

- [ ] **Step 2: Decide whether CI needs any productization-specific extension**

Only extend CI if needed for packaging validation. Do not add noisy or fake checks.

- [ ] **Step 3: Run local verification**

Run:
- `npm run guard:ai`
- `npm test` if behavior or scripts affecting repo behavior changed
- `npm run build` if package metadata or startup wiring changes require it

- [ ] **Step 4: Review acceptance criteria against the result**

Confirm:
- external install docs exist
- SSOT exists
- at least Cursor plus one CLI host are documented
- `guard:ai` still passes on a clean tree
- no host doc contradicts another

---

## First Implementation Steps For The Execution Session

1. Read `docs/agent-pack/DECISIONS.md` after it is created.
2. Present the final directory tree diff before broad edits.
3. Implement in this order:
   - SSOT docs
   - root routers
   - thin host install docs
   - MCP example
   - install story / package readiness
   - README
   - verification
4. If a host/plugin format is uncertain, stop and document manual setup instead of guessing.

## Expected Result

After this plan is implemented:
- `Phalanx-Skill` has one SSOT for governance and merge discipline
- root docs route external users and agents to the same source of truth
- host-specific install docs stay thin and honest
- MCP wiring is documented and reproducible
- the install story is truthful about what is manual vs automated
- CI still enforces one common bottom line through `guard:ai`

Plan complete and saved to `docs/superpowers/plans/2026-04-12-phalanx-multi-host-productization.md`. Ready to execute?
