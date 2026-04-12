/**
 * Normalized on-chain / protocol allowlist checks (application boundary).
 * Static list checks are synchronous; optional viem contract reads degrade without credentials.
 */

import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type WhitelistCheckInput = {
  target: string;
  /** When omitted, reads PHALANX_WHITELIST (comma-separated) from env. */
  allowlist?: string[];
};

export type WhitelistCheckResult = {
  target: string;
  allowed: boolean;
  canExecute: boolean;
  reason: string;
};

/** Default view ABI: isAllowed(address) — override with PHALANX_WHITELIST_CONTRACT_ABI JSON. */
export const DEFAULT_WHITELIST_CONTRACT_ABI = [
  {
    type: "function",
    name: "isAllowed",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

const DEFAULT_WHITELIST_WRITE_ABI = [
  ...DEFAULT_WHITELIST_CONTRACT_ABI,
  {
    type: "function",
    name: "setAllowed",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export type WhitelistContractLiveConfig = {
  readonly rpcUrl: string;
  readonly policyAddress: Address;
  readonly abi: Abi;
  readonly functionName: "isAllowed" | "isWhitelisted";
};

export type WhitelistContractWriteConfig = {
  readonly rpcUrl: string;
  readonly policyAddress: Address;
  readonly ownerKey: Hex;
  readonly abi: Abi;
  readonly functionName: "setAllowed" | "setWhitelisted";
};

export type WhitelistContractLiveConfigResult =
  | { readonly ready: true; readonly config: WhitelistContractLiveConfig }
  | { readonly ready: false; readonly reason: string };

export type WhitelistContractReadResult = {
  readonly status: "not_configured" | "invalid_target" | "rpc_error" | "read_error" | "ok";
  readonly contractAllowed?: boolean;
  readonly summary: string;
};

export type WhitelistContractWriteResult = {
  readonly status: "not_configured" | "invalid_target" | "failed" | "completed";
  readonly summary: string;
  readonly txHash?: string;
};

export type WhitelistLiveCheckResult = WhitelistCheckResult & {
  readonly contract?: WhitelistContractReadResult;
  readonly combinedReason: string;
};

function trimSummary(s: string, max = 280): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max)}…`;
}

/**
 * Parse a shell-like command string into argv (supports single/double quotes).
 * Shared by whitelist check / deploy env hooks.
 */
export function parseShellCommandWords(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) parts.push(current);
  return parts.length > 0 ? parts : null;
}

/** Optional cast/curl/etc. hook: `PHALANX_WHITELIST_CHECK_CMD` with `{target}` tokens in args. */
export function pickWhitelistCheckShellCommand(env: NodeJS.ProcessEnv = process.env): string[] | null {
  return parseShellCommandWords(env.PHALANX_WHITELIST_CHECK_CMD);
}

export function interpolateWhitelistCheckArgv(argv: string[], target: string): string[] {
  return argv.map((a) => a.replaceAll("{target}", target).replaceAll("$TARGET", target));
}

export type WhitelistEnvCommandCheckResult = {
  readonly status: "skipped" | "completed" | "failed" | "tool_missing";
  readonly summary: string;
  readonly argv?: readonly string[];
  readonly exitCode?: number | null;
  readonly stdoutPreview?: string;
};

/**
 * Normalize a completed subprocess record for JSON CLI output (no spawn here).
 */
export function summarizeWhitelistEnvCommandProbe(input: {
  readonly argv: readonly string[];
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError?: { code: string; message: string };
}): WhitelistEnvCommandCheckResult {
  if (input.spawnError?.code === "ENOENT") {
    return {
      status: "tool_missing",
      summary: `whitelist_check_binary_missing:${input.argv[0] ?? "unknown"}`,
      argv: input.argv,
    };
  }
  if (!input.ok) {
    const msg = (input.stderr || input.stdout || "command_failed").replace(/\s+/g, " ").trim();
    return {
      status: "failed",
      summary: trimSummary(msg),
      argv: input.argv,
      exitCode: input.exitCode,
      stdoutPreview: trimSummary(input.stdout, 400) || undefined,
    };
  }
  return {
    status: "completed",
    summary: "whitelist_check_env_command_exited_zero",
    argv: input.argv,
    exitCode: input.exitCode,
    stdoutPreview: trimSummary(input.stdout, 400) || undefined,
  };
}

export function parseAllowlistFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PHALANX_WHITELIST ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve RPC for whitelist reads: dedicated URL first, then shared chain RPCs from config store naming.
 */
export function pickWhitelistRpcUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct =
    (env.PHALANX_WHITELIST_RPC_URL ?? env.WHITELIST_RPC_URL ?? "").trim() ||
    (env.BASE_RPC_URL ?? "").trim() ||
    (env.XLAYER_RPC_URL ?? "").trim();
  return direct.length > 0 ? direct : undefined;
}

export function pickWhitelistPolicyAddress(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const a = (env.WHITELIST_POLICY_ADDRESS ?? env.PHALANX_WHITELIST_CONTRACT_ADDRESS ?? "").trim();
  return a.length > 0 ? a : undefined;
}

function parseAbiFromEnv(env: NodeJS.ProcessEnv): Abi {
  const raw = (env.PHALANX_WHITELIST_CONTRACT_ABI ?? "").trim();
  if (!raw) {
    return DEFAULT_WHITELIST_CONTRACT_ABI as unknown as Abi;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_WHITELIST_CONTRACT_ABI as unknown as Abi;
    }
    return parsed as Abi;
  } catch {
    return DEFAULT_WHITELIST_CONTRACT_ABI as unknown as Abi;
  }
}

function parseWriteAbiFromEnv(env: NodeJS.ProcessEnv): Abi {
  const raw = (env.PHALANX_WHITELIST_WRITE_ABI ?? env.PHALANX_WHITELIST_CONTRACT_ABI ?? "").trim();
  if (!raw) {
    return DEFAULT_WHITELIST_WRITE_ABI as unknown as Abi;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_WHITELIST_WRITE_ABI as unknown as Abi;
    }
    return parsed as Abi;
  } catch {
    return DEFAULT_WHITELIST_WRITE_ABI as unknown as Abi;
  }
}

function pickViewFunctionName(
  abi: Abi,
  preferred: "isAllowed" | "isWhitelisted",
  env: NodeJS.ProcessEnv,
): "isAllowed" | "isWhitelisted" {
  const names = new Set(
    abi
      .filter((item) => item.type === "function")
      .map((item) => ("name" in item ? item.name : undefined))
      .filter((n): n is string => Boolean(n)),
  );
  const override = (env.PHALANX_WHITELIST_READ_FN ?? "").trim() as "isAllowed" | "isWhitelisted" | "";
  if (override === "isAllowed" || override === "isWhitelisted") {
    if (names.has(override)) return override;
  }
  if (names.has(preferred)) return preferred;
  if (names.has("isAllowed")) return "isAllowed";
  if (names.has("isWhitelisted")) return "isWhitelisted";
  return preferred;
}

/**
 * Build viem-ready live config when RPC URL and policy contract address are present and valid.
 */
export function buildWhitelistContractLiveConfig(
  env: NodeJS.ProcessEnv = process.env,
): WhitelistContractLiveConfigResult {
  const rpcUrl = pickWhitelistRpcUrl(env);
  const addrRaw = pickWhitelistPolicyAddress(env);
  if (!rpcUrl) {
    return { ready: false, reason: "no_rpc_url" };
  }
  if (!addrRaw) {
    return { ready: false, reason: "no_policy_address" };
  }
  if (!isAddress(addrRaw)) {
    return { ready: false, reason: "invalid_policy_address" };
  }
  const abi = parseAbiFromEnv(env);
  const functionName = pickViewFunctionName(abi, "isAllowed", env);
  return {
    ready: true,
    config: {
      rpcUrl,
      policyAddress: addrRaw as Address,
      abi,
      functionName,
    },
  };
}

export function buildWhitelistContractWriteConfig(
  env: NodeJS.ProcessEnv = process.env,
):
  | { readonly ready: true; readonly config: WhitelistContractWriteConfig }
  | { readonly ready: false; readonly reason: string } {
  const rpcUrl = pickWhitelistRpcUrl(env);
  const addrRaw = pickWhitelistPolicyAddress(env);
  const ownerKey = (env.POLICY_OWNER_KEY ?? "").trim();
  if (!rpcUrl) {
    return { ready: false, reason: "no_rpc_url" };
  }
  if (!addrRaw) {
    return { ready: false, reason: "no_policy_address" };
  }
  if (!isAddress(addrRaw)) {
    return { ready: false, reason: "invalid_policy_address" };
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(ownerKey)) {
    return { ready: false, reason: "invalid_policy_owner_key" };
  }
  const abi = parseWriteAbiFromEnv(env);
  const functionName = ((env.PHALANX_WHITELIST_WRITE_FN ?? "").trim() as
    | "setAllowed"
    | "setWhitelisted"
    | "") || "setAllowed";
  return {
    ready: true,
    config: {
      rpcUrl,
      policyAddress: addrRaw as Address,
      ownerKey: ownerKey as Hex,
      abi,
      functionName,
    },
  };
}

export function checkWhitelist(
  input: WhitelistCheckInput,
  env: NodeJS.ProcessEnv = process.env,
): WhitelistCheckResult {
  const target = input.target.trim();
  if (target.length === 0) {
    return {
      target,
      allowed: false,
      canExecute: false,
      reason: "empty_target",
    };
  }

  const list = input.allowlist ?? parseAllowlistFromEnv(env);
  if (list.length === 0) {
    return {
      target,
      allowed: true,
      canExecute: true,
      reason: "no_allowlist_configured_permissive",
    };
  }

  const allowed = list.includes(target);
  return {
    target,
    allowed,
    canExecute: allowed,
    reason: allowed ? "target_in_allowlist" : "target_not_in_allowlist",
  };
}

/**
 * Best-effort on-chain allow flag via viem. Does not throw; returns structured status.
 */
export async function readWhitelistContractAllowance(
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WhitelistContractReadResult> {
  const trimmed = target.trim();
  if (!trimmed) {
    return { status: "invalid_target", summary: "empty_target" };
  }
  if (!isAddress(trimmed)) {
    return { status: "invalid_target", summary: "target_is_not_an_evm_address" };
  }

  const built = buildWhitelistContractLiveConfig(env);
  if (!built.ready) {
    return {
      status: "not_configured",
      summary: `contract_read_skipped:${built.reason}`,
    };
  }

  const { rpcUrl, policyAddress, abi, functionName } = built.config;
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const contractAllowed = (await client.readContract({
      address: policyAddress,
      abi,
      functionName,
      args: [trimmed as Address],
    })) as boolean;

    return {
      status: "ok",
      contractAllowed,
      summary: contractAllowed ? "contract_reports_allowed" : "contract_reports_denied",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    const status = /fetch|network|timeout|econn|socket/i.test(lower) ? "rpc_error" : "read_error";
    return {
      status,
      summary: trimSummary(msg),
    };
  }
}

/**
 * List check plus optional contract gate. When live config is absent, behaves like `checkWhitelist` only.
 * When configured, requires both list pass (if list non-empty) and contract allow (when read succeeds).
 */
export async function checkWhitelistWithContract(
  input: WhitelistCheckInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WhitelistLiveCheckResult> {
  const base = checkWhitelist(input, env);
  const built = buildWhitelistContractLiveConfig(env);
  if (!built.ready) {
    return {
      ...base,
      combinedReason: base.reason,
    };
  }

  const contract = await readWhitelistContractAllowance(input.target.trim(), env);
  if (contract.status === "not_configured" || contract.status === "invalid_target") {
    return { ...base, contract, combinedReason: base.reason };
  }
  if (contract.status !== "ok" || contract.contractAllowed === undefined) {
    return {
      ...base,
      allowed: false,
      canExecute: false,
      reason: "contract_read_blocked",
      contract,
      combinedReason: `contract:${contract.status}:${contract.summary}`,
    };
  }

  const list = input.allowlist ?? parseAllowlistFromEnv(env);
  const listOk = list.length === 0 || base.allowed;
  const allowed = listOk && contract.contractAllowed;
  return {
    target: base.target,
    allowed,
    canExecute: allowed,
    reason: allowed ? "list_and_contract_allow" : listOk ? "contract_denied" : "list_denied",
    contract,
    combinedReason: allowed ? "ok" : !listOk ? base.reason : "contract_denied",
  };
}

export async function writeWhitelistContractAllowance(
  target: string,
  allowed: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WhitelistContractWriteResult> {
  const trimmed = target.trim();
  if (!trimmed || !isAddress(trimmed)) {
    return { status: "invalid_target", summary: "target_is_not_an_evm_address" };
  }

  const built = buildWhitelistContractWriteConfig(env);
  if (!built.ready) {
    return { status: "not_configured", summary: built.reason };
  }

  const { rpcUrl, policyAddress, ownerKey, abi, functionName } = built.config;
  try {
    const account = privateKeyToAccount(ownerKey);
    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    });
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    const txHash = await walletClient.writeContract({
      account,
      chain: undefined,
      address: policyAddress,
      abi,
      functionName,
      args: [trimmed as Address, allowed],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return {
        status: "failed",
        summary: `whitelist_contract_write_reverted:${txHash}`,
        txHash,
      };
    }
    return {
      status: "completed",
      summary: "whitelist_contract_write_confirmed",
      txHash,
    };
  } catch (error) {
    return {
      status: "failed",
      summary: trimSummary(error instanceof Error ? error.message : String(error)),
    };
  }
}
