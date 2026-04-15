import { describe, expect, it, vi } from "vitest";

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

function makeDeps(): PhalanxMcpDeps {
  const pendingOps = new PendingOperationsTracker();
  const approvalRouter = new ApprovalRouter();
  const policyCtx: PolicyContext = { lifecycle: "READY", executionPaused: false };
  const riskCtx: RiskEvaluationContext = { now: 1 };
  const notify = vi.fn<TelegramApprovalNotifier["sendApprovalRequest"]>(async () => ({ ok: true }));

  const core = new RuntimeCore({
    policyGate: new PolicyGate({
      whitelist: new WhitelistPolicy(new Set(["whitelist-admin"])),
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
    telegramApproval: { sendApprovalRequest: notify },
    approvalNotifyTimeoutMs: 100,
  };
}

describe("pending approval MCP contract", () => {
  it("returns a machine-readable pending approval payload", async () => {
    const deps = makeDeps();

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
    if (!out.ok) {
      throw new Error("expected pending approval");
    }

    expect(out.data).toMatchObject({
      kind: "pending_approval",
      approvalId: expect.any(String),
      resumeToken: expect.any(String),
      intentId: expect.any(String),
      originatingIntentId: expect.any(String),
      executionSegment: expect.any(String),
      createdAt: expect.stringMatching(/T/),
      expiresAt: expect.stringMatching(/T/),
    });
  });
});
