import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigStore,
  buildRuntimeConfig,
  loadRuntimeConfigValues,
  summarizeRuntimeReadiness,
} from "../src/config/store";
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

  it("treats governance and owner execution keys as demo-only in live mode", () => {
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
    expect(summary.operatorMissing).not.toContain("POLICY_OWNER_KEY");
    expect(summary.operatorMissing).not.toContain("WHITELIST_POLICY_ADDRESS");
    expect(summary.demoMissing).toContain("POLICY_OWNER_KEY");
    expect(summary.demoMissing).toContain("WHITELIST_POLICY_ADDRESS");
  });

  it("reports all demo-only missing keys under the current live readiness contract", () => {
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
    expect(summary.missing).toContain("POLICY_OWNER_KEY");
    expect(summary.missing).toContain("WHITELIST_POLICY_ADDRESS");
    expect(summary.missing).toContain("PHALANX_OWNER_EVM_ADDRESS");
    expect(summary.missing).toContain("BASE_RPC_URL");
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

  it("requires an execution wallet signal for operatorReady in live mode", () => {
    const summary = summarizeRuntimeReadiness({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
    });

    expect(summary.operatorReady).toBe(false);
    expect(summary.operatorMissing).toContain("EXECUTION_WALLET_SIGNAL");
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
