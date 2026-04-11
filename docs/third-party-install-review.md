# Third-party install review (Docker)

Repeatable checks for third-party installer behavior run **inside Docker** with an isolated in-container `HOME` (`/review/home`). The host user home directory is **not** mounted, and no OKX or other credentials are passed.

## Prerequisites

- Docker daemon available (`docker run` works).
- Network access to pull images and reach GitHub / npm registry.

On a cold machine, `docker run` may spend most of the timeout pulling `debian:bookworm-slim` or `node:22-bookworm-slim`. For short `*_REVIEW_TIMEOUT_MS` values, pre-pull images first (for example `docker pull node:22-bookworm-slim`) so the timer applies mainly to the install step.

## Commands

| Command | Purpose |
|--------|---------|
| `npm run review:docker:onchainos` | Runs `okx/onchainos-skills` `install.sh` in a Debian container. |
| `npm run review:docker:uniswap` | Shallow-clones `Uniswap/uniswap-ai` and runs `npm install --foreground-scripts`. |
| `npm run review:docker:all` | Runs both reviews sequentially. |

## Environment overrides

| Variable | Default | Effect |
|----------|---------|--------|
| `ONCHAINOS_REVIEW_IMAGE` | `debian:bookworm-slim` | Base image for the onchainos review. |
| `ONCHAINOS_REVIEW_TIMEOUT_MS` | `180000` | Hard cap; container process is killed on expiry. |
| `UNISWAP_REVIEW_IMAGE` | `node:22-bookworm-slim` | Base image for the Uniswap review. |
| `UNISWAP_REVIEW_TIMEOUT_MS` | `420000` | Hard cap for `npm install` (can be slow). |

## Reading JSON output

Scripts print a single JSON object to stdout.

- **`status`**: `completed` | `timeout` | `docker_error` | `spawn_error`
- **`meta`**: timings, exit code, `timedOut`, optional `errorMessage`
- **`signals`**: normalized findings (see below)
- **`stdout` / `stderr` / `combinedLog`**: captured logs (truncated if very large)

Exit codes: `0` success, `1` completed but install exited non-zero, `2` timeout or Docker/spawn failure.

### OKX / onchainos (`review: "onchainos-install"`)

Inspect `signals`:

- **`binariesWritten`**, **`binaryPaths`**: files under `~/.local/bin` (in-container home).
- **`cacheFilesWritten`**, **`cachePaths`**: e.g. `~/.onchainos/` cache files.
- **`shellProfileModified`**, **`touchedProfiles`**, **`profileSnippets`**: shell rc/profile changes typical of `ensure_in_path` in `install.sh`.

### Uniswap (`review: "uniswap-npm"`)

Inspect `signals`:

- **`lifecycleScriptsMentioned`**, **`lifecycleHints`**: `prepare` / `postinstall` / lifecycle lines in npm output.
- **`gitHooksAttempted`**, **`gitHookHints`**: husky, lefthook, `.git/hooks`, etc.
- **`largeBrowserDownloadStarted`**, **`browserDownloadHints`**: Playwright/Chromium-style download lines.
- **`engineMismatchWarning`**, **`engineHints`**: `EBADENGINE` and related engine notices.

Partial runs after a timeout still emit structured fields; rely on `meta.timedOut` and the captured log prefix.

## Unit tests (no Docker)

Parsing and normalization are covered without Docker:

```bash
npm test -- tests/docker-review.test.ts
```

## Implementation files

- `scripts/review-shared.ts` — shared Docker runner, parsers, result shaping
- `scripts/review-onchainos-docker.ts`
- `scripts/review-uniswap-docker.ts`
- `tests/docker-review.test.ts`
