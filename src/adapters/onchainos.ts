/**
 * onchainos adapter (contract). Uses host binary when present; degrades without throwing.
 * Does not replace Docker review baselines for third-party installs.
 */

import { spawn } from "node:child_process";
import {
  executeExecutionPlan,
  type BroadcastResult,
  type ExecutionPlanStep,
} from "../execution/coordinator.js";

export type OnchainosCapabilityKind = "lending" | "lp";

export type OnchainosCapability = {
  kind: OnchainosCapabilityKind;
  name: string;
  source: "heuristic";
  line?: string;
};

export type ListCapabilitiesResult = {
  provider: "onchainos";
  status: "available" | "tool_missing" | "failed";
  chain: string;
  capabilities: OnchainosCapability[];
  summary: string;
  walletLoginFlags?: string[];
};

export type PortfolioPathContract = {
  provider: "onchainos";
  path: { type: "cli"; argvTemplate: string[] };
  summary: string;
  /** Points integrators at Docker review rather than silent host installs. */
  baseline: string;
};

type CmdRecord = {
  argv: string[];
  ok: boolean;
  exitCode: number | null;
  spawnError?: { code: string; message: string };
  stdout: string;
  stderr: string;
};

export type OnchainosPortfolioReadInput = {
  readonly address: string;
  readonly chains: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
};

export type OnchainosDefiPositionsInput = {
  readonly address: string;
  readonly chains: readonly string[];
  readonly chain?: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
};

export type OnchainosDefiPositionDetailInput = {
  readonly address: string;
  readonly chain: string;
  readonly platformId: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
};

export type OnchainosTxDetailInput = {
  readonly address: string;
  readonly chain: string;
  readonly txHash: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
};

export type OnchainosPortfolioReadResult = {
  readonly provider: "onchainos";
  readonly status: "completed" | "failed" | "tool_missing";
  readonly argv: string[];
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
};

export type OnchainosDefiPositionsResult = {
  readonly provider: "onchainos";
  readonly status: "completed" | "failed" | "tool_missing";
  readonly argv: string[];
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
};

export type OnchainosDefiPositionDetailResult = {
  readonly provider: "onchainos";
  readonly status: "completed" | "failed" | "tool_missing";
  readonly argv: string[];
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
};

export type OnchainosTxDetailResult = {
  readonly provider: "onchainos";
  readonly status: "completed" | "failed" | "tool_missing";
  readonly argv: string[];
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
};

export type OnchainosExecutionCommandInput =
  | {
      readonly kind: "lending_deposit";
      readonly investmentId: string;
      readonly address: string;
      readonly token: string;
      readonly amount: string;
      readonly chain: string;
    }
  | {
      readonly kind: "lending_withdraw";
      readonly investmentId: string;
      readonly address: string;
      readonly chain: string;
      readonly ratio?: string;
      readonly amount?: string;
      readonly slippage?: string;
      readonly tokenId?: string;
      readonly platformId?: string;
    };

export type OnchainosSwapExecutionCommandInput = {
  readonly fromTokenAddress: string;
  readonly toTokenAddress: string;
  readonly chain: string;
  readonly wallet: string;
  readonly amount?: string;
  readonly readableAmount?: string;
  readonly slippage?: string;
  readonly gasLevel?: "slow" | "average" | "fast";
  readonly swapMode?: "exactIn" | "exactOut";
};

export type OnchainosX402PaymentCommandInput = {
  readonly network: string;
  readonly amount: string;
  readonly payTo: string;
  readonly asset: string;
  readonly from?: string;
  readonly maxTimeoutSeconds?: number;
};

export type OnchainosExecutionCommand = {
  readonly argv: string[];
};

export type OnchainosDefiExecutionStep = {
  readonly callDataType: string;
  readonly from: string;
  readonly to: string;
  readonly serializedData: string;
  readonly value?: string;
};
export type OnchainosTxProgress = import("../execution/coordinator.js").TxProgress;

export type OnchainosX402PaymentResult = {
  readonly provider: "onchainos";
  readonly lane: "x402_payment";
  readonly status: "completed" | "failed" | "tool_missing";
  readonly argv: string[];
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
};

export type OnchainosSwapExecutionResult = {
  readonly provider: "onchainos";
  readonly lane: "swap_execute";
  readonly status: "completed" | "failed" | "tool_missing";
  readonly argv: string[];
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
};

export type OnchainosDefiExecutionResult = {
  readonly provider: "onchainos";
  readonly lane: "defi_execute";
  readonly status: "completed" | "failed" | "tool_missing";
  readonly argv: string[];
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
  readonly executedSteps?: readonly OnchainosDefiExecutionStep[];
  readonly txRefs?: readonly string[];
};

export type OnchainosRunCmdImpl = (
  command: string,
  args: string[],
  timeoutMs?: number,
  env?: NodeJS.ProcessEnv,
) => Promise<CmdRecord>;

export type ExecuteOnchainosDefiExecutionHooks = {
  readonly runCmdImpl?: OnchainosRunCmdImpl;
  readonly delayImpl?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
};

function toExecutionPlanSteps(steps: readonly OnchainosDefiExecutionStep[]): ExecutionPlanStep<OnchainosDefiExecutionStep>[] {
  return steps.map((step, index) => ({
    id: `${step.callDataType.toLowerCase()}-${index + 1}`,
    summary: step.callDataType,
    payload: step,
  }));
}

function trimSummary(summary: string, max = 240): string {
  const oneLine = summary.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

async function runCmd(
  command: string,
  args: string[],
  timeoutMs = 120_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CmdRecord> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        argv: [command, ...args],
        ok: false,
        exitCode: null,
        spawnError: { code: error.code ?? "UNKNOWN", message: error.message },
        stdout,
        stderr,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        argv: [command, ...args],
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

export function buildOnchainosRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): Pick<
  NodeJS.ProcessEnv,
  "OKX_API_KEY" | "OKX_API_SECRET" | "OKX_API_PASSPHRASE" | "OKX_SECRET_KEY" | "OKX_PASSPHRASE"
> {
  return {
    OKX_API_KEY: env.OKX_API_KEY,
    OKX_API_SECRET: env.OKX_API_SECRET,
    OKX_API_PASSPHRASE: env.OKX_API_PASSPHRASE,
    OKX_SECRET_KEY: env.OKX_SECRET_KEY ?? env.OKX_API_SECRET,
    OKX_PASSPHRASE: env.OKX_PASSPHRASE ?? env.OKX_API_PASSPHRASE,
  };
}

export function buildOnchainosExecutionCommand(
  input: OnchainosExecutionCommandInput,
): OnchainosExecutionCommand {
  switch (input.kind) {
    case "lending_deposit":
      return {
        argv: [
          "onchainos",
          "defi",
          "invest",
          "--investment-id",
          input.investmentId,
          "--address",
          input.address,
          "--token",
          input.token,
          "--amount",
          input.amount,
          "--chain",
          input.chain,
        ],
      };
    case "lending_withdraw": {
      const argv = [
        "onchainos",
        "defi",
        "withdraw",
        "--investment-id",
        input.investmentId,
        "--address",
        input.address,
        "--chain",
        input.chain,
      ];
      if (input.ratio) {
        argv.push("--ratio", input.ratio);
      }
      if (input.amount) {
        argv.push("--amount", input.amount);
      }
      if (input.slippage) {
        argv.push("--slippage", input.slippage);
      }
      if (input.tokenId) {
        argv.push("--token-id", input.tokenId);
      }
      if (input.platformId) {
        argv.push("--platform-id", input.platformId);
      }
      return { argv };
    }
  }
}

export function buildOnchainosDefiPositionsCommand(input: {
  readonly address: string;
  readonly chains: readonly string[];
  readonly chain?: string;
}): OnchainosExecutionCommand {
  const argv = [
    "onchainos",
    "defi",
    "positions",
    "--address",
    input.address,
    "--chains",
    input.chains.join(","),
  ];
  if (input.chain) {
    argv.push("--chain", input.chain);
  }
  return { argv };
}

export function buildOnchainosDefiPositionDetailCommand(input: {
  readonly address: string;
  readonly chain: string;
  readonly platformId: string;
}): OnchainosExecutionCommand {
  return {
    argv: [
      "onchainos",
      "defi",
      "position-detail",
      "--address",
      input.address,
      "--chain",
      input.chain,
      "--platform-id",
      input.platformId,
    ],
  };
}

export function buildOnchainosSwapExecutionCommand(
  input: OnchainosSwapExecutionCommandInput,
): OnchainosExecutionCommand {
  const argv = [
    "onchainos",
    "swap",
    "execute",
    "--from",
    input.fromTokenAddress,
    "--to",
    input.toTokenAddress,
    "--chain",
    input.chain,
    "--wallet",
    input.wallet,
  ];
  if (input.readableAmount) {
    argv.push("--readable-amount", input.readableAmount);
  } else if (input.amount) {
    argv.push("--amount", input.amount);
  }
  if (input.slippage) {
    argv.push("--slippage", input.slippage);
  }
  if (input.gasLevel) {
    argv.push("--gas-level", input.gasLevel);
  }
  if (input.swapMode) {
    argv.push("--swap-mode", input.swapMode);
  }
  return { argv };
}

export function buildOnchainosX402PaymentCommand(
  input: OnchainosX402PaymentCommandInput,
): OnchainosExecutionCommand {
  const argv = [
    "onchainos",
    "payment",
    "x402-pay",
    "--network",
    input.network,
    "--amount",
    input.amount,
    "--pay-to",
    input.payTo,
    "--asset",
    input.asset,
  ];
  if (input.from) {
    argv.push("--from", input.from);
  }
  if (input.maxTimeoutSeconds !== undefined) {
    argv.push("--max-timeout-seconds", String(input.maxTimeoutSeconds));
  }
  return { argv };
}

export function parseOnchainosDefiExecutionPlan(stdout: string): OnchainosDefiExecutionStep[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
    const list = Array.isArray(data.dataList) ? data.dataList : [];
    return list
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        callDataType: typeof item.callDataType === "string" ? item.callDataType : "UNKNOWN",
        from: typeof item.from === "string" ? item.from : "",
        to: typeof item.to === "string" ? item.to : "",
        serializedData: typeof item.serializedData === "string" ? item.serializedData : "",
        value: typeof item.value === "string" ? item.value : undefined,
      }))
      .filter((item) => item.from.length > 0 && item.to.length > 0 && item.serializedData.length > 0);
  } catch {
    return [];
  }
}

export function parseOnchainosContractCallTxHash(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {};
    return typeof data.txHash === "string" && data.txHash.length > 0 ? data.txHash : null;
  } catch {
    return null;
  }
}

export function parseOnchainosTxDetailStatus(stdout: string): OnchainosTxProgress | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const data = Array.isArray(root.data) ? root.data : [];
    const first =
      data.find((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) ?? null;
    if (!first) {
      return null;
    }
    const txHash = typeof first.txHash === "string" ? first.txHash : "";
    const txStatus = typeof first.txStatus === "string" ? first.txStatus : "";
    if (!txHash || !txStatus) {
      return null;
    }
    return {
      txHash,
      txStatus,
      failReason: typeof first.failReason === "string" ? first.failReason : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeOnchainosWalletChain(chain: string): string {
  const chainAliases: Record<string, string> = {
    ethereum: "1",
    mainnet: "1",
    base: "8453",
    arbitrum: "42161",
    polygon: "137",
    bsc: "56",
    xlayer: "196",
  };
  return chainAliases[chain.trim().toLowerCase()] ?? chain;
}

export function buildOnchainosContractCallCommand(input: {
  readonly chain: string;
  readonly from: string;
  readonly to: string;
  readonly inputData: string;
  readonly force?: boolean;
}): OnchainosExecutionCommand {
  const normalizedChain = normalizeOnchainosWalletChain(input.chain);
  const argv = [
    "onchainos",
    "wallet",
    "contract-call",
    "--to",
    input.to,
    "--chain",
    normalizedChain,
    "--input-data",
    input.inputData,
    "--from",
    input.from,
  ];
  if (input.force) {
    argv.push("--force");
  }
  return { argv };
}

export function buildOnchainosTxDetailCommand(input: {
  readonly address: string;
  readonly chain: string;
  readonly txHash: string;
}): OnchainosExecutionCommand {
  return {
    argv: [
      "onchainos",
      "wallet",
      "history",
      "--address",
      input.address,
      "--chain",
      normalizeOnchainosWalletChain(input.chain),
      "--tx-hash",
      input.txHash,
    ],
  };
}

function extractSupportedFlags(helpText: string): string[] {
  const flags = new Set<string>();
  const re = /--([a-z][a-z0-9-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(helpText)) !== null) {
    flags.add(`--${m[1]}`);
  }
  return [...flags].sort();
}

const LENDING_HINTS = /\b(aave|compound|morpho|radiant|spark|euler|moonwell|seamless|extra|venus)\b/i;
const LP_HINTS =
  /\b(uniswap|pancakeswap|pancake|aerodrome|curve|sushiswap|velodrome|balancer|kyber|trader\s*joe)\b/i;

function classifyDefiStdout(stdout: string): OnchainosCapability[] {
  const out: OnchainosCapability[] = [];
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
        out.push({ kind: "lending", name, source: "heuristic", line });
      }
    }
    if (lpMatch) {
      const name = lpMatch[1]!.replace(/\s+/g, "");
      const key = `p:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ kind: "lp", name, source: "heuristic", line });
      }
    }
  }

  return out;
}

/**
 * Best-effort capability listing aligned with probe-onchainos behavior.
 */
export async function listOnchainosCapabilities(chain = "base"): Promise<ListCapabilitiesResult> {
  const wallet = await runCmd("onchainos", ["wallet", "login", "--help"]);

  if (wallet.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      status: "tool_missing",
      chain,
      capabilities: [],
      summary: "onchainos binary not found on PATH",
    };
  }

  if (!wallet.ok) {
    return {
      provider: "onchainos",
      status: "failed",
      chain,
      capabilities: [],
      summary: trimSummary(wallet.stderr || wallet.stdout || "wallet login --help failed"),
      walletLoginFlags: extractSupportedFlags(wallet.stdout + wallet.stderr),
    };
  }

  const defi = await runCmd("onchainos", ["defi", "list", "--chain", chain]);
  const walletLoginFlags = extractSupportedFlags(wallet.stdout);

  if (defi.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      status: "tool_missing",
      chain,
      capabilities: [],
      summary: "onchainos disappeared between probe calls (unexpected ENOENT)",
      walletLoginFlags,
    };
  }

  if (!defi.ok) {
    return {
      provider: "onchainos",
      status: "failed",
      chain,
      capabilities: [],
      summary: trimSummary(
        defi.stderr || defi.stdout || "defi list failed; wallet login help only confirmed CLI presence",
      ),
      walletLoginFlags,
    };
  }

  const capabilities = classifyDefiStdout(defi.stdout);
  return {
    provider: "onchainos",
    status: "available",
    chain,
    capabilities,
    summary:
      capabilities.length > 0
        ? `Heuristic capabilities from onchainos defi list (${capabilities.length} items)`
        : "onchainos defi list succeeded; no heuristic protocol matches in output",
    walletLoginFlags,
  };
}

/**
 * Declarative portfolio access contract (argv template). Does not execute onchainos.
 */
export function portfolioPathContract(chain = "base"): PortfolioPathContract {
  return {
    provider: "onchainos",
    path: {
      type: "cli",
      argvTemplate: ["onchainos", "portfolio", "all-balances", "--address", "<address>", "--chains", chain],
    },
    summary:
      "Read-shaped portfolio balance template aligned with onchainos 2.x CLI; callers provide the wallet address.",
    baseline:
      "Validate installs and CLI behavior with Docker review scripts; host tooling may be absent by policy.",
  };
}

export async function readOnchainosPortfolio(
  input: OnchainosPortfolioReadInput,
): Promise<OnchainosPortfolioReadResult> {
  const argv = [
    "onchainos",
    "portfolio",
    "all-balances",
    "--address",
    input.address,
    "--chains",
    input.chains.join(","),
  ];
  const [command, ...args] = argv;
  const result = await runCmd(
    command,
    args,
    input.timeoutMs ?? 120_000,
    {
      ...process.env,
      ...(input.env ?? process.env),
      ...buildOnchainosRuntimeEnv(input.env ?? process.env),
    },
  );

  if (result.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      status: "tool_missing",
      argv,
      summary: "onchainos binary not found on PATH",
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!result.ok) {
    return {
      provider: "onchainos",
      status: "failed",
      argv,
      summary: trimSummary(result.stderr || result.stdout || "onchainos portfolio command failed"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  return {
    provider: "onchainos",
    status: "completed",
    argv,
    summary: "onchainos portfolio command completed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function readOnchainosDefiPositions(
  input: OnchainosDefiPositionsInput,
): Promise<OnchainosDefiPositionsResult> {
  const argv = buildOnchainosDefiPositionsCommand(input).argv;
  const [command, ...args] = argv;
  const result = await runCmd(command, args, input.timeoutMs ?? 120_000, {
    ...process.env,
    ...(input.env ?? process.env),
    ...buildOnchainosRuntimeEnv(input.env ?? process.env),
  });

  if (result.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      status: "tool_missing",
      argv,
      summary: "onchainos binary not found on PATH",
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!result.ok) {
    return {
      provider: "onchainos",
      status: "failed",
      argv,
      summary: trimSummary(result.stderr || result.stdout || "onchainos defi positions command failed"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  return {
    provider: "onchainos",
    status: "completed",
    argv,
    summary: "onchainos defi positions command completed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function readOnchainosDefiPositionDetail(
  input: OnchainosDefiPositionDetailInput,
): Promise<OnchainosDefiPositionDetailResult> {
  const argv = buildOnchainosDefiPositionDetailCommand(input).argv;
  const [command, ...args] = argv;
  const result = await runCmd(command, args, input.timeoutMs ?? 120_000, {
    ...process.env,
    ...(input.env ?? process.env),
    ...buildOnchainosRuntimeEnv(input.env ?? process.env),
  });

  if (result.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      status: "tool_missing",
      argv,
      summary: "onchainos binary not found on PATH",
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!result.ok) {
    return {
      provider: "onchainos",
      status: "failed",
      argv,
      summary: trimSummary(result.stderr || result.stdout || "onchainos defi position-detail command failed"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  return {
    provider: "onchainos",
    status: "completed",
    argv,
    summary: "onchainos defi position-detail command completed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function readOnchainosTxDetail(
  input: OnchainosTxDetailInput,
): Promise<OnchainosTxDetailResult> {
  const argv = buildOnchainosTxDetailCommand(input).argv;
  const [command, ...args] = argv;
  const result = await runCmd(
    command,
    args,
    input.timeoutMs ?? 120_000,
    {
      ...process.env,
      ...(input.env ?? process.env),
      ...buildOnchainosRuntimeEnv(input.env ?? process.env),
    },
  );

  if (result.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      status: "tool_missing",
      argv,
      summary: "onchainos binary not found on PATH",
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!result.ok) {
    return {
      provider: "onchainos",
      status: "failed",
      argv,
      summary: trimSummary(result.stderr || result.stdout || "onchainos tx detail command failed"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  return {
    provider: "onchainos",
    status: "completed",
    argv,
    summary: "onchainos tx detail command completed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function executeOnchainosX402Payment(
  input: OnchainosX402PaymentCommandInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OnchainosX402PaymentResult> {
  const command = buildOnchainosX402PaymentCommand(input);
  const [bin, ...args] = command.argv;
  const result = await runCmd(bin, args, 120_000, {
    ...env,
    ...buildOnchainosRuntimeEnv(env),
  });

  if (result.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      lane: "x402_payment",
      status: "tool_missing",
      argv: command.argv,
      summary: "onchainos binary not found on PATH",
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!result.ok) {
    return {
      provider: "onchainos",
      lane: "x402_payment",
      status: "failed",
      argv: command.argv,
      summary: trimSummary(result.stderr || result.stdout || "onchainos x402 payment failed"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  return {
    provider: "onchainos",
    lane: "x402_payment",
    status: "completed",
    argv: command.argv,
    summary: "onchainos x402 payment command completed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function executeOnchainosSwapExecution(
  input: OnchainosSwapExecutionCommandInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OnchainosSwapExecutionResult> {
  const command = buildOnchainosSwapExecutionCommand(input);
  const [bin, ...args] = command.argv;
  const result = await runCmd(bin, args, 120_000, {
    ...env,
    ...buildOnchainosRuntimeEnv(env),
  });

  if (result.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      lane: "swap_execute",
      status: "tool_missing",
      argv: command.argv,
      summary: "onchainos binary not found on PATH",
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!result.ok) {
    return {
      provider: "onchainos",
      lane: "swap_execute",
      status: "failed",
      argv: command.argv,
      summary: trimSummary(result.stderr || result.stdout || "onchainos swap execution failed"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  return {
    provider: "onchainos",
    lane: "swap_execute",
    status: "completed",
    argv: command.argv,
    summary: "onchainos swap execution command completed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function executeOnchainosDefiExecution(
  input: OnchainosExecutionCommandInput,
  env: NodeJS.ProcessEnv = process.env,
  hooks: ExecuteOnchainosDefiExecutionHooks = {},
): Promise<OnchainosDefiExecutionResult> {
  const run = hooks.runCmdImpl ?? runCmd;
  const command = buildOnchainosExecutionCommand(input);
  const [bin, ...args] = command.argv;
  const runtimeEnv = {
    ...env,
    ...buildOnchainosRuntimeEnv(env),
  };
  const result = await run(bin, args, 120_000, runtimeEnv);

  if (result.spawnError?.code === "ENOENT") {
    return {
      provider: "onchainos",
      lane: "defi_execute",
      status: "tool_missing",
      argv: command.argv,
      summary: "onchainos binary not found on PATH",
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  if (!result.ok) {
    return {
      provider: "onchainos",
      lane: "defi_execute",
      status: "failed",
      argv: command.argv,
      summary: trimSummary(result.stderr || result.stdout || "onchainos defi execution failed"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  const executedSteps = parseOnchainosDefiExecutionPlan(result.stdout);
  const planSteps = toExecutionPlanSteps(executedSteps);
  const coordinatorResult = await executeExecutionPlan(planSteps, {
    confirmationPolicy: {
      isSuccess: (progress) => progress.txStatus === "SUCCESS",
      isFailure: (progress) => progress.txStatus === "ERROR" || progress.txStatus === "FAILED",
      summarizeFailure: (progress) =>
        trimSummary(progress.failReason || `onchainos tx ${progress.txHash} failed with status ${progress.txStatus}`),
    },
    delayImpl: hooks.delayImpl,
    pollIntervalMs: hooks.pollIntervalMs,
    maxPollAttempts: hooks.maxPollAttempts,
    executeStep: async (
      step,
    ): Promise<BroadcastResult<OnchainosDefiExecutionStep> | { status: "failed" | "tool_missing"; summary: string; stdout?: string; stderr?: string; exitCode?: number | null }> => {
      const call = buildOnchainosContractCallCommand({
        chain: input.chain,
        from: step.payload.from,
        to: step.payload.to,
        inputData: step.payload.serializedData,
        force: true,
      });
      const [callBin, ...callArgs] = call.argv;
      const callResult = await run(callBin, callArgs, 120_000, runtimeEnv);
      if (callResult.spawnError?.code === "ENOENT") {
        return {
          status: "tool_missing",
          summary: "onchainos binary not found on PATH",
          stderr: callResult.stderr,
          exitCode: callResult.exitCode,
        };
      }
      if (!callResult.ok) {
        return {
          status: "failed",
          summary: trimSummary(callResult.stderr || callResult.stdout || "onchainos contract-call failed"),
          stdout: callResult.stdout,
          stderr: callResult.stderr,
          exitCode: callResult.exitCode,
        };
      }
      const txHash = parseOnchainosContractCallTxHash(callResult.stdout);
      if (!txHash) {
        return {
          status: "failed",
          summary: "onchainos contract-call did not return a txHash",
          stdout: callResult.stdout,
          stderr: callResult.stderr,
          exitCode: callResult.exitCode,
        };
      }
      return { step, txHash };
    },
    readProgress: async (broadcast) => {
      const detail = buildOnchainosTxDetailCommand({
        address: broadcast.step.payload.from,
        chain: input.chain,
        txHash: broadcast.txHash,
      });
      const [detailBin, ...detailArgs] = detail.argv;
      const detailResult = await run(detailBin, detailArgs, 120_000, runtimeEnv);
      if (detailResult.spawnError?.code === "ENOENT") {
        return {
          status: "tool_missing" as const,
          summary: "onchainos binary not found on PATH",
          stderr: detailResult.stderr,
          exitCode: detailResult.exitCode,
        };
      }
      if (!detailResult.ok) {
        return {
          status: "failed" as const,
          summary: trimSummary(detailResult.stderr || detailResult.stdout || "onchainos tx polling failed"),
          stdout: detailResult.stdout,
          stderr: detailResult.stderr,
          exitCode: detailResult.exitCode,
        };
      }
      return (
        parseOnchainosTxDetailStatus(detailResult.stdout) ?? {
          txHash: broadcast.txHash,
          txStatus: "PENDING",
        }
      );
    },
  });
  if (coordinatorResult.status !== "completed") {
    return {
      provider: "onchainos",
      lane: "defi_execute",
      status: coordinatorResult.status,
      argv: command.argv,
      summary: coordinatorResult.summary,
      stdout: coordinatorResult.stdout,
      stderr: coordinatorResult.stderr,
      exitCode: coordinatorResult.exitCode,
      executedSteps,
      txRefs: coordinatorResult.broadcasts.map((broadcast) => broadcast.txHash),
    };
  }

  return {
    provider: "onchainos",
    lane: "defi_execute",
    status: "completed",
    argv: command.argv,
    summary:
      executedSteps.length > 0
        ? `onchainos defi execution completed with ${executedSteps.length} contract-call step(s)`
        : "onchainos defi execution command completed",
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    executedSteps,
    txRefs: coordinatorResult.broadcasts.map((broadcast) => broadcast.txHash),
  };
}
