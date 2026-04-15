import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { TelegramCallbackResult } from "../src/app/host.js";
import type { McpToolResult } from "../src/mcp/server.js";
import {
  assertDepositMainlineEnv,
  buildDepositMainlineProof,
  DEPOSIT_MAINLINE_SCHEMA_VERSION,
  DEPOSIT_MAINLINE_SMOKE_MODE,
} from "../scripts/smoke-deposit-mainline.ts";

const scriptPath = resolve(import.meta.dirname, "../scripts/smoke-deposit-mainline.ts");
const scriptSource = readFileSync(scriptPath, "utf8");
const allocationSmokePath = resolve(import.meta.dirname, "../scripts/smoke-allocation-mainline.ts");
const allocationSmokeSource = readFileSync(allocationSmokePath, "utf8");

describe("smoke-deposit-mainline script contract", () => {
  it("reuses the same host entry and Telegram approval smoke config as the existing live approval rehearsal", () => {
    expect(scriptSource).toContain('from "../src/app/host.js"');
    expect(scriptSource).toContain('from "./telegram-approval-live-smoke.js"');
    expect(scriptSource).toContain("buildTelegramApprovalSmokeConfigValues");
    expect(scriptSource).toContain("resolveTelegramApprovalSmokeLifecycle");
    expect(scriptSource).toContain('invokeMcp("phalanx_uniswap_liquidity_plan"');
    expect(scriptSource).toContain('invokeMcp("phalanx_action"');
  });

  it("exposes stable proof envelope constants", () => {
    expect(DEPOSIT_MAINLINE_SMOKE_MODE).toBe("deposit_mainline_smoke");
    expect(DEPOSIT_MAINLINE_SCHEMA_VERSION).toBe(1);
  });

  it("assertDepositMainlineEnv rejects non-live mode", () => {
    expect(() =>
      assertDepositMainlineEnv({
        PHALANX_RUNTIME_MODE: "dry_run",
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_ALLOWED_USER_ID: "1",
        OKX_API_KEY: "k",
        OKX_API_SECRET: "s",
        OKX_API_PASSPHRASE: "p",
        AGENT_WALLET_ADDRESS: "0x0000000000000000000000000000000000000001",
        POLICY_OWNER_KEY: "0x01",
        WHITELIST_POLICY_ADDRESS: "0x0000000000000000000000000000000000000002",
        PHALANX_OWNER_EVM_ADDRESS: "0x0000000000000000000000000000000000000003",
        BASE_RPC_URL: "https://example.invalid",
      }),
    ).toThrow(/PHALANX_RUNTIME_MODE must be `live`/);
  });

  it("assertDepositMainlineEnv rejects missing demo execution tier", () => {
    expect(() =>
      assertDepositMainlineEnv({
        PHALANX_RUNTIME_MODE: "live",
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_ALLOWED_USER_ID: "1",
        OKX_API_KEY: "k",
        OKX_API_SECRET: "s",
        OKX_API_PASSPHRASE: "p",
        AGENT_WALLET_ADDRESS: "0x0000000000000000000000000000000000000001",
      }),
    ).toThrow(/demo execution tier incomplete/);
  });

  it("buildDepositMainlineProof reports milestones for pending approval then executed callback", () => {
    const actionResult = {
      ok: true,
      data: { kind: "pending_approval" as const, approvalId: "a1", message: "ok" },
    } as unknown as McpToolResult;

    const callbackResult: TelegramCallbackResult = {
      handled: true,
      decision: "approve",
      runtimeOutcome: {
        type: "executed",
        adapterResult: { txRefs: ["0xaaa", "0xbbb"] },
      },
    } as TelegramCallbackResult;

    const proof = buildDepositMainlineProof({
      plannerOk: true,
      actionResult,
      callbackResult,
    });

    expect(proof.milestones).toEqual({
      approvalRequested: true,
      approvalResumed: true,
      depositAttempted: true,
      depositCompleted: true,
      txRefsCaptured: true,
    });
    expect(proof.txRefs).toEqual(["0xaaa", "0xbbb"]);
    expect(proof.humanSummary).toBe(
      "approval_requested=1|approval_resumed=1|deposit_attempted=1|deposit_completed=1|tx_refs_captured=1",
    );
  });

  it("buildDepositMainlineProof handles direct execution without pending approval", () => {
    const actionResult = {
      ok: true,
      data: {
        kind: "executed" as const,
        adapterResult: { txRefs: ["0xsolo"] },
      },
    } as unknown as McpToolResult;

    const proof = buildDepositMainlineProof({
      plannerOk: true,
      actionResult,
    });

    expect(proof.milestones).toEqual({
      approvalRequested: false,
      approvalResumed: false,
      depositAttempted: true,
      depositCompleted: true,
      txRefsCaptured: true,
    });
    expect(proof.txRefs).toEqual(["0xsolo"]);
  });

  it("buildDepositMainlineProof treats executed-without-txRefs as completed but not tx-captured", () => {
    const actionResult = {
      ok: true,
      data: {
        kind: "executed" as const,
        adapterResult: { summary: "executed_without_refs" },
      },
    } as unknown as McpToolResult;

    const proof = buildDepositMainlineProof({
      plannerOk: true,
      actionResult,
    });

    expect(proof.milestones).toEqual({
      approvalRequested: false,
      approvalResumed: false,
      depositAttempted: true,
      depositCompleted: true,
      txRefsCaptured: false,
    });
    expect(proof.txRefs).toEqual([]);
    expect(proof.humanSummary).toBe(
      "approval_requested=0|approval_resumed=0|deposit_attempted=1|deposit_completed=1|tx_refs_captured=0",
    );
  });

  it("buildDepositMainlineProof reports no deposit when planner failed", () => {
    const proof = buildDepositMainlineProof({ plannerOk: false });
    expect(proof.milestones.depositAttempted).toBe(false);
    expect(proof.humanSummary).toBe(
      "approval_requested=0|approval_resumed=0|deposit_attempted=0|deposit_completed=0|tx_refs_captured=0",
    );
  });
});

describe("smoke-allocation-mainline script contract", () => {
  it("reuses host + Telegram approval wiring and runs proactive allocation via host entry", () => {
    expect(allocationSmokeSource).toContain('from "../src/app/host.js"');
    expect(allocationSmokeSource).toContain("runAgenticAllocationMainlineDemo");
    expect(allocationSmokeSource).toContain("buildTelegramApprovalSmokeConfigValues");
    expect(allocationSmokeSource).toContain("assertDepositMainlineEnv");
    expect(allocationSmokeSource).toContain("ALLOCATION_MAINLINE_SCHEMA_VERSION");
    expect(allocationSmokeSource).toContain("buildAllocationMainlineProof");
  });
});
