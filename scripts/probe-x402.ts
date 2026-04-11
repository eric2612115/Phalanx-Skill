/**
 * Capability probe: programmatic x402 client path (npm ecosystem), without adapter code.
 * Uses a disposable temp project + `npm install @x402/fetch` so Node can resolve the package.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isExecutedDirectly,
  runProbeCommand,
  trimProbeSummary,
  type ProbeCommandRecord,
} from "./probe-shared.js";

export type X402ProbeResult = {
  probe: "x402";
  programmablePath: {
    status: "ok" | "failed" | "tool_missing";
    /** Resolved export names when import succeeds (subset). */
    exportsSample?: string[];
    exitCode?: number | null;
    summary?: string;
  };
  rawCommandsRun: ProbeCommandRecord[];
};

/** Parse first JSON line from probe subprocess stdout. */
export function parseX402ProbeStdout(stdout: string): {
  ok: boolean;
  keys?: string[];
  message?: string;
} {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("{"));
  if (!line) return { ok: false, message: "no json line in stdout" };
  try {
    return JSON.parse(line) as { ok: boolean; keys?: string[]; message?: string };
  } catch {
    return { ok: false, message: "invalid json from probe subprocess" };
  }
}

const PROBE_SCRIPT = `
import('@x402/fetch')
  .then((m) => {
    console.log(JSON.stringify({ ok: true, keys: Object.keys(m).slice(0, 24) }));
  })
  .catch((e) => {
    console.log(JSON.stringify({ ok: false, message: String(e?.message ?? e) }));
    process.exit(1);
  });
`.trim();

/**
 * Verify @x402/fetch can be installed and imported in an isolated temp project (no repo dependency).
 */
export async function runX402Probe(): Promise<X402ProbeResult> {
  const rawCommandsRun: ProbeCommandRecord[] = [];
  let probeDir: string | undefined;

  try {
    probeDir = mkdtempSync(path.join(tmpdir(), "phalanx-x402-probe-"));
    writeFileSync(
      path.join(probeDir, "package.json"),
      JSON.stringify(
        { name: "phalanx-x402-probe", private: true, type: "module" },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(path.join(probeDir, "probe.mjs"), `${PROBE_SCRIPT}\n`);

    const install = await runProbeCommand(
      "npm",
      ["install", "@x402/fetch@^2", "--no-fund", "--no-audit"],
      { cwd: probeDir, timeoutMs: 300_000 },
    );
    rawCommandsRun.push(install);

    if (install.spawnError?.code === "ENOENT") {
      return {
        probe: "x402",
        programmablePath: {
          status: "tool_missing",
          summary: "npm not found on PATH",
        },
        rawCommandsRun,
      };
    }

    if (!install.ok) {
      return {
        probe: "x402",
        programmablePath: {
          status: "failed",
          exitCode: install.exitCode,
          summary: trimProbeSummary(
            install.stderr || install.stdout || "npm install @x402/fetch failed",
            400,
          ),
        },
        rawCommandsRun,
      };
    }

    const record = await runProbeCommand("node", ["probe.mjs"], {
      cwd: probeDir,
      timeoutMs: 60_000,
    });
    rawCommandsRun.push(record);

    if (!record.ok) {
      const parsed = parseX402ProbeStdout(record.stdout);
      return {
        probe: "x402",
        programmablePath: {
          status: "failed",
          exitCode: record.exitCode,
          summary:
            parsed.message ||
            trimProbeSummary(record.stderr || record.stdout || "node probe.mjs failed", 400),
        },
        rawCommandsRun,
      };
    }

    const parsed = parseX402ProbeStdout(record.stdout);
    if (!parsed.ok) {
      return {
        probe: "x402",
        programmablePath: {
          status: "failed",
          summary: parsed.message || "import reported failure",
          exitCode: record.exitCode,
        },
        rawCommandsRun,
      };
    }

    return {
      probe: "x402",
      programmablePath: {
        status: "ok",
        exportsSample: parsed.keys,
        exitCode: record.exitCode,
        summary: "@x402/fetch install + import succeeded in temp project",
      },
      rawCommandsRun,
    };
  } finally {
    if (probeDir) {
      try {
        rmSync(probeDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

async function main() {
  const result = await runX402Probe();
  console.log(JSON.stringify(result, null, 2));
}

if (isExecutedDirectly(import.meta.url)) {
  await main();
}
