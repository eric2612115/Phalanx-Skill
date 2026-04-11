# Third-party Review Baseline

> Date: 2026-04-09
> Scope: Current Docker-isolated baseline findings for external Phalanx dependencies

## Purpose

This document records the current baseline for third-party install behavior before direct host-side integration work continues.

It is not a complete security audit. It is a repeatable checkpoint derived from the Docker review scripts in this repo.

## Review environment

- Docker only
- isolated in-container `HOME`
- no real API credentials
- no host home bind-mounted

## onchainos-skills baseline

Review command:

```bash
ONCHAINOS_REVIEW_TIMEOUT_MS=120000 npm run review:docker:onchainos
```

Observed result:

- `status: completed`
- installer downloaded and installed a prebuilt `onchainos` binary
- binary written under `~/.local/bin/onchainos`
- cache file written under `~/.onchainos/last_check`
- shell profile modified to add `~/.local/bin` to `PATH`

Current interpretation:

- acceptable for continued evaluation in isolated environments
- not approved for blind host-side installation
- host-side install still requires explicit risk acceptance because installer modifies shell profile and installs a binary outside the project tree

## uniswap-ai baseline

Review command:

```bash
UNISWAP_REVIEW_TIMEOUT_MS=180000 npm run review:docker:uniswap
```

Observed result:

- `status: timeout`
- lifecycle scripts were detected
- `lefthook` / git-hook related activity was detected
- browser download signals were detected (Playwright / Chromium)
- engine mismatch warning was detected

Current interpretation:

- install surface is heavier than a normal prompt-only skill repo
- not approved for blind host-side install
- use Docker or another isolated environment for further inspection
- direct host-side use should be treated as an explicit decision, not the default path

## Integration gate

Before adapter work uses external third-party tooling directly:

1. run the Docker review command again
2. compare results against this baseline
3. stop if new host-modification or install-time behavior appears
4. record any accepted deviation before moving forward

## Current decision

- continue building local adapter contracts and script wrappers in `Phalanx-Skill`
- keep third-party install validation inside Docker
- do not silently convert this baseline into host-side install approval
