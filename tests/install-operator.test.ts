import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatOperatorInitReport } from "../src/install/formatters";
import { initExitCode, runOperatorInit } from "../src/install/operator-init";
import { buildRuntimeConfig, summarizeRuntimeReadiness } from "../src/config/store";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const exampleSource = join(repoRoot, "config.env.example");

/** Minimal live env for operator tier: Telegram + OKX + execution wallet. */
function baseOperatorLiveEnv(): Record<string, string | undefined> {
  return {
    PHALANX_RUNTIME_MODE: "live",
    TELEGRAM_BOT_TOKEN: "123456:telegram-token",
    OKX_API_KEY: "okx-key",
    OKX_API_SECRET: "okx-secret",
    OKX_API_PASSPHRASE: "okx-pass",
    AGENT_WALLET_ADDRESS: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
}

describe("install operator readiness contract", () => {
  it("uses a packaged npm start entrypoint for long-running runtime startup", () => {
    const raw = readFileSync(join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.start).toMatch(/start-runtime|src\/index/);
  });

  it("treats OMRATE_API_KEY as optional for operator_ready", () => {
    const summary = summarizeRuntimeReadiness(baseOperatorLiveEnv());
    expect(summary.operatorReady).toBe(true);
    expect(summary.operatorMissing).not.toContain("OMRATE_API_KEY");
  });

  it("does not require TELEGRAM_ALLOWED_USER_ID before first owner claim", () => {
    const summary = summarizeRuntimeReadiness(baseOperatorLiveEnv());
    expect(summary.operatorReady).toBe(true);
    expect(summary.operatorMissing).not.toContain("TELEGRAM_ALLOWED_USER_ID");
  });

  it("uses fixed OmRate and xLayer defaults so readiness does not need user-entered RPC/base URLs", () => {
    const summary = summarizeRuntimeReadiness(baseOperatorLiveEnv());
    expect(summary.operatorReady).toBe(true);
    expect(summary.operatorMissing).not.toContain("OMRATE_API_BASE_URL");
    expect(summary.operatorMissing).not.toContain("XLAYER_RPC_URL");

    const config = buildRuntimeConfig(baseOperatorLiveEnv());
    expect(config.omrate.baseUrl).toBe("https://api.omrate.com");
    expect(config.chain.xlayerRpcUrl).toBe("https://rpc.xlayer.tech");
  });

  it("does not gate operator_ready on PHALANX_X402_PRIVATE_KEY", () => {
    const withoutPk = summarizeRuntimeReadiness(baseOperatorLiveEnv());
    expect(withoutPk.operatorReady).toBe(true);

    const withPk = summarizeRuntimeReadiness({
      ...baseOperatorLiveEnv(),
      PHALANX_X402_PRIVATE_KEY: "0x" + "1".repeat(64),
    });
    expect(withPk.operatorReady).toBe(true);
  });

  it("treats OKX bootstrap as a valid managed-wallet execution signal for operator_ready", () => {
    const summary = summarizeRuntimeReadiness({
      PHALANX_RUNTIME_MODE: "live",
      TELEGRAM_BOT_TOKEN: "123456:telegram-token",
      OKX_API_KEY: "okx-key",
      OKX_API_SECRET: "okx-secret",
      OKX_API_PASSPHRASE: "okx-pass",
    });
    expect(summary.operatorReady).toBe(true);
    expect(summary.operatorMissing).not.toContain("EXECUTION_WALLET_SIGNAL");
  });

  it("exposes operator_ready and demo_ready as distinct outcomes", () => {
    const opOnly = summarizeRuntimeReadiness(baseOperatorLiveEnv());
    expect(opOnly.operatorReady).toBe(true);
    expect(opOnly.demoReady).toBe(false);
    expect(opOnly.demoMissing.length).toBeGreaterThan(0);
    expect(opOnly.operatorReady).not.toBe(opOnly.demoReady);

    const full = summarizeRuntimeReadiness({
      ...baseOperatorLiveEnv(),
      PHALANX_OWNER_EVM_ADDRESS: "0x" + "c".repeat(40),
    });
    expect(full.operatorReady).toBe(true);
    expect(full.demoReady).toBe(true);
    expect(full.demoMissing).toEqual([]);
  });

  it("keeps liveReady aligned with demo_ready for legacy callers", () => {
    const partial = summarizeRuntimeReadiness(baseOperatorLiveEnv());
    expect(partial.liveReady).toBe(partial.demoReady);

    const full = summarizeRuntimeReadiness({
      ...baseOperatorLiveEnv(),
      PHALANX_OWNER_EVM_ADDRESS: "0x" + "c".repeat(40),
    });
    expect(full.liveReady).toBe(full.demoReady);
  });
});

describe("operator init bootstrap", () => {
  it("creates config.env from config.env.example when config.env is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      copyFileSync(exampleSource, join(dir, "config.env.example"));
      writeFileSync(join(dir, "service.env.example"), "PHALANX_RUNTIME_MODE=live\n", "utf8");
      const result = runOperatorInit(dir);
      expect(result.configCreated).toBe(true);
      expect(existsSync(join(dir, "config.env"))).toBe(true);
      expect(existsSync(join(dir, "service.env"))).toBe(true);
      const created = readFileSync(join(dir, "config.env"), "utf8");
      const example = readFileSync(join(dir, "config.env.example"), "utf8");
      expect(created).toBe(example);
      expect(readFileSync(join(dir, "service.env"), "utf8")).toBe("PHALANX_RUNTIME_MODE=live\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing config.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      copyFileSync(exampleSource, join(dir, "config.env.example"));
      writeFileSync(join(dir, "config.env"), "CUSTOM_MARKER=1\n", "utf8");
      const result = runOperatorInit(dir);
      expect(result.configCreated).toBe(false);
      expect(readFileSync(join(dir, "config.env"), "utf8")).toContain("CUSTOM_MARKER");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("separates required missing keys from optional OMRATE_API_KEY", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const envContent = [
        "PHALANX_RUNTIME_MODE=live",
        "TELEGRAM_BOT_TOKEN=tg-token-placeholder",
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${envContent}\n`, "utf8");
      const result = runOperatorInit(dir);
      expect(result.requiredMissing).toEqual([]);
      expect(result.demoMissing).toContain("PHALANX_OWNER_EVM_ADDRESS");
      expect(result.optionalMissing).toContain("OMRATE_API_KEY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports x402 baseline ready when OKX bootstrap and execution wallet are present without OMRATE_API_KEY", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const envContent = [
        "PHALANX_RUNTIME_MODE=live",
        "TELEGRAM_BOT_TOKEN=tg-token-placeholder",
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${envContent}\n`, "utf8");
      const result = runOperatorInit(dir);
      expect(result.x402BaselineReady).toBe(true);
      expect(formatOperatorInitReport(result)).toMatch(/x402 baseline ready/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("distinguishes demo_ready, partial (operator-only), and blocked readiness phases", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const opOnly = [
        "PHALANX_RUNTIME_MODE=live",
        "TELEGRAM_BOT_TOKEN=tg-token-placeholder",
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${opOnly}\n`, "utf8");
      const partial = runOperatorInit(dir);
      expect(partial.readinessPhase).toBe("partial");
      expect(partial.partialReadiness).toBe(true);
      expect(partial.summary.operatorReady).toBe(true);
      expect(partial.summary.demoReady).toBe(false);

      const fullEnv = [...opOnly.split("\n"), `PHALANX_OWNER_EVM_ADDRESS=0x${"c".repeat(40)}`].join("\n");
      writeFileSync(join(dir, "config.env"), `${fullEnv}\n`, "utf8");
      const full = runOperatorInit(dir);
      expect(full.readinessPhase).toBe("demo_ready");
      expect(full.partialReadiness).toBe(false);

      writeFileSync(
        join(dir, "config.env"),
        ["PHALANX_RUNTIME_MODE=live", "TELEGRAM_BOT_TOKEN=only"].join("\n") + "\n",
        "utf8",
      );
      const blocked = runOperatorInit(dir);
      expect(blocked.readinessPhase).toBe("blocked");
      expect(blocked.summary.operatorReady).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("suggests messaging the Telegram bot privately to claim owner when operator tier is satisfied", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const envContent = [
        "PHALANX_RUNTIME_MODE=live",
        "TELEGRAM_BOT_TOKEN=tg-token-placeholder",
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xcccccccccccccccccccccccccccccccccccccccc",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${envContent}\n`, "utf8");
      const result = runOperatorInit(dir);
      const text = formatOperatorInitReport(result);
      expect(text.toLowerCase()).toMatch(/claim/);
      expect(text.toLowerCase()).toMatch(/bot/);
      expect(text.toLowerCase()).toMatch(/private/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("frames the init report as terminal-only bootstrap through Telegram handoff", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      writeFileSync(
        join(dir, "config.env"),
        ["PHALANX_RUNTIME_MODE=live", "TELEGRAM_BOT_TOKEN=t"].join("\n") + "\n",
        "utf8",
      );
      const text = formatOperatorInitReport(runOperatorInit(dir));
      expect(text).toMatch(/@BotFather/i);
      expect(text).toMatch(/npm run init/i);
      expect(text).toMatch(/npm run dev/i);
      expect(text.toLowerCase()).toMatch(/telegram/i);
      expect(text.toLowerCase()).toMatch(/hand off|handoff|continue in telegram|switch to telegram/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("next steps after operator_ready include runtime start and /claim auto-writing TELEGRAM_ALLOWED_USER_ID", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const envContent = [
        "PHALANX_RUNTIME_MODE=live",
        "TELEGRAM_BOT_TOKEN=tg-token-placeholder",
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xcccccccccccccccccccccccccccccccccccccccc",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${envContent}\n`, "utf8");
      const result = runOperatorInit(dir);
      const joined = result.nextSteps.join(" ");
      expect(joined).toMatch(/npm run dev/i);
      expect(joined.toLowerCase()).toMatch(/\/claim/);
      expect(joined).toMatch(/TELEGRAM_ALLOWED_USER_ID/i);
      expect(joined.toLowerCase()).toMatch(/automatic/);
      expect(joined.toLowerCase()).toMatch(/userinfobot/);
      expect(joined.toLowerCase()).toMatch(/not the main path|not the primary path|optional/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero from initExitCode only when operator_ready is false", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      writeFileSync(
        join(dir, "config.env"),
        [
          "PHALANX_RUNTIME_MODE=live",
          "TELEGRAM_BOT_TOKEN=x",
          "OKX_API_KEY=k",
          "OKX_API_SECRET=s",
          "OKX_API_PASSPHRASE=p",
        ].join("\n") + "\n",
        "utf8",
      );
      expect(initExitCode(runOperatorInit(dir))).toBe(0);

      writeFileSync(
        join(dir, "config.env"),
        [
          "PHALANX_RUNTIME_MODE=live",
          "TELEGRAM_BOT_TOKEN=t",
          "OKX_API_KEY=k",
        ].join("\n") + "\n",
        "utf8",
      );
      expect(initExitCode(runOperatorInit(dir))).toBe(1);

      writeFileSync(
        join(dir, "config.env"),
        [
          "PHALANX_RUNTIME_MODE=live",
          "TELEGRAM_BOT_TOKEN=t",
          "OKX_API_KEY=k",
          "OKX_API_SECRET=s",
          "OKX_API_PASSPHRASE=p",
          "AGENT_WALLET_ADDRESS=0xdddddddddddddddddddddddddddddddddddddddd",
        ].join("\n") + "\n",
        "utf8",
      );
      expect(initExitCode(runOperatorInit(dir))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not echo raw Telegram bot token in formatted output", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const secret = "123456:ABSOLUTE_SECRET_TOKEN_SUBSTRING";
      const envContent = [
        "PHALANX_RUNTIME_MODE=live",
        `TELEGRAM_BOT_TOKEN=${secret}`,
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${envContent}\n`, "utf8");
      const result = runOperatorInit(dir);
      expect(formatOperatorInitReport(result)).not.toContain("ABSOLUTE_SECRET_TOKEN_SUBSTRING");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes install checks for Base RPC and official xLayer default", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const envContent = [
        "PHALANX_RUNTIME_MODE=live",
        "TELEGRAM_BOT_TOKEN=t",
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xffffffffffffffffffffffffffffffffffffffff",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${envContent}\n`, "utf8");
      const result = runOperatorInit(dir);
      const ids = result.checks.map((c) => c.id);
      expect(ids).toContain("base_rpc");
      expect(ids).toContain("xlayer_rpc_official_default");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports operator-tier and demo-tier gaps separately without contradiction", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const envContent = [
        "PHALANX_RUNTIME_MODE=live",
        "TELEGRAM_BOT_TOKEN=t",
        "OKX_API_KEY=k",
        "OKX_API_SECRET=s",
        "OKX_API_PASSPHRASE=p",
        "AGENT_WALLET_ADDRESS=0xffffffffffffffffffffffffffffffffffffffff",
      ].join("\n");
      writeFileSync(join(dir, "config.env"), `${envContent}\n`, "utf8");
      const text = formatOperatorInitReport(runOperatorInit(dir));
      expect(text).toContain("Operator tier: satisfied");
      expect(text).toContain("Demo tier — still missing:");
      expect(text).not.toContain("Required (operator): satisfied");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("makes missing local config explicit when neither config.env nor example exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      const result = runOperatorInit(dir);
      const text = formatOperatorInitReport(result);
      expect(result.configStatus).toBe("missing");
      expect(text).toContain("Config: missing");
      expect(text).toContain("No local config.env or config.env.example found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formats EXECUTION_WALLET_SIGNAL guidance as managed-wallet-first with env override secondary", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-init-"));
    try {
      writeFileSync(
        join(dir, "config.env"),
        [
          "PHALANX_RUNTIME_MODE=live",
          "TELEGRAM_BOT_TOKEN=t",
          "OKX_API_KEY=k",
          "OKX_API_SECRET=s",
          "OKX_API_PASSPHRASE=p",
        ].join("\n") + "\n",
        "utf8",
      );
      const text = formatOperatorInitReport(runOperatorInit(dir));
      expect(text).toMatch(/Onchain OS managed wallet/i);
      expect(text).toMatch(/override/i);
      expect(text).not.toContain("AGENT_WALLET_ADDRESS / PHALANX_WALLET_ADDRESS / TEST_WALLET_ADDRESS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
