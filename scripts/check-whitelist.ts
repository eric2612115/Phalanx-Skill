/**
 * CLI: normalized whitelist check (JSON). Optional on-chain read when RPC + policy address are configured.
 * Optional `PHALANX_WHITELIST_CHECK_CMD` runs after viem path or alone when viem is not configured.
 */

import {
  buildWhitelistContractLiveConfig,
  checkWhitelist,
  checkWhitelistWithContract,
  interpolateWhitelistCheckArgv,
  pickWhitelistCheckShellCommand,
  summarizeWhitelistEnvCommandProbe,
} from "../src/adapters/whitelist-contract.js";

import { isExecutedDirectly, runProbeCommand } from "./probe-shared.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function wantLiveAttempt(argv: string[]): boolean {
  if (argv.includes("--live")) return true;
  if ((process.env.PHALANX_WHITELIST_LIVE ?? "").trim() === "1") return true;
  return false;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = process.argv.slice(2);
  const target = argv[0]?.trim();
  if (!target) {
    printJson({
      error: "missing_target",
      usage: "tsx scripts/check-whitelist.ts [--live] <target>",
      hints: {
        live:
          "With --live or PHALANX_WHITELIST_LIVE=1, merges on-chain read when WHITELIST_POLICY_ADDRESS and RPC env are set.",
        envCommand:
          "Optional PHALANX_WHITELIST_CHECK_CMD (argv template with {target}) runs as a secondary check in live mode.",
        static: "Without --live, only PHALANX_WHITELIST list semantics apply.",
      },
    });
    process.exitCode = 2;
    return;
  }

  if (wantLiveAttempt(flags)) {
    const liveConfig = buildWhitelistContractLiveConfig();
    const result = await checkWhitelistWithContract({ target });

    let envCommandCheck = undefined as ReturnType<typeof summarizeWhitelistEnvCommandProbe> | undefined;
    const cmdTpl = pickWhitelistCheckShellCommand();
    if (cmdTpl) {
      const argv = interpolateWhitelistCheckArgv([...cmdTpl], target);
      const [bin, ...args] = argv;
      if (bin) {
        const record = await runProbeCommand(bin, args, { timeoutMs: 120_000 });
        envCommandCheck = summarizeWhitelistEnvCommandProbe({
          argv: record.argv,
          ok: record.ok,
          exitCode: record.exitCode,
          stdout: record.stdout,
          stderr: record.stderr,
          spawnError: record.spawnError,
        });
      }
    }

    printJson({
      mode: "live_attempt",
      liveConfig,
      result,
      ...(envCommandCheck ? { envCommandCheck } : {}),
    });
    return;
  }

  const result = checkWhitelist({ target });
  printJson({
    mode: "static",
    liveConfig: buildWhitelistContractLiveConfig(),
    result,
  });
}

if (isExecutedDirectly(import.meta.url)) {
  await main();
}
