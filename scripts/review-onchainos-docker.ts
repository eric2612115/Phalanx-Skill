/**
 * Docker review: okx/onchainos-skills install.sh behavior (isolated HOME, no host mounts).
 */

import {
  buildOnchainosInnerScript,
  deriveReviewStatus,
  finalizeOnchainosReview,
  parseTimeoutMs,
  printJson,
  runDockerStdinScript,
} from "./review-shared.js";

const DEFAULT_IMAGE = "debian:bookworm-slim";
const DEFAULT_TIMEOUT_MS = 180_000;

async function main(): Promise<void> {
  const image = process.env.ONCHAINOS_REVIEW_IMAGE ?? DEFAULT_IMAGE;
  const timeoutMs = parseTimeoutMs(process.env.ONCHAINOS_REVIEW_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  const { meta, stdout, stderr } = await runDockerStdinScript({
    image,
    timeoutMs,
    scriptBody: buildOnchainosInnerScript(),
  });

  const structured = finalizeOnchainosReview(stdout, stderr, meta);
  const status = deriveReviewStatus(meta);

  printJson({
    status,
    ...structured,
    notes: [
      "HOME is forced to /review/home inside the container; the host home directory is not mounted.",
      "No OKX API credentials are passed; the installer only uses public GitHub endpoints.",
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
    review: "onchainos-install",
  });
  process.exitCode = 2;
});
