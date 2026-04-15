import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigStore } from "../src/config/store.js";
import { ApprovalRouter } from "../src/runtime/approval-router.js";
import type { RuntimeIntent } from "../src/runtime/types.js";
import {
  buildApprovalCallbackData,
  parseApprovalCallbackData,
  resolveApproval,
} from "../src/telegram/approvals.js";
import { routeTelegramCallback } from "../src/telegram/bot.js";
import { renderSetupError } from "../src/telegram/messages.js";
import { sendProgress, withProgressAndTyping } from "../src/telegram/progress.js";
import {
  createConfigBackedSetupHooks,
  createSetupSession,
  getNextWizardStep,
  handleTelegramUpdate,
  resetTelegramSetupStateForTests,
} from "../src/telegram/setup.js";

const originalAllowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID;
const originalConfigPath = process.env.PHALANX_CONFIG_PATH;

afterEach(() => {
  if (originalAllowedUserId === undefined) {
    delete process.env.TELEGRAM_ALLOWED_USER_ID;
  } else {
    process.env.TELEGRAM_ALLOWED_USER_ID = originalAllowedUserId;
  }
  if (originalConfigPath === undefined) {
    delete process.env.PHALANX_CONFIG_PATH;
  } else {
    process.env.PHALANX_CONFIG_PATH = originalConfigPath;
  }
  resetTelegramSetupStateForTests();
});

beforeEach(() => {
  if (originalAllowedUserId === undefined) {
    delete process.env.TELEGRAM_ALLOWED_USER_ID;
  } else {
    process.env.TELEGRAM_ALLOWED_USER_ID = originalAllowedUserId;
  }
  // Isolate from repo-root config.env (may pin TELEGRAM_ALLOWED_USER_ID) so defaults match tests.
  const isolatedDir = mkdtempSync(join(tmpdir(), "phalanx-telegram-isolated-"));
  const isolatedConfigPath = join(isolatedDir, "config.env");
  const isolatedServicePath = join(isolatedDir, "service.env");
  writeFileSync(isolatedConfigPath, "", "utf8");
  writeFileSync(isolatedServicePath, "", "utf8");
  process.env.PHALANX_CONFIG_PATH = isolatedConfigPath;
  resetTelegramSetupStateForTests();
});

describe("telegram setup flow", () => {
  it("creates an owner candidate first and only starts setup after confirm", async () => {
    const { handleTelegramUpdate: handle } = await import("../src/telegram/setup.js");
    const result = await handle({
      from: { id: 1 },
      chat: { type: "private" },
      text: "hi",
    });
    expect(result.nextState).toBe("UNCLAIMED");
    expect(result.messages.join(" ")).toMatch(/confirm/i);

    const confirmed = await handle({
      from: { id: 1 },
      chat: { type: "private" },
      text: "confirm",
    });
    expect(confirmed.nextState).toBe("SETUP_IN_PROGRESS");
  });

  it("advances all wizard steps and reaches READY after finalize confirm", async () => {
    const session = createSetupSession({
      hooks: {
        readManagedWalletAddress: async () => "0x1111111111111111111111111111111111111111",
      },
    });
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "claim" },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "confirm" },
      session,
    );
    const steps = [
      "operator@example.com",
      "OKX_API_KEY=key\nOKX_API_SECRET=secret\nOKX_API_PASSPHRASE=pass",
      "skip",
      "continue",
      "funded",
      "allocate_now",
    ] as const;
    for (const s of steps) {
      const r = await handleTelegramUpdate(
        { from: { id: 7 }, chat: { type: "private" }, text: s },
        session,
      );
      if (s === "allocate_now") {
        expect(r.nextState).toBe("READY");
        expect(r.messages.join(" ")).toContain("READY");
      } else {
        expect(r.nextState).toBe("SETUP_IN_PROGRESS");
      }
    }
  });

  it("runs capability hooks and persists validated step values into ConfigStore", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-telegram-setup-"));
    const configPath = join(dir, "config.env");
    const servicePath = join(dir, "service.env");
    writeFileSync(configPath, "", "utf8");
    writeFileSync(servicePath, "", "utf8");
    const config = new ConfigStore(configPath);
    const service = new ConfigStore(servicePath);
    const checks: string[] = [];
    const session = createSetupSession({
      hooks: createConfigBackedSetupHooks(config, service, {
        validateCapability: async ({ step }) => {
          checks.push(step);
          return null;
        },
        readManagedWalletAddress: async () => "0x1111111111111111111111111111111111111111",
      }),
    });

    await handleTelegramUpdate({ from: { id: 5 }, chat: { type: "private" }, text: "hi" }, session);
    await handleTelegramUpdate(
      { from: { id: 5 }, chat: { type: "private" }, text: "confirm" },
      session,
    );

    await handleTelegramUpdate(
      {
        from: { id: 5 },
        chat: { type: "private" },
        text: "operator@example.com",
      },
      session,
    );
    await handleTelegramUpdate(
      {
        from: { id: 5 },
        chat: { type: "private" },
        text: "OKX_API_KEY=key\nOKX_API_SECRET=secret\nOKX_API_PASSPHRASE=pass",
      },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 5 }, chat: { type: "private" }, text: "OMRATE_API_KEY=omrate-key" },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 5 }, chat: { type: "private" }, text: "continue" },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 5 }, chat: { type: "private" }, text: "funded" },
      session,
    );

    expect(checks).toEqual([
      "collect_login_email",
      "collect_okx",
      "collect_omrate",
      "bootstrap_wallet",
      "confirm_funding",
    ]);

    const raw = readFileSync(configPath, "utf8");
    const serviceRaw = readFileSync(servicePath, "utf8");
    expect(raw).toContain("TELEGRAM_ALLOWED_USER_ID=5");
    expect(raw).toContain("OKX_AGENTIC_WALLET_LOGIN_EMAIL=operator@example.com");
    expect(raw).toContain("OKX_API_KEY=key");
    expect(raw).toContain("OMRATE_API_KEY=omrate-key");
    expect(raw).toContain("OKX_AGENTIC_WALLET_CURRENT_ADDRESS=0x1111111111111111111111111111111111111111");
    expect(raw).toContain("OKX_AGENTIC_WALLET_ADDRESS_HISTORY=0x1111111111111111111111111111111111111111");
    expect(raw).toContain("OKX_AGENTIC_WALLET_PROFILES_JSON=");
    expect(raw).not.toContain("AGENT_WALLET_ADDRESS=");
    expect(serviceRaw).not.toContain("WHITELIST_TARGETS=");
  });

  it("shows the confirmed managed wallet address and funding guidance after bootstrap", async () => {
    const session = createSetupSession({
      hooks: {
        readManagedWalletAddress: async () => "0x1111111111111111111111111111111111111111",
      },
    });

    await handleTelegramUpdate({ from: { id: 7 }, chat: { type: "private" }, text: "claim" }, session);
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "confirm" },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "operator@example.com" },
      session,
    );
    await handleTelegramUpdate(
      {
        from: { id: 7 },
        chat: { type: "private" },
        text: "OKX_API_KEY=key\nOKX_API_SECRET=secret\nOKX_API_PASSPHRASE=pass",
      },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "skip" },
      session,
    );

    const result = await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "continue" },
      session,
    );

    expect(result.messages.join(" ")).toContain("0x1111111111111111111111111111111111111111");
    expect(result.messages.join(" ").toLowerCase()).toMatch(/fund|deposit|managed wallet/i);
    expect(session.wizardStep).toBe("confirm_funding");
  });
});

describe("setup validation", () => {
  it("rejects invalid payloads for each setup step before advancing", async () => {
    const session = createSetupSession();
    await handleTelegramUpdate({ from: { id: 7 }, chat: { type: "private" }, text: "claim" }, session);
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "confirm" },
      session,
    );

    const badOkx = await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "bad" },
      session,
    );
    expect(badOkx.messages.join(" ")).toMatch(/invalid/i);
    expect(session.wizardStep).toBe("collect_login_email");

    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "operator@example.com" },
      session,
    );

    await handleTelegramUpdate(
      {
        from: { id: 7 },
        chat: { type: "private" },
        text: "OKX_API_KEY=key\nOKX_API_SECRET=secret\nOKX_API_PASSPHRASE=pass",
      },
      session,
    );

    const badOmrate = await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "wallet=bad" },
      session,
    );
    expect(badOmrate.messages.join(" ")).toMatch(/invalid/i);
    expect(session.wizardStep).toBe("collect_omrate");

    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "OMRATE_API_KEY=omrate-key" },
      session,
    );

    const badBootstrapContinue = await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: " , " },
      session,
    );
    expect(badBootstrapContinue.messages.join(" ")).toMatch(/invalid|continue/i);
    expect(session.wizardStep).toBe("bootstrap_wallet");
  });

  it("stays on the same step when capability validation fails", async () => {
    const session = createSetupSession({
      hooks: {
        validateCapability: async ({ step }) =>
          step === "collect_okx" ? "OKX connectivity probe failed" : null,
      },
    });

    await handleTelegramUpdate({ from: { id: 7 }, chat: { type: "private" }, text: "claim" }, session);
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "confirm" },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "operator@example.com" },
      session,
    );

    const result = await handleTelegramUpdate(
      {
        from: { id: 7 },
        chat: { type: "private" },
        text: "OKX_API_KEY=key\nOKX_API_SECRET=secret\nOKX_API_PASSPHRASE=pass",
      },
      session,
    );

    expect(result.messages.join(" ")).toContain("probe failed");
    expect(session.wizardStep).toBe("collect_okx");
  });

  it("keeps finalize pending when final readiness check fails", async () => {
    const session = createSetupSession({
      hooks: {
        validateCapability: async ({ step }) =>
          step === "offer_allocate" ? "Final readiness check failed" : null,
        readManagedWalletAddress: async () => "0x1111111111111111111111111111111111111111",
      },
    });

    await handleTelegramUpdate({ from: { id: 7 }, chat: { type: "private" }, text: "claim" }, session);
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "confirm" },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "operator@example.com" },
      session,
    );
    await handleTelegramUpdate(
      {
        from: { id: 7 },
        chat: { type: "private" },
        text: "OKX_API_KEY=key\nOKX_API_SECRET=secret\nOKX_API_PASSPHRASE=pass",
      },
      session,
    );
    await handleTelegramUpdate(
      {
        from: { id: 7 },
        chat: { type: "private" },
        text: "skip",
      },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "continue" },
      session,
    );
    await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "funded" },
      session,
    );

    const result = await handleTelegramUpdate(
      { from: { id: 7 }, chat: { type: "private" }, text: "allocate_now" },
      session,
    );

    expect(result.nextState).toBe("SETUP_IN_PROGRESS");
    expect(result.messages.join(" ")).toContain("Final readiness check failed");
    expect(session.lifecycle).toBe("SETUP_IN_PROGRESS");
    expect(session.wizardStep).toBe("offer_allocate");
  });
});

describe("default env behavior", () => {
  it("defaults session restrictions from merged runtime config (process.env wins over files)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-telegram-merge-"));
    const configPath = join(dir, "config.env");
    const servicePath = join(dir, "service.env");
    writeFileSync(configPath, "TELEGRAM_ALLOWED_USER_ID=from-config\n", "utf8");
    writeFileSync(servicePath, "TELEGRAM_ALLOWED_USER_ID=from-service\n", "utf8");
    process.env.PHALANX_CONFIG_PATH = configPath;
    process.env.TELEGRAM_ALLOWED_USER_ID = "99";
    resetTelegramSetupStateForTests();

    const { handleTelegramUpdate: handle } = await import("../src/telegram/setup.js");
    const rejected = await handle({
      from: { id: 1 },
      chat: { type: "private" },
      text: "claim",
    });
    expect(rejected.nextState).toBe("UNCLAIMED");

    const allowed = await handle({
      from: { id: 99 },
      chat: { type: "private" },
      text: "claim",
    });
    expect(allowed.nextState).toBe("UNCLAIMED");
    expect(allowed.messages.join(" ")).toMatch(/confirm/i);
  });

  it("defaults session restrictions from service.env when absent in config.env and process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-telegram-service-only-"));
    const configPath = join(dir, "config.env");
    const servicePath = join(dir, "service.env");
    writeFileSync(configPath, "# no telegram id\n", "utf8");
    writeFileSync(servicePath, "TELEGRAM_ALLOWED_USER_ID=88\n", "utf8");
    delete process.env.TELEGRAM_ALLOWED_USER_ID;
    process.env.PHALANX_CONFIG_PATH = configPath;
    resetTelegramSetupStateForTests();

    const { handleTelegramUpdate: handle } = await import("../src/telegram/setup.js");
    const rejected = await handle({
      from: { id: 1 },
      chat: { type: "private" },
      text: "claim",
    });
    expect(rejected.nextState).toBe("UNCLAIMED");

    const allowed = await handle({
      from: { id: 88 },
      chat: { type: "private" },
      text: "claim",
    });
    expect(allowed.nextState).toBe("UNCLAIMED");
    expect(allowed.messages.join(" ")).toMatch(/confirm/i);
  });

  it("uses default config-backed persistence for Telegram entry without explicit hooks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-telegram-default-"));
    const configPath = join(dir, "config.env");
    writeFileSync(configPath, "", "utf8");
    process.env.PHALANX_CONFIG_PATH = configPath;
    resetTelegramSetupStateForTests();

    const { handleTelegramUpdate: handle } = await import("../src/telegram/setup.js");
    await handle({ from: { id: 55 }, chat: { type: "private" }, text: "claim" });
    await handle({ from: { id: 55 }, chat: { type: "private" }, text: "confirm" });
    await handle({
      from: { id: 55 },
      chat: { type: "private" },
      text: "operator@example.com",
    });
    await handle({
      from: { id: 55 },
      chat: { type: "private" },
      text: "OKX_API_KEY=key\nOKX_API_SECRET=secret\nOKX_API_PASSPHRASE=pass",
    });

    const raw = readFileSync(configPath, "utf8");
    expect(raw).toContain("TELEGRAM_ALLOWED_USER_ID=55");
    expect(raw).toContain("OKX_AGENTIC_WALLET_LOGIN_EMAIL=operator@example.com");
    expect(raw).toContain("OKX_API_KEY=key");
    expect(raw).toContain("OKX_API_SECRET=secret");
    expect(raw).toContain("OKX_API_PASSPHRASE=pass");
  });

  it("requires a warning and second confirmation before overwriting the OKX login email in READY", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-telegram-ready-email-"));
    const configPath = join(dir, "config.env");
    writeFileSync(
      configPath,
      ["TELEGRAM_ALLOWED_USER_ID=55", "OKX_AGENTIC_WALLET_LOGIN_EMAIL=old@example.com"].join("\n") + "\n",
      "utf8",
    );
    process.env.PHALANX_CONFIG_PATH = configPath;

    const session = createSetupSession();
    session.lifecycle = "READY";
    session.ownerUserId = "55";

    const warn = await handleTelegramUpdate(
      { from: { id: 55 }, chat: { type: "private" }, text: "change login email" },
      session,
    );
    expect(warn.messages.join(" ").toLowerCase()).toMatch(/warning|old wallet|confirm/i);

    const askNew = await handleTelegramUpdate(
      { from: { id: 55 }, chat: { type: "private" }, text: "confirm" },
      session,
    );
    expect(askNew.messages.join(" ").toLowerCase()).toMatch(/new login email|send.*email/i);

    const saved = await handleTelegramUpdate(
      { from: { id: 55 }, chat: { type: "private" }, text: "new@example.com" },
      session,
    );
    expect(saved.messages.join(" ").toLowerCase()).toMatch(/updated|saved/i);
    expect(readFileSync(configPath, "utf8")).toContain("OKX_AGENTIC_WALLET_LOGIN_EMAIL=new@example.com");
    expect(session.lifecycle).toBe("READY");
  });
});

describe("wizard step flow", () => {
  it("moves through okx, wallet, omrate, whitelist, finalize in order", async () => {
    const { getNextWizardStep: next } = await import("../src/telegram/setup.js");
    expect(next("collect_login_email")).toBe("collect_okx");
    expect(next("collect_okx")).toBe("collect_omrate");
    expect(next("collect_omrate")).toBe("bootstrap_wallet");
    expect(next("bootstrap_wallet")).toBe("confirm_funding");
    expect(next("confirm_funding")).toBe("offer_allocate");
    expect(next("offer_allocate")).toBeNull();
  });
});

describe("setup messages", () => {
  it("does not echo secret material in setup errors", () => {
    const secretValue = "abc123secret";
    const detail = `API_KEY=${secretValue}`;
    const msg = renderSetupError("bad key", detail);
    expect(msg).not.toContain(secretValue);
  });
});

describe("progress UX", () => {
  it("formats progress line for long-running stages", async () => {
    const line = await sendProgress("connectivity_check");
    expect(line).toBe("Processing: connectivity_check");
  });

  it("withProgressAndTyping invokes work after progress", async () => {
    const lines: string[] = [];
    let typed = false;
    await withProgressAndTyping(
      "probe",
      async (t) => {
        lines.push(t);
      },
      async () => {
        typed = true;
      },
      async () => {
        lines.push("done");
      },
    );
    expect(typed).toBe(true);
    expect(lines[0]).toBe("Processing: probe");
    expect(lines[1]).toBe("done");
  });
});

describe("approval callback handling", () => {
  it("parses callback data, resolves against router, and removes pending", async () => {
    const router = new ApprovalRouter();
    const intent: RuntimeIntent = {
      id: "i1",
      lane: "execution",
      action: "swap",
      payload: {},
      entrySource: "telegram",
    };
    const pending = router.createPending(intent, "fp");
    const data = buildApprovalCallbackData("approve", pending.id);
    expect(parseApprovalCallbackData(data)).toEqual({ action: "approve", approvalId: pending.id });

    const res = routeTelegramCallback(data, { approvalRouter: router });
    expect(res.handled).toBe(true);
    expect(res.approval?.ok).toBe(true);
    expect(res.approval?.decision).toBe("approve");
    expect(router.size()).toBe(0);
  });

  it("resolveApproval returns NOT_FOUND when id unknown", () => {
    const router = new ApprovalRouter();
    const r = resolveApproval(router, "reject", "missing");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_FOUND");
  });
});
