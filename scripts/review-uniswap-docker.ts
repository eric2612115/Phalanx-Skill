/**
 * Docker review: Uniswap/uniswap-ai npm install / prepare (isolated HOME, no host mounts).
 */

import {
  buildUniswapInnerScript,
  deriveReviewStatus,
  finalizeUniswapReview,
  parseTimeoutMs,
  printJson,
  runDockerStdinScript,
} from "./review-shared.js";

const DEFAULT_IMAGE = "node:22-bookworm-slim";
const DEFAULT_TIMEOUT_MS = 420_000;

async function main(): Promise<void> {
  const image = process.env.UNISWAP_REVIEW_IMAGE ?? DEFAULT_IMAGE;
  const timeoutMs = parseTimeoutMs(process.env.UNISWAP_REVIEW_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  const { meta, stdout, stderr } = await runDockerStdinScript({
    image,
    timeoutMs,
    scriptBody: buildUniswapInnerScript(),
  });

  const structured = finalizeUniswapReview(stdout, stderr, meta);
  const status = deriveReviewStatus(meta);

  printJson({
    status,
    ...structured,
    notes: [
      "HOME is forced to /review/home; npm cache uses /review/npm-cache. The host home is not mounted.",
      "Install may be stopped by timeout; partial logs are still parsed for lifecycle, hooks, browser downloads, and engine warnings.",
    ],
  });

  if (status === "timeout" || status === "spawn_error" || status === "docker_error") {
    process.exitCode = 2;
  } else if (meta.exitCode !== 0 && meta.exitCode !== null) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  printJson({
    status: "spawn_error",
    error: e instanceof Error ? e.message : String(e),
    review: "uniswap-npm",
  });
  process.exitCode = 2;
});
