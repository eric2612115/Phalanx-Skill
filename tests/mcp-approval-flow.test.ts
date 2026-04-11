import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { RuntimeCore } from "../src/runtime/core.js";
import { PolicyGate } from "../src/policy/gate.js";
import { WhitelistPolicy } from "../src/policy/whitelist-policy.js";
import { RiskEngine } from "../src/risk/engine.js";
import { ApprovalPolicy } from "../src/policy/approval-policy.js";
import { ApprovalRouter } from "../src/runtime/approval-router.js";
import { PendingOperationsTracker } from "../src/runtime/pending-operations.js";
import type { PolicyContext } from "../src/runtime/types.js";
import type { RiskEvaluationContext } from "../src/risk/context.js";
import { invokePhalanxMcpTool, type PhalanxMcpDeps, type TelegramApprovalNotifier } from "../src/mcp/server.js";

function makeMcpDeps(overrides?: {
  policyCtx?: PolicyContext;
  telegramApproval?: TelegramApprovalNotifier;
  approvalNotifyTimeoutMs?: number;
  whitelistTargets?: string[];
}): PhalanxMcpDeps {
  const pendingOps = new PendingOperationsTracker();
  const approvalRouter = new ApprovalRouter();
  const policyCtx: PolicyContext = overrides?.policyCtx ?? {
    lifecycle: "READY",
    executionPaused: false,
  };
  const riskCtx: RiskEvaluationContext = { now: 1 };

  const core = new RuntimeCore({
    policyGate: new PolicyGate({
      whitelist: new WhitelistPolicy(new Set(overrides?.whitelistTargets ?? ["pool"])),
    }),
    riskEngine: new RiskEngine(),
    approvalPolicy: new ApprovalPolicy(),
    approvalRouter,
    pendingOps,
    executor: { execute: async () => ({ ok: true }) },
    getPolicyContext: () => policyCtx,
    getRiskContext: () => riskCtx,
  });

  return {
    core,
    approvalRouter,
    pendingOps,
    getPolicyContext: () => policyCtx,
    telegramApproval: overrides?.telegramApproval,
    approvalNotifyTimeoutMs: overrides?.approvalNotifyTimeoutMs ?? 100,
  };
}

describe("MCP pre-setup read-only", () => {
  it("status tool returns lifecycle and setup guidance when not ready", async () => {
    const deps = makeMcpDeps({
      policyCtx: { lifecycle: "SETUP_IN_PROGRESS", executionPaused: false },
    });
    const out = await invokePhalanxMcpTool("phalanx_status", {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.data.lifecycle).toBe("SETUP_IN_PROGRESS");
    expect(String(out.data.guidance)).toMatch(/Telegram/i);
  });

  it("portfolio tool is blocked before READY", async () => {
    const deps = makeMcpDeps({
      policyCtx: { lifecycle: "UNCLAIMED", executionPaused: false },
    });
    const out = await invokePhalanxMcpTool("phalanx_portfolio", {}, deps);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("NOT_READY");
  });
});

describe("MCP cross-channel approval", () => {
  it("allowlisted execution action executes without Telegram approval", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => ({ ok: true }));
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      whitelistTargets: ["uniswap-v3"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "swap", payload: { amount: "1" }, target: "uniswap-v3" },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.data.kind).toBe("executed");
    expect(notify).not.toHaveBeenCalled();
    expect(deps.approvalRouter.size()).toBe(0);
  });

  it("blocks non-whitelisted execution before any approval notify", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => ({ ok: true }));
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      whitelistTargets: ["uniswap-v3"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "swap", payload: { amount: "1" }, target: "pancakeswap-v3" },
      deps,
    );

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("TARGET_NOT_WHITELISTED");
    expect(notify).not.toHaveBeenCalled();
    expect(deps.approvalRouter.size()).toBe(0);
  });

  it("auto-converts non-whitelisted execution into whitelist approval when whitelist-admin is allowlisted", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => ({ ok: true }));
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      whitelistTargets: ["whitelist-admin"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      {
        action: "swap",
        payload: {
          amount: "1",
          contractAddress: "0x1111111111111111111111111111111111111111",
        },
      },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected pending approval");
    expect(out.data.kind).toBe("pending_approval");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(deps.approvalRouter.size()).toBe(1);
  });

  it("whitelist expansion still routes through Telegram approval", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => ({ ok: true }));
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      whitelistTargets: ["whitelist-admin"],
      approvalNotifyTimeoutMs: 200,
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "requestWhitelistExpansion", payload: { target: "uniswap-v3" }, target: "whitelist-admin" },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.data.kind).toBe("pending_approval");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(deps.approvalRouter.size()).toBe(1);
  });

  it("whitelist change returns pending_approval after Telegram notify succeeds", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => ({ ok: true }));
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      approvalNotifyTimeoutMs: 200,
      whitelistTargets: ["whitelist-admin"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "requestWhitelistExpansion", payload: { target: "uniswap-v3" }, target: "whitelist-admin" },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.data.kind).toBe("pending_approval");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(deps.approvalRouter.size()).toBe(1);
  });

  it("rolls back whitelist-change approval when Telegram notifier reports failure", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => ({
      ok: false,
      code: "SEND_FAILED",
      message: "bot down",
    }));
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      whitelistTargets: ["whitelist-admin"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "requestWhitelistExpansion", payload: { target: "uniswap-v3" }, target: "whitelist-admin" },
      deps,
    );

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("TELEGRAM_APPROVAL_NOTIFY_FAILED");
    expect(deps.approvalRouter.size()).toBe(0);
  });

  it("expires whitelist-change approval when Telegram notify times out", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(
      async () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 10_000)),
    );
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      approvalNotifyTimeoutMs: 30,
      whitelistTargets: ["whitelist-admin"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "requestWhitelistExpansion", payload: { target: "uniswap-v3" }, target: "whitelist-admin" },
      deps,
    );

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("TELEGRAM_APPROVAL_NOTIFY_TIMEOUT");
    expect(deps.approvalRouter.size()).toBe(0);
  });

  it("treats whitelist-change notifier rejection as notify failure instead of timeout", async () => {
    const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => {
      throw new Error("network exploded");
    });
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify },
      approvalNotifyTimeoutMs: 30,
      whitelistTargets: ["whitelist-admin"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "requestWhitelistExpansion", payload: { target: "uniswap-v3" }, target: "whitelist-admin" },
      deps,
    );

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("TELEGRAM_APPROVAL_NOTIFY_FAILED");
    expect(out.message).toMatch(/network exploded/);
    expect(deps.approvalRouter.size()).toBe(0);
  });

  it("rolls back whitelist-change approval when Telegram notifier throws synchronously", async () => {
    const notify = vi.fn(() => {
      throw new Error("sync explosion");
    });
    const deps = makeMcpDeps({
      telegramApproval: { sendApprovalRequest: notify as TelegramApprovalNotifier["sendApprovalRequest"] },
      approvalNotifyTimeoutMs: 30,
      whitelistTargets: ["whitelist-admin"],
    });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "requestWhitelistExpansion", payload: { target: "uniswap-v3" }, target: "whitelist-admin" },
      deps,
    );

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("TELEGRAM_APPROVAL_NOTIFY_FAILED");
    expect(out.message).toMatch(/sync explosion/);
    expect(deps.approvalRouter.size()).toBe(0);
  });

  it("fails fast when whitelist-change notifier is not configured", async () => {
    const deps = makeMcpDeps({ telegramApproval: undefined, whitelistTargets: ["whitelist-admin"] });

    const out = await invokePhalanxMcpTool(
      "phalanx_action",
      { action: "requestWhitelistExpansion", payload: { target: "uniswap-v3" }, target: "whitelist-admin" },
      deps,
    );

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("TELEGRAM_UNAVAILABLE");
    expect(deps.approvalRouter.size()).toBe(0);
  });

  it("portfolio read succeeds when READY", async () => {
    const deps = makeMcpDeps();
    const out = await invokePhalanxMcpTool("phalanx_portfolio", {}, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.data.kind).toBe("executed");
  });
});

describe("MCP unknown tool", () => {
  it("returns UNKNOWN_TOOL", async () => {
    const deps = makeMcpDeps();
    const out = await invokePhalanxMcpTool(`no_such_${randomUUID()}`, {}, deps);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected fail");
    expect(out.code).toBe("UNKNOWN_TOOL");
  });
});
