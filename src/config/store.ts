import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface ConfigSnapshot {
  readonly version: number;
  readonly loadedAt: number;
  readonly values: Readonly<Record<string, string>>;
}

export type ConfigValidator = (full: Readonly<Record<string, string>>) => string | null;

export type RuntimeMode = "dry_run" | "live";

export interface RuntimeReadinessSummary {
  readonly mode: RuntimeMode;
  /**
   * Legacy name: matches {@link demoReady} (full demo / execution prerequisites in live mode).
   * Prefer {@link operatorReady} and {@link demoReady} for install and operator UX.
   */
  readonly liveReady: boolean;
  /** Live: Telegram bot + OKX/onchainos credentials + execution wallet baseline. */
  readonly operatorReady: boolean;
  /** Live: operator tier plus governance, owner EVM binding, and Base RPC for mainline execution. */
  readonly demoReady: boolean;
  /** Keys still missing for demo-ready (strictest install checklist). */
  readonly missing: readonly string[];
  /** Keys missing for operator tier only. */
  readonly operatorMissing: readonly string[];
  /** Keys missing for demo tier (includes operator keys when absent). */
  readonly demoMissing: readonly string[];
  readonly masked: Readonly<Record<string, string>>;
}

export interface RuntimeConfig {
  readonly mode: RuntimeMode;
  readonly readiness: RuntimeReadinessSummary;
  readonly telegram: {
    readonly botToken?: string;
    readonly allowedUserId?: string;
  };
  readonly okx: {
    readonly apiKey?: string;
    readonly apiSecret?: string;
    readonly apiPassphrase?: string;
  };
  readonly omrate: {
    readonly apiKey?: string;
    readonly baseUrl?: string;
  };
  readonly chain: {
    readonly xlayerRpcUrl?: string;
    readonly baseRpcUrl?: string;
  };
  readonly whitelist: {
    readonly ownerKey?: string;
    readonly policyAddress?: string;
  };
  readonly owner: {
    readonly evmAddress?: string;
  };
  readonly wallet: {
    readonly testAddress?: string;
  };
}

/** Operator-facing OmRate HTTP entrypoint when the operator does not override env. */
const DEFAULT_OMRATE_API_BASE_URL = "https://api.omrate.com";

/** Official X Layer mainnet JSON-RPC (chain id 196) per OKX developer docs. */
const DEFAULT_XLAYER_RPC_URL = "https://rpc.xlayer.tech";

const OPERATOR_LIVE_REQUIRED_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
] as const;

const DEMO_LIVE_REQUIRED_KEYS = [
  "POLICY_OWNER_KEY",
  "WHITELIST_POLICY_ADDRESS",
  "PHALANX_OWNER_EVM_ADDRESS",
  "BASE_RPC_URL",
] as const;
const EXECUTION_WALLET_SIGNAL = "EXECUTION_WALLET_SIGNAL";

const SENSITIVE_KEY_HINTS = /(TOKEN|SECRET|PASSPHRASE|KEY|PRIVATE|PASSWORD)/i;

const CONFIG_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  OKX_API_KEY: ["OKX_WEB3_API_KEY", "OKX_X402_API_KEY"],
  OKX_API_SECRET: ["OKX_WEB3_API_SECRET", "OKX_X402_API_SECRET"],
  OKX_API_PASSPHRASE: ["OKX_WEB3_API_PASSPHRASE", "OKX_X402_API_PASSPHRASE"],
  OMRATE_API_BASE_URL: ["OMRATE_API_BASE", "OMRATE_X402_API_BASE", "AUTH_BACKEND_PUBLIC_URL"],
  BASE_RPC_URL: ["RPC_8453"],
  BSC_RPC_URL: ["RPC_56"],
  TEST_WALLET_ADDRESS: ["OMRATE_X402_BUYER_WALLET_ADDRESS", "OMRATE_WALLET_ADDRESS"],
  PHALANX_X402_PRIVATE_KEY: ["OMRATE_X402_BUYER_PRIVATE_KEY"],
  PHALANX_X402_NETWORK: ["OMRATE_X402_NETWORK"],
};

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadRuntimeConfigValues(
  filePath: string,
  baseEnv: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, string | undefined>> {
  try {
    const raw = readFileSync(filePath, "utf8");
    return {
      ...parseEnvFile(raw),
      ...baseEnv,
    };
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      return { ...baseEnv };
    }
    throw e;
  }
}

function serializeEnv(values: Record<string, string>): string {
  const keys = Object.keys(values).sort((a, b) => a.localeCompare(b));
  const lines = keys.map((k) => `${k}=${values[k]}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function atomicWriteFile(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

function normalizedRawValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizedValue(values: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  const direct = normalizedRawValue(values[key]);
  if (direct !== undefined) {
    return direct;
  }
  for (const alias of CONFIG_KEY_ALIASES[key] ?? []) {
    const viaAlias = normalizedRawValue(values[alias]);
    if (viaAlias !== undefined) {
      return viaAlias;
    }
  }
  return undefined;
}

/** Resolve a config key including documented env aliases (install/check tooling). */
export function getConfigEnvValue(
  values: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  return normalizedValue(values, key);
}

export function hasOkxBootstrapCredentials(values: Readonly<Record<string, string | undefined>>): boolean {
  return (
    normalizedValue(values, "OKX_API_KEY") !== undefined &&
    normalizedValue(values, "OKX_API_SECRET") !== undefined &&
    normalizedValue(values, "OKX_API_PASSPHRASE") !== undefined
  );
}

export function getExecutionWalletAddress(
  values: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return (
    normalizedRawValue(values.PHALANX_WALLET_ADDRESS) ??
    normalizedRawValue(values.AGENT_WALLET_ADDRESS) ??
    normalizedValue(values, "TEST_WALLET_ADDRESS")
  );
}

export function hasExecutionWalletSignal(values: Readonly<Record<string, string | undefined>>): boolean {
  return getExecutionWalletAddress(values) !== undefined;
}

export function normalizeRuntimeMode(value: string | undefined): RuntimeMode {
  return value?.trim().toLowerCase() === "live" ? "live" : "dry_run";
}

function maskValue(key: string, value: string | undefined): string {
  if (!value) {
    return "";
  }
  if (!SENSITIVE_KEY_HINTS.test(key)) {
    return value;
  }
  if (value.length <= 4) {
    return "[set]";
  }
  return `${"*".repeat(Math.max(3, value.length - 4))}${value.slice(-4)}`;
}

export function summarizeRuntimeReadiness(
  values: Readonly<Record<string, string | undefined>>,
): RuntimeReadinessSummary {
  const mode = normalizeRuntimeMode(values.PHALANX_RUNTIME_MODE);

  const operatorMissing: string[] =
    mode === "live" ? OPERATOR_LIVE_REQUIRED_KEYS.filter((key) => normalizedValue(values, key) === undefined) : [];
  if (mode === "live" && !hasExecutionWalletSignal(values)) {
    operatorMissing.push(EXECUTION_WALLET_SIGNAL);
  }

  const demoOnlyMissing =
    mode === "live"
      ? DEMO_LIVE_REQUIRED_KEYS.filter((key) => normalizedValue(values, key) === undefined)
      : [];

  const demoMissing = [...operatorMissing, ...demoOnlyMissing];
  const operatorReady = mode !== "live" || operatorMissing.length === 0;
  const demoReady = mode !== "live" || demoMissing.length === 0;

  const maskedKeys = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_ALLOWED_USER_ID",
    "OKX_API_KEY",
    "OKX_API_SECRET",
    "OKX_API_PASSPHRASE",
    "OMRATE_API_KEY",
    "OMRATE_API_BASE_URL",
    "XLAYER_RPC_URL",
    "BASE_RPC_URL",
    "POLICY_OWNER_KEY",
    "WHITELIST_POLICY_ADDRESS",
    "PHALANX_X402_PRIVATE_KEY",
    "TEST_WALLET_ADDRESS",
  ] as const;

  const masked = Object.fromEntries(
    maskedKeys
      .map((key) => [key, maskValue(key, normalizedValue(values, key))] as const)
      .filter(([, value]) => value.length > 0),
  );

  return {
    mode,
    liveReady: demoReady,
    operatorReady,
    demoReady,
    missing: demoMissing,
    operatorMissing,
    demoMissing,
    masked,
  };
}

export function buildRuntimeConfig(values: Readonly<Record<string, string | undefined>>): RuntimeConfig {
  const readiness = summarizeRuntimeReadiness(values);
  return {
    mode: readiness.mode,
    readiness,
    telegram: {
      botToken: normalizedValue(values, "TELEGRAM_BOT_TOKEN"),
      allowedUserId: normalizedValue(values, "TELEGRAM_ALLOWED_USER_ID"),
    },
    okx: {
      apiKey: normalizedValue(values, "OKX_API_KEY"),
      apiSecret: normalizedValue(values, "OKX_API_SECRET"),
      apiPassphrase: normalizedValue(values, "OKX_API_PASSPHRASE"),
    },
    omrate: {
      apiKey: normalizedValue(values, "OMRATE_API_KEY"),
      baseUrl: normalizedValue(values, "OMRATE_API_BASE_URL") ?? DEFAULT_OMRATE_API_BASE_URL,
    },
    chain: {
      xlayerRpcUrl: normalizedValue(values, "XLAYER_RPC_URL") ?? DEFAULT_XLAYER_RPC_URL,
      baseRpcUrl: normalizedValue(values, "BASE_RPC_URL"),
    },
    whitelist: {
      ownerKey: normalizedValue(values, "POLICY_OWNER_KEY"),
      policyAddress: normalizedValue(values, "WHITELIST_POLICY_ADDRESS"),
    },
    owner: {
      evmAddress: normalizedValue(values, "PHALANX_OWNER_EVM_ADDRESS"),
    },
    wallet: {
      testAddress: normalizedValue(values, "TEST_WALLET_ADDRESS"),
    },
  };
}

export class ConfigStore {
  private version = 0;
  private loadedAt = 0;
  private values: Record<string, string> = {};

  constructor(private readonly filePath: string) {
    this.loadFromDisk();
    this.version = 1;
    this.loadedAt = Date.now();
  }

  getSnapshot(): ConfigSnapshot {
    return this.freezeSnapshot();
  }

  reload(): ConfigSnapshot {
    this.loadFromDisk();
    this.version += 1;
    this.loadedAt = Date.now();
    return this.freezeSnapshot();
  }

  updateValidated(patch: Record<string, string>, validate: ConfigValidator): ConfigSnapshot {
    const merged: Record<string, string> = { ...this.values, ...patch };
    const err = validate(merged);
    if (err !== null) {
      throw new Error(err);
    }
    this.values = merged;
    atomicWriteFile(this.filePath, serializeEnv(this.values));
    this.version += 1;
    this.loadedAt = Date.now();
    return this.freezeSnapshot();
  }

  private loadFromDisk(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      this.values = parseEnvFile(raw);
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") {
        this.values = {};
        return;
      }
      throw e;
    }
  }

  private freezeSnapshot(): ConfigSnapshot {
    return {
      version: this.version,
      loadedAt: this.loadedAt,
      values: { ...this.values },
    };
  }
}
