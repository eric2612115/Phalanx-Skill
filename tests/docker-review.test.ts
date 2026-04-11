import { describe, expect, it } from "vitest";
import {
  deriveReviewStatus,
  extractAllMarkedSections,
  extractProfileBlocks,
  finalizeOnchainosReview,
  finalizeUniswapReview,
  parseOnchainosSignals,
  parseTimeoutMs,
  parseUniswapSignals,
  truncateLog,
  type DockerRunMeta,
} from "../scripts/review-shared.js";

function meta(partial: Partial<DockerRunMeta> = {}): DockerRunMeta {
  return {
    image: "test",
    timeoutMs: 1,
    startedAtIso: "",
    finishedAtIso: "",
    durationMs: 0,
    exitCode: 0,
    timedOut: false,
    signal: null,
    ...partial,
  };
}

describe("parseTimeoutMs", () => {
  it("uses fallback for empty or invalid env", () => {
    expect(parseTimeoutMs(undefined, 5000)).toBe(5000);
    expect(parseTimeoutMs("", 5000)).toBe(5000);
    expect(parseTimeoutMs("abc", 5000)).toBe(5000);
    expect(parseTimeoutMs("-1", 5000)).toBe(5000);
  });

  it("parses positive integers", () => {
    expect(parseTimeoutMs("120000", 1)).toBe(120000);
  });
});

describe("truncateLog", () => {
  it("leaves short strings unchanged", () => {
    expect(truncateLog("hi", 10)).toBe("hi");
  });

  it("truncates with notice", () => {
    const s = "x".repeat(20);
    const out = truncateLog(s, 10);
    expect(out).toContain("[truncated");
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).not.toBe(s);
  });
});

describe("extractAllMarkedSections", () => {
  it("returns ordered sections", () => {
    const log = `pre
=== ONCHAINOS_MANIFEST_START ===
a
=== ONCHAINOS_MANIFEST_END ===
mid
=== ONCHAINOS_MANIFEST_START ===
b
c
=== ONCHAINOS_MANIFEST_END ===`;
    const sections = extractAllMarkedSections(
      log,
      "=== ONCHAINOS_MANIFEST_START ===",
      "=== ONCHAINOS_MANIFEST_END ===",
    );
    expect(sections).toEqual([["a"], ["b", "c"]]);
  });
});

describe("extractProfileBlocks", () => {
  it("parses profile fences", () => {
    const log = `=== PROFILE .bashrc ===
export PATH=foo
=== END_PROFILE .bashrc ===`;
    expect(extractProfileBlocks(log)).toEqual([{ path: ".bashrc", content: "export PATH=foo" }]);
  });
});

describe("parseOnchainosSignals", () => {
  it("detects binary and cache paths from manifest", () => {
    const manifest = ["/review/home/.local/bin/onchainos", "/review/home/.onchainos/last_check"];
    const signals = parseOnchainosSignals("", manifest, []);
    expect(signals.binariesWritten).toBe(true);
    expect(signals.binaryPaths).toEqual(["/review/home/.local/bin/onchainos"]);
    expect(signals.cacheFilesWritten).toBe(true);
    expect(signals.cachePaths).toEqual(["/review/home/.onchainos/last_check"]);
  });

  it("detects profile modification via installer markers", () => {
    const signals = parseOnchainosSignals(
      "",
      [],
      [
        {
          path: ".profile",
          content: "# Added by onchainos installer\nexport PATH=\"$HOME/.local/bin:$PATH\"\n",
        },
      ],
    );
    expect(signals.shellProfileModified).toBe(true);
    expect(signals.touchedProfiles).toEqual([".profile"]);
  });

  it("infers binaries from log when manifest missing", () => {
    const signals = parseOnchainosSignals("Installed onchainos to /review/home/.local/bin/onchainos", [], []);
    expect(signals.binariesWritten).toBe(true);
  });
});

describe("parseUniswapSignals", () => {
  it("detects lifecycle and prepare", () => {
    const log = `npm info run prepare
> node scripts/prepare.cjs
`;
    const s = parseUniswapSignals(log);
    expect(s.lifecycleScriptsMentioned).toBe(true);
    expect(s.lifecycleHints.length).toBeGreaterThan(0);
  });

  it("detects git hook tooling", () => {
    const log = "added lefthook to .git/hooks/pre-commit\n";
    const s = parseUniswapSignals(log);
    expect(s.gitHooksAttempted).toBe(true);
  });

  it("detects browser download hints", () => {
    const log = "Downloading Chromium 120.0.0 — playwright install\n";
    const s = parseUniswapSignals(log);
    expect(s.largeBrowserDownloadStarted).toBe(true);
  });

  it("detects engine mismatch", () => {
    const log = "npm WARN EBADENGINE Unsupported engine { node: '>=99' }\n";
    const s = parseUniswapSignals(log);
    expect(s.engineMismatchWarning).toBe(true);
  });
});

describe("finalizeOnchainosReview", () => {
  it("uses last manifest as post-install file list", () => {
    const log = `=== ONCHAINOS_MANIFEST_START ===
=== ONCHAINOS_MANIFEST_END ===
x
=== ONCHAINOS_MANIFEST_START ===
/review/home/.local/bin/onchainos
=== ONCHAINOS_MANIFEST_END ===
=== PROFILE .bashrc ===
# Added by onchainos installer
=== END_PROFILE .bashrc ===
`;
    const r = finalizeOnchainosReview(log, "", meta());
    expect(r.signals.binariesWritten).toBe(true);
    expect(r.signals.shellProfileModified).toBe(true);
  });
});

describe("finalizeUniswapReview", () => {
  it("merges stdout and stderr for parsing", () => {
    const r = finalizeUniswapReview("", "npm WARN EBADENGINE bad\n", meta());
    expect(r.signals.engineMismatchWarning).toBe(true);
  });
});

describe("deriveReviewStatus", () => {
  it("returns timeout when timedOut", () => {
    expect(deriveReviewStatus(meta({ timedOut: true }))).toBe("timeout");
  });

  it("returns spawn_error for ENOENT", () => {
    expect(deriveReviewStatus(meta({ errorMessage: "spawn docker ENOENT" }))).toBe("spawn_error");
  });

  it("returns docker_error for other errors", () => {
    expect(deriveReviewStatus(meta({ errorMessage: "some docker failure" }))).toBe("docker_error");
  });

  it("returns completed when clean", () => {
    expect(deriveReviewStatus(meta())).toBe("completed");
  });
});
