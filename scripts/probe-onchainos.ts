/**
 * Capability probe: onchainos CLI (wallet login + Base defi list).
 * Normalizes outcomes; does not throw when the binary is missing.
 */

import {
  isExecutedDirectly,
  runProbeCommand,
  trimProbeSummary,
  type ProbeCommandRecord,
  type ProbeProtocolDetection,
} from "./probe-shared.js";

export type OnchainosProbeResult = {
  probe: "onchainos";
  chain: string;
  walletLogin: {
    status: "ok" | "failed" | "tool_missing";
    supportedFlags: string[];
    exitCode?: number | null;
    summary?: string;
  };
  lendingProtocols: ProbeProtocolDetection[];
  lpProtocols: ProbeProtocolDetection[];
  rawCommandsRun: ProbeCommandRecord[];
};

const LENDING_HINTS = /\b(aave|compound|morpho|radiant|spark|euler|moonwell|seamless|extra|venus)\b/i;
const LP_HINTS =
  /\b(uniswap|pancakeswap|pancake|aerodrome|curve|sushiswap|velodrome|balancer|kyber|trader\s*joe)\b/i;

/** Extract long-style flags from CLI help text. */
export function extractSupportedFlags(helpText: string): string[] {
  const flags = new Set<string>();
  const re = /--([a-z][a-z0-9-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(helpText)) !== null) {
    flags.add(`--${m[1]}`);
  }
  return [...flags].sort();
}

export function classifyDefiLines(stdout: string): {
  lending: OnchainosProbeResult["lendingProtocols"];
  lp: OnchainosProbeResult["lpProtocols"];
} {
  const lending: OnchainosProbeResult["lendingProtocols"] = [];
  const lp: OnchainosProbeResult["lpProtocols"] = [];
  const seen = new Set<string>();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const lendingMatch = line.match(LENDING_HINTS);
    const lpMatch = line.match(LP_HINTS);

    if (lendingMatch) {
      const name = lendingMatch[1]!;
      const key = `l:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        lending.push({ name, source: "heuristic", line });
      }
    }
    if (lpMatch) {
      const name = lpMatch[1]!.replace(/\s+/g, "");
      const key = `p:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        lp.push({ name, source: "heuristic", line });
      }
    }
  }

  return { lending, lp };
}

function walletLoginSummary(record: ProbeCommandRecord): OnchainosProbeResult["walletLogin"] {
  if (record.spawnError?.code === "ENOENT") {
    return {
      status: "tool_missing",
      supportedFlags: [],
      summary: "onchainos binary not found on PATH",
    };
  }
  if (!record.ok) {
    return {
      status: "failed",
      supportedFlags: extractSupportedFlags(record.stdout + record.stderr),
      exitCode: record.exitCode,
      summary: trimProbeSummary(record.stderr || record.stdout || "wallet login --help failed"),
    };
  }
  return {
    status: "ok",
    supportedFlags: extractSupportedFlags(record.stdout),
    exitCode: record.exitCode,
    summary: "wallet login help available",
  };
}

function defiListSummary(
  record: ProbeCommandRecord,
): Pick<OnchainosProbeResult, "lendingProtocols" | "lpProtocols"> {
  if (record.spawnError?.code === "ENOENT" || !record.ok) {
    return { lendingProtocols: [], lpProtocols: [] };
  }
  const { lending, lp } = classifyDefiLines(record.stdout);
  return { lendingProtocols: lending, lpProtocols: lp };
}

const CHAIN = "base";

export async function runOnchainosProbe(): Promise<OnchainosProbeResult> {
  const rawCommandsRun: ProbeCommandRecord[] = [];

  const wallet = await runProbeCommand("onchainos", ["wallet", "login", "--help"]);
  rawCommandsRun.push(wallet);

  const defi = await runProbeCommand("onchainos", ["defi", "list", "--chain", CHAIN]);
  rawCommandsRun.push(defi);

  const walletLogin = walletLoginSummary(wallet);
  const { lendingProtocols, lpProtocols } = defiListSummary(defi);

  return {
    probe: "onchainos",
    chain: CHAIN,
    walletLogin,
    lendingProtocols,
    lpProtocols,
    rawCommandsRun,
  };
}

async function main() {
  const result = await runOnchainosProbe();
  console.log(JSON.stringify(result, null, 2));
}

if (isExecutedDirectly(import.meta.url)) {
  await main();
}
