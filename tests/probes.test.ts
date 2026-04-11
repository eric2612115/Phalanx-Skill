import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  classifyDefiLines,
  extractSupportedFlags,
  runOnchainosProbe,
} from "../scripts/probe-onchainos.ts";
import { parseX402ProbeStdout, runX402Probe } from "../scripts/probe-x402.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("capability probes", () => {
  it("extracts long flags from help text", () => {
    expect(extractSupportedFlags("  --foo-bar  --baz \n")).toEqual(["--baz", "--foo-bar"]);
  });

  it("classifies defi list lines into lending and lp buckets with heuristic source labels", () => {
    const { lending, lp } = classifyDefiLines(
      "Aave v3 Pool\nUniswap V3 Router\nCurve pool\nno match here",
    );
    expect(lending.some((x) => /aave/i.test(x.name))).toBe(true);
    expect(lending.every((x) => x.source === "heuristic")).toBe(true);
    expect(lp.some((x) => /uniswap/i.test(x.name))).toBe(true);
    expect(lp.some((x) => /curve/i.test(x.name))).toBe(true);
    expect(lp.every((x) => x.source === "heuristic")).toBe(true);
  });

  it("uses the shared probe command runner to capture cwd and normalized output", async () => {
    const { runProbeCommand } = await import("../scripts/probe-shared.ts");
    const result = await runProbeCommand(process.execPath, ["-e", "console.log('shared-helper-ok')"], {
      cwd: root,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(result.cwd).toBe(root);
    expect(result.stdout).toContain("shared-helper-ok");
  });

  it("normalizes onchainos probe results", async () => {
    const result = await runOnchainosProbe();
    expect(result).toHaveProperty("walletLogin");
    expect(result).toHaveProperty("lendingProtocols");
    expect(result).toHaveProperty("lpProtocols");
    expect(result).toHaveProperty("rawCommandsRun");
    expect(Array.isArray(result.rawCommandsRun)).toBe(true);
    expect(result.rawCommandsRun.length).toBe(2);
    expect(result.rawCommandsRun[0]?.argv.join(" ")).toContain("wallet login");
    expect(result.rawCommandsRun[1]?.argv.join(" ")).toContain("defi");
  });

  it(
    "normalizes x402 probe results via a real temp-project install/import path",
    async () => {
      const result = await runX402Probe();
      expect(result).toHaveProperty("programmablePath");
      expect(result).toHaveProperty("rawCommandsRun");
      expect(["ok", "failed", "tool_missing"]).toContain(result.programmablePath.status);
      expect(Array.isArray(result.rawCommandsRun)).toBe(true);
      expect(result.rawCommandsRun.length).toBeGreaterThanOrEqual(1);
      if (result.programmablePath.status === "ok") {
        expect(result.rawCommandsRun.length).toBe(2);
      }
    },
    180_000,
  );

  it("parses x402 probe subprocess json line", () => {
    expect(parseX402ProbeStdout('noise\n{"ok":true,"keys":["wrapFetchWithPayment"]}\n')).toEqual({
      ok: true,
      keys: ["wrapFetchWithPayment"],
    });
  });
});
