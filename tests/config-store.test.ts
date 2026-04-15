import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigStore,
  buildRuntimeConfig,
  getTelegramAllowedUserId,
  hasExecutionWalletSignal,
  loadRuntimeConfigValues,
  normalizeFlowProfileId,
  requireTelegramAllowedUserIdForSyntheticSmoke,
  resolveFlowProfile,
  summarizeRuntimeReadiness,
} from "../src/config/store";
import { loadSkillBootstrapConfig } from "../src/config/runtime-config";
import { StrategyStore } from "../src/strategy/store";

afterEach(() => {
  // no shared mocks
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "phalanx-store-"));
}

describe("ConfigStore", () => {
  it("loads initial snapshot with version 1 and bumps version on reload", () => {
    const dir = tempDir();
    const path = join(dir, "config.env");
    writeFileSync(path, "FOO=bar\n# comment\nBAZ=qux\n", "utf8");

    const store = new ConfigStore(path);
    const s0 = store.getSnapshot();
    expect(s0.version).toBe(1);
    expect(s0.values.FOO).toBe("bar");
    expect(s0.values.BAZ).toBe("qux");

    writeFileSync(path, "FOO=updated\nBAZ=qux\n", "utf8");
    const s1 = store.reload();
    expect(s1.version).toBe(2);
    expect(s1.values.FOO).toBe("updated");
  });

  it("rejects updateValidated when validator fails and does not bump version", () => {
    const dir = tempDir();
    const path = join(dir, "config.env");
    writeFileSync(path, "X=1\n", "utf8");
    const store = new ConfigStore(path);

    expect(() =>
      store.updateValidated({ Y: "2" }, (full) => {
        if (full.Y !== undefined) return "Y is not allowed yet";
        return null;
      }),
    ).toThrow(/Y is not allowed yet/);

    expect(store.getSnapshot().version).toBe(1);
    expect(store.getSnapshot().values.Y).toBeUndefined();
  });

  it("applies updateValidated, persists atomically, and bumps version", () => {
    const dir = tempDir();
    const path = join(dir, "config.env");
    writeFileSync(path, "A=1\n", "utf8");
    const store = new ConfigStore(path);

    const next = store.updateValidated({ B: "2" }, () => null);
    expect(next.version).toBe(2);
    expect(next.values.A).toBe("1");
    expect(next.values.B).toBe("2");

    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("A=1");
    expect(raw).toContain("B=2");

    const store2 = new ConfigStore(path);
    expect(store2.getSnapshot().values.B).toBe("2");
  });

  it("summarizeRuntimeReadiness reports missing live config fields", () => {
    const summary = summarizeRuntimeReadiness({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "",
      OMRATE_API_KEY: "omrate-key",
    });

    expect(summary.mode).toBe("live");
    expect(summary.liveReady).toBe(false);
    expect(summary.missing).toContain("TELEGRAM_BOT_TOKEN");
    expect(summary.missing).toContain("OKX_API_KEY");
  });

  it("treats owner binding as the remaining demo-only key when static RPC defaults are available", () => {
    const summary = summarizeRuntimeReadiness({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
      AGENT_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
      OMRATE_API_KEY: "omrate-key",
      OMRATE_API_BASE_URL: "https://omrate.io/api",
      XLAYER_RPC_URL: "https://rpc.example",
    });

    expect(summary.operatorReady).toBe(true);
    expect(summary.demoReady).toBe(false);
    expect(summary.operatorMissing).not.toContain("PHALANX_OWNER_EVM_ADDRESS");
    expect(summary.demoMissing).toContain("PHALANX_OWNER_EVM_ADDRESS");
    expect(summary.demoMissing).not.toContain("BASE_RPC_URL");
  });

  it("reports only owner binding as missing when live defaults cover static RPC endpoints", () => {
    const summary = summarizeRuntimeReadiness({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
      AGENT_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
      OMRATE_API_KEY: "omrate-key",
      OMRATE_API_BASE_URL: "https://omrate.io/api",
      XLAYER_RPC_URL: "https://rpc.example",
    });

    expect(summary.liveReady).toBe(false);
    expect(summary.missing).toContain("PHALANX_OWNER_EVM_ADDRESS");
    expect(summary.missing).not.toContain("BASE_RPC_URL");
  });

  it("buildRuntimeConfig masks secrets in readiness summary", () => {
    const config = buildRuntimeConfig({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "123456:telegram-secret-token",
      TELEGRAM_ALLOWED_USER_ID: "42",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
      AGENT_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
      OMRATE_API_KEY: "omrate-key",
      OMRATE_API_BASE_URL: "https://omrate.io/api",
      XLAYER_RPC_URL: "https://rpc.example",
      POLICY_OWNER_KEY: "0xabc",
      WHITELIST_POLICY_ADDRESS: "0x123",
      PHALANX_OWNER_EVM_ADDRESS: "0x4444444444444444444444444444444444444444",
      BASE_RPC_URL: "https://base.example",
    });

    expect(config.readiness.liveReady).toBe(true);
    expect(config.readiness.masked.TELEGRAM_BOT_TOKEN).not.toContain("telegram-secret-token");
    expect(config.readiness.masked.OKX_API_SECRET).not.toContain("okx-secret");
    expect(config.telegram.allowedUserId).toBe("42");
    expect(config.owner.evmAddress).toBe("0x4444444444444444444444444444444444444444");
    expect(config.mode).toBe("live");
  });

  it("getTelegramAllowedUserId reads TELEGRAM_ALLOWED_USER_ID from merged values", () => {
    expect(getTelegramAllowedUserId({ TELEGRAM_ALLOWED_USER_ID: " 77 " })).toBe("77");
    expect(getTelegramAllowedUserId({})).toBeUndefined();
  });

  it("requireTelegramAllowedUserIdForSyntheticSmoke fails fast when id is absent", () => {
    expect(() => requireTelegramAllowedUserIdForSyntheticSmoke({})).toThrow(/TELEGRAM_ALLOWED_USER_ID/i);
    expect(() => requireTelegramAllowedUserIdForSyntheticSmoke({ TELEGRAM_ALLOWED_USER_ID: "" })).toThrow(
      /TELEGRAM_ALLOWED_USER_ID/i,
    );
  });

  it("requireTelegramAllowedUserIdForSyntheticSmoke returns trimmed id when set", () => {
    expect(requireTelegramAllowedUserIdForSyntheticSmoke({ TELEGRAM_ALLOWED_USER_ID: " 42 " })).toBe("42");
  });

  it("loadRuntimeConfigValues exposes TELEGRAM_ALLOWED_USER_ID from service.env when not in config.env or process", () => {
    const dir = tempDir();
    const configPath = join(dir, "config.env");
    const servicePath = join(dir, "service.env");
    writeFileSync(servicePath, "TELEGRAM_ALLOWED_USER_ID=from-service\n", "utf8");
    writeFileSync(configPath, "OTHER=x\n", "utf8");

    const merged = loadRuntimeConfigValues(configPath, {});
    expect(getTelegramAllowedUserId(merged)).toBe("from-service");
  });

  it("loadRuntimeConfigValues lets explicit process env override config.env file values", () => {
    const dir = tempDir();
    const path = join(dir, "config.env");
    writeFileSync(path, "PHALANX_RUNTIME_MODE=live\nTELEGRAM_BOT_TOKEN=file-token\n", "utf8");

    const merged = loadRuntimeConfigValues(path, {
      PHALANX_RUNTIME_MODE: "dry_run",
      TELEGRAM_BOT_TOKEN: "env-token",
      OTHER: "1",
    });

    expect(merged.PHALANX_RUNTIME_MODE).toBe("dry_run");
    expect(merged.TELEGRAM_BOT_TOKEN).toBe("env-token");
    expect(merged.OTHER).toBe("1");
  });

  it("loadSkillBootstrapConfig packages kernel startup paths without requiring Telegram ownership", () => {
    const dir = tempDir();
    const configPath = join(dir, "config.env");
    writeFileSync(
      configPath,
      "PHALANX_RUNTIME_MODE=live\nOKX_API_KEY=okx-key\nOKX_API_SECRET=okx-secret\nOKX_API_PASSPHRASE=okx-pass\n",
      "utf8",
    );

    const bootstrap = loadSkillBootstrapConfig(configPath, {});
    expect(bootstrap.configPath).toBe(configPath);
    expect(bootstrap.serviceConfigPath).toBe(join(dir, "service.env"));
    expect(bootstrap.runtimeStatePath).toBe(join(dir, "runtime-memory.json"));
    expect(bootstrap.values.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(bootstrap.runtimeConfig.telegram.botToken).toBeUndefined();
  });

  it("merges sibling service.env before config.env so user config stays authoritative", () => {
    const dir = tempDir();
    const configPath = join(dir, "config.env");
    const servicePath = join(dir, "service.env");
    writeFileSync(
      servicePath,
      "OMRATE_API_BASE_URL=https://service.example\nPHALANX_GUARDIAN_ENABLED=1\nWHITELIST_TARGETS=pool\n",
      "utf8",
    );
    writeFileSync(
      configPath,
      "OMRATE_API_KEY=user-omrate\nPHALANX_GUARDIAN_ENABLED=0\nTELEGRAM_BOT_TOKEN=file-token\n",
      "utf8",
    );

    const merged = loadRuntimeConfigValues(configPath, {
      TELEGRAM_BOT_TOKEN: "env-token",
    });

    expect(merged.OMRATE_API_BASE_URL).toBe("https://service.example");
    expect(merged.OMRATE_API_KEY).toBe("user-omrate");
    expect(merged.WHITELIST_TARGETS).toBe("pool");
    expect(merged.PHALANX_GUARDIAN_ENABLED).toBe("0");
    expect(merged.TELEGRAM_BOT_TOKEN).toBe("env-token");
  });

  it("buildRuntimeConfig accepts backend env aliases when primary keys are absent", () => {
    const config = buildRuntimeConfig({
      PHALANX_RUNTIME_MODE: "live",
      OKX_WEB3_API_KEY: "okx-web3-key",
      OKX_WEB3_API_SECRET: "okx-web3-secret",
      OKX_WEB3_API_PASSPHRASE: "okx-web3-pass",
      AGENT_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
      OMRATE_X402_API_BASE: "https://web3.okx.com",
      RPC_8453: "https://base.example",
      OMRATE_X402_BUYER_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    });

    expect(config.okx.apiKey).toBe("okx-web3-key");
    expect(config.okx.apiSecret).toBe("okx-web3-secret");
    expect(config.okx.apiPassphrase).toBe("okx-web3-pass");
    expect(config.omrate.baseUrl).toBe("https://web3.okx.com");
    expect(config.chain.baseRpcUrl).toBe("https://base.example");
    expect(config.wallet.testAddress).toBe("0x1111111111111111111111111111111111111111");
  });

  it("buildRuntimeConfig falls back to fixed OmRate, xLayer, and Base RPC defaults", () => {
    const config = buildRuntimeConfig({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
      AGENT_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    });

    expect(config.omrate.baseUrl).toBe("https://api.omrate.com");
    expect(config.chain.xlayerRpcUrl).toBe("https://rpc.xlayer.tech");
    expect(config.chain.baseRpcUrl).toBe("https://mainnet.base.org");
  });

  it("buildRuntimeConfig exposes the active wallet from the agentic wallet registry", () => {
    const config = buildRuntimeConfig({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
      OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
        activeProfileId: "profile-b",
        activeWalletId: "wallet-b2",
        profiles: [
          {
            profileId: "profile-a",
            email: "alpha@example.com",
            wallets: [{ walletId: "wallet-a1", address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
          },
          {
            profileId: "profile-b",
            email: "beta@example.com",
            wallets: [
              { walletId: "wallet-b1", address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
              { walletId: "wallet-b2", address: "0xcccccccccccccccccccccccccccccccccccccccc" },
            ],
          },
        ],
      }),
    });

    expect(config.wallet.activeProfileId).toBe("profile-b");
    expect(config.wallet.activeWalletId).toBe("wallet-b2");
    expect(config.wallet.activeAddress).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
    expect(config.wallet.activeProfileEmail).toBe("beta@example.com");
  });

  it("hasExecutionWalletSignal treats the active agentic wallet as a valid runtime signal", () => {
    expect(
      hasExecutionWalletSignal({
        PHALANX_RUNTIME_MODE: "live",
        OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
          profiles: [
            {
              profileId: "profile-a",
              email: "alpha@example.com",
              wallets: [{ walletId: "wallet-a1", address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
            },
          ],
        }),
      }),
    ).toBe(true);
  });

  it("buildRuntimeConfig can derive OmRate base URL from backend public URL when OmRate-specific keys are absent", () => {
    const config = buildRuntimeConfig({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
      AGENT_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
      AUTH_BACKEND_PUBLIC_URL: "http://127.0.0.1:8000",
    });

    expect(config.omrate.baseUrl).toBe("http://127.0.0.1:8000");
  });

  it("treats full OKX bootstrap as execution wallet baseline in live mode without explicit env address", () => {
    const values = {
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
    };
    expect(hasExecutionWalletSignal(values)).toBe(true);

    const summary = summarizeRuntimeReadiness(values);
    expect(summary.operatorReady).toBe(true);
    expect(summary.operatorMissing).not.toContain("EXECUTION_WALLET_SIGNAL");
  });

  it("still flags execution wallet baseline when live mode lacks OKX credentials and env wallet", () => {
    const summary = summarizeRuntimeReadiness({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
    });

    expect(summary.operatorReady).toBe(false);
    expect(summary.operatorMissing).toContain("EXECUTION_WALLET_SIGNAL");
  });

  describe("flow profile loading", () => {
    it("normalizes canonical and kebab-case profile ids deterministically", () => {
      expect(normalizeFlowProfileId(undefined)).toBe("allocation_mainline");
      expect(normalizeFlowProfileId("")).toBe("allocation_mainline");
      expect(normalizeFlowProfileId("  ALLOCATION_MAINLINE  ")).toBe("allocation_mainline");
      expect(normalizeFlowProfileId("allocation-mainline")).toBe("allocation_mainline");
      expect(normalizeFlowProfileId("deposit_only")).toBe("deposit_only");
      expect(normalizeFlowProfileId("deposit-only")).toBe("deposit_only");
      expect(normalizeFlowProfileId("roundtrip")).toBe("roundtrip");
      expect(normalizeFlowProfileId("rehearsal")).toBe("rehearsal");
    });

    it("maps unknown profile strings to allocation_mainline deterministically", () => {
      expect(normalizeFlowProfileId("unknown_demo")).toBe("allocation_mainline");
    });

    it("resolveFlowProfile reads PHALANX_FLOW_PROFILE from merged values", () => {
      expect(resolveFlowProfile({ PHALANX_FLOW_PROFILE: "rehearsal" })).toBe("rehearsal");
      expect(resolveFlowProfile({})).toBe("allocation_mainline");
    });

    it("keeps config.env authoritative over sibling service.env for PHALANX_FLOW_PROFILE", () => {
      const dir = tempDir();
      const configPath = join(dir, "config.env");
      const servicePath = join(dir, "service.env");
      writeFileSync(servicePath, "PHALANX_FLOW_PROFILE=rehearsal\n", "utf8");
      writeFileSync(configPath, "PHALANX_FLOW_PROFILE=deposit_only\n", "utf8");

      const merged = loadRuntimeConfigValues(configPath, {});
      expect(resolveFlowProfile(merged)).toBe("deposit_only");
    });

    it("exposes flow.profile on buildRuntimeConfig", () => {
      const cfg = buildRuntimeConfig({
        PHALANX_FLOW_PROFILE: "roundtrip",
        PHALANX_RUNTIME_MODE: "dry_run",
      });
      expect(cfg.flow.profile).toBe("roundtrip");
    });
  });
});

describe("StrategyStore", () => {
  function fixtureProfilesDir(): string {
    const dir = tempDir();
    const src = join(dirname(fileURLToPath(import.meta.url)), "..", "strategy-profiles");
    for (const name of ["conservative.json", "balanced.json", "aggressive.json"]) {
      copyFileSync(join(src, name), join(dir, name));
    }
    return dir;
  }

  it("readProfile reads validated snapshot from a temp copy without touching repo files", () => {
    const dir = fixtureProfilesDir();
    const store = new StrategyStore(dir);
    const p = store.readProfile("conservative");
    expect(p.profileId).toBe("conservative");
    expect(p.riskLevel).toBe("conservative");
    expect(Array.isArray(p.allowedProtocols)).toBe(true);
  });

  it("reloadProfile bumps version on each successful reload", () => {
    const dir = fixtureProfilesDir();
    const store = new StrategyStore(dir);
    const a = store.reloadProfile("balanced");
    expect(a.version).toBe(1);
    const b = store.reloadProfile("balanced");
    expect(b.version).toBe(2);
    expect(b.profile.profileId).toBe("balanced");
  });

  it("writeProfile persists validated JSON in temp dir only", () => {
    const dir = fixtureProfilesDir();
    const store = new StrategyStore(dir);
    const base = store.readProfile("aggressive");
    const next = { ...base, rebalanceThresholdBps: 999 };
    store.writeProfile("aggressive", next);

    const raw = JSON.parse(readFileSync(join(dir, "aggressive.json"), "utf8"));
    expect(raw.rebalanceThresholdBps).toBe(999);
  });

  it("markSensitivePending writes sidecar and commitPendingSensitive merges then clears", () => {
    const dir = fixtureProfilesDir();
    const store = new StrategyStore(dir);
    store.markSensitivePending("conservative", { rebalanceThresholdBps: 111 });

    expect(store.getPendingSensitive("conservative")).toEqual({ rebalanceThresholdBps: 111 });

    store.commitPendingSensitive("conservative");
    const p = store.readProfile("conservative");
    expect(p.rebalanceThresholdBps).toBe(111);
    expect(store.getPendingSensitive("conservative")).toBeNull();

    const pendingPath = join(dir, "conservative.pending.json");
    expect(() => readFileSync(pendingPath, "utf8")).toThrow();
  });

  it("discardPendingSensitive removes sidecar without merging", () => {
    const dir = fixtureProfilesDir();
    const store = new StrategyStore(dir);
    const before = store.readProfile("balanced");
    store.markSensitivePending("balanced", { rebalanceThresholdBps: 1 });
    store.discardPendingSensitive("balanced");
    const after = store.readProfile("balanced");
    expect(after.rebalanceThresholdBps).toBe(before.rebalanceThresholdBps);
    expect(store.getPendingSensitive("balanced")).toBeNull();
  });
});
