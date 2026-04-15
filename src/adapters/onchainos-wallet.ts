function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function normalizeOnchainosWalletChain(chain: string): string {
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

function normalizeParsedWalletChainKey(value: string | number | undefined): string | undefined {
  if (typeof value === "number") {
    return normalizeOnchainosWalletChain(String(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? normalizeOnchainosWalletChain(trimmed) : undefined;
  }
  return undefined;
}

function recordChainAddress(
  chainKey: string | undefined,
  address: string | undefined,
  byChain: Map<string, string>,
): void {
  if (!chainKey || !address || !isEvmAddress(address)) {
    return;
  }
  const normalizedKey = normalizeParsedWalletChainKey(chainKey);
  if (!normalizedKey) {
    return;
  }
  if (!byChain.has(normalizedKey)) {
    byChain.set(normalizedKey, address.trim());
  }
}

function walkForChainIndexedAddresses(value: unknown, byChain: Map<string, string>): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkForChainIndexedAddresses(item, byChain);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  const chainRaw = record.chainIndex ?? record.chainId ?? record.chain_id;
  const addrRaw = record.address ?? record.evmAddress ?? record.walletAddress ?? record.accountAddress;
  const chainKey = normalizeParsedWalletChainKey(
    typeof chainRaw === "number" || typeof chainRaw === "string" ? chainRaw : undefined,
  );
  const address = typeof addrRaw === "string" ? addrRaw.trim() : undefined;
  recordChainAddress(chainKey, address, byChain);
  for (const child of Object.values(record)) {
    walkForChainIndexedAddresses(child, byChain);
  }
}

/**
 * Parses `onchainos wallet addresses` JSON stdout and returns the EVM address for the requested chain.
 * Accepts common `ok/data` CLI shapes and nested `chainIndex` + `address` pairs.
 */
export function parseOnchainosWalletAddressesStdout(stdout: string, chain: string): string | null {
  const targetChainId = normalizeOnchainosWalletChain(chain);
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const data = root.data;
    const byChain = new Map<string, string>();
    walkForChainIndexedAddresses(data, byChain);
    const exactMatch = byChain.get(targetChainId);
    if (exactMatch) {
      return exactMatch;
    }
    const direct =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    let directAddress: string | null = null;
    if (direct) {
      for (const key of ["evmAddress", "address", "walletAddress", "accountAddress"] as const) {
        const raw = direct[key];
        if (typeof raw === "string" && isEvmAddress(raw)) {
          directAddress = raw.trim();
          break;
        }
      }
    }
    if (byChain.size === 1) {
      return [...byChain.values()][0] ?? null;
    }
    return directAddress;
  } catch {
    return null;
  }
}
