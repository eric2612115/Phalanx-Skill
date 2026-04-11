import { describe, expect, it } from "vitest";
import { RuntimeCore } from "../src/runtime/core.js";
import { PolicyGate } from "../src/policy/gate.js";
import { WhitelistPolicy } from "../src/policy/whitelist-policy.js";
import { RiskEngine } from "../src/risk/engine.js";
import { ApprovalPolicy } from "../src/policy/approval-policy.js";
import { ApprovalRouter } from "../src/runtime/approval-router.js";
import { PendingOperationsTracker } from "../src/runtime/pending-operations.js";
import { fingerprintForPending } from "../src/runtime/intents.js";
import type { RuntimeIntent } from "../src/runtime/types.js";
import type { PolicyContext } from "../src/runtime/types.js";
import type { RiskEvaluationContext } from "../src/risk/context.js";

function makeCore(overrides?: {
  executor?: { execute: (i: RuntimeIntent) => Promise<unknown> };
  policyCtx?: PolicyContext;
}) {
  const pendingOps = new PendingOperationsTracker();
  const approvalRouter = new ApprovalRouter();
  const policyCtx: PolicyContext = overrides?.policyCtx ?? {
    lifecycle: "READY",
    executionPaused: false,
  };
  const riskCtx: RiskEvaluationContext = { now: 1 };
  const executor = overrides?.executor ?? { execute: async () => ({ ok: true }) };

  return {
    core: new RuntimeCore({
      policyGate: new PolicyGate({ whitelist: new WhitelistPolicy(new Set(["pool"])) }),
      riskEngine: new RiskEngine(),
      approvalPolicy: new ApprovalPolicy(),
      approvalRouter,
      pendingOps,
      executor,
      getPolicyContext: () => policyCtx,
      getRiskContext: () => riskCtx,
    }),
    pendingOps,
    approvalRouter,
  };
}

function execIntent(action: string, payload: Record<string, unknown> = {}, target = "pool"): RuntimeIntent {
  return {
    id: "e1",
    lane: "execution",
    action,
    payload,
    entrySource: "mcp",
    target,
  };
}

describe("RuntimeCore pipeline", () => {
  it("runs policy then risk then executor for AUTO_EXECUTE reads", async () => {
    let seen: RuntimeIntent | undefined;
    const { core } = makeCore({
      executor: {
        execute: async (i) => {
          seen = i;
          return { done: true };
        },
      },
    });
    const out = await core.handleIntent(execIntent("getPortfolioStatus"));
    expect(out.type).toBe("executed");
    if (out.type === "executed") {
      expect(out.adapterResult).toEqual({ done: true });
    }
    expect(seen?.action).toBe("getPortfolioStatus");
  });

  it("allows read-only queries while paused", async () => {
    const { core } = makeCore({
      policyCtx: { lifecycle: "READY", executionPaused: true },
    });
    const out = await core.handleIntent(execIntent("getPortfolioStatus"));
    expect(out.type).toBe("executed");
  });

  it("blocks state-changing actions at policy when paused", async () => {
    const { core } = makeCore({
      policyCtx: { lifecycle: "READY", executionPaused: true },
    });
    const out = await core.handleIntent(execIntent("deposit", { amount: "1" }));
    expect(out.type).toBe("blocked");
    if (out.type === "blocked") {
      expect(out.stage).toBe("policy");
      expect(out.code).toBe("RUNTIME_PAUSED");
    }
  });

  it("blocks at risk when payload triggers rule", async () => {
    const { core } = makeCore();
    const out = await core.handleIntent(execIntent("getPortfolioStatus", { dataStale: true }));
    expect(out.type).toBe("blocked");
    if (out.type === "blocked") {
      expect(out.stage).toBe("risk");
    }
  });

  it("executes allowlisted execution immediately without pending approval", async () => {
    let executed = false;
    const { core } = makeCore({
      executor: {
        execute: async () => {
          executed = true;
          return {};
        },
      },
    });
    const out = await core.handleIntent(execIntent("deposit", { amount: "1" }));
    expect(out.type).toBe("executed");
    expect(executed).toBe(true);
  });

  it("executes governance action after submitApprovalDecision approved", async () => {
    const calls: string[] = [];
    const { core } = makeCore({
      executor: {
        execute: async (i) => {
          calls.push(i.action);
          return { ok: true };
        },
      },
    });
    const first = await core.handleIntent(execIntent("requestWhitelistExpansion", { target: "uniswap-v3" }));
    expect(first.type).toBe("pending_approval");
    if (first.type !== "pending_approval") throw new Error("expected pending");
    const second = await core.submitApprovalDecision(first.approvalId, true);
    expect(second.type).toBe("executed");
    expect(calls).toEqual(["requestWhitelistExpansion"]);
  });

  it("rejects duplicate overlapping governance approvals with same fingerprint", async () => {
    const { core } = makeCore();
    const a = execIntent("requestWhitelistExpansion", { target: "uniswap-v3" });
    const b: RuntimeIntent = { ...a, id: "other-id" };
    const first = await core.handleIntent(a);
    expect(first.type).toBe("pending_approval");
    const second = await core.handleIntent(b);
    expect(second.type).toBe("rejected");
    if (second.type === "rejected") {
      expect(second.code).toBe("DUPLICATE_PENDING");
    }
  });

  it("releases pending fingerprint when governance approval creation throws", async () => {
    const pendingOps = new PendingOperationsTracker();
    const approvalRouter = new ApprovalRouter({ maxPendingApprovals: 0 });
    const policyCtx: PolicyContext = {
      lifecycle: "READY",
      executionPaused: false,
    };
    const riskCtx: RiskEvaluationContext = { now: 1 };
    const core = new RuntimeCore({
      policyGate: new PolicyGate({ whitelist: new WhitelistPolicy(new Set(["pool"])) }),
      riskEngine: new RiskEngine(),
      approvalPolicy: new ApprovalPolicy(),
      approvalRouter,
      pendingOps,
      executor: { execute: async () => ({ ok: true }) },
      getPolicyContext: () => policyCtx,
      getRiskContext: () => riskCtx,
    });

    const intent = execIntent("requestWhitelistExpansion", { target: "uniswap-v3" });
    const fp = fingerprintForPending(intent);

    await expect(core.handleIntent(intent)).rejects.toThrow(/Too many pending approvals/);
    expect(pendingOps.has(fp)).toBe(false);
  });

  it("AUTO_BLOCK stops before pending/execute", async () => {
    let executed = false;
    const { core } = makeCore({
      executor: {
        execute: async () => {
          executed = true;
          return {};
        },
      },
    });
    const out = await core.handleIntent(execIntent("unknownAction"));
    expect(out.type).toBe("blocked");
    if (out.type === "blocked") {
      expect(out.stage).toBe("approval_class");
    }
    expect(executed).toBe(false);
  });
});
