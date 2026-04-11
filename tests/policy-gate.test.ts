import { describe, expect, it } from "vitest";
import { PolicyGate } from "../src/policy/gate.js";
import { WhitelistPolicy } from "../src/policy/whitelist-policy.js";
import { ApprovalPolicy } from "../src/policy/approval-policy.js";
import type { RuntimeIntent } from "../src/runtime/types.js";

function intent(partial: Partial<RuntimeIntent> & Pick<RuntimeIntent, "action" | "lane">): RuntimeIntent {
  return {
    id: "id",
    lane: partial.lane,
    action: partial.action,
    payload: partial.payload ?? {},
    entrySource: partial.entrySource ?? "mcp",
    target: partial.target,
  };
}

describe("PolicyGate", () => {
  it("allows explicit read-only queries while paused", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set(["pool"])) });
    const r = gate.evaluate(intent({ lane: "execution", action: "getPortfolioStatus", target: "pool" }), {
      lifecycle: "READY",
      executionPaused: true,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks state-changing actions while paused", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set(["pool"])) });
    const r = gate.evaluate(intent({ lane: "execution", action: "deposit", target: "pool" }), {
      lifecycle: "READY",
      executionPaused: true,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("RUNTIME_PAUSED");
  });

  it("blocks mutations before READY", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set()) });
    const r = gate.evaluate(intent({ lane: "execution", action: "deposit" }), {
      lifecycle: "SETUP_IN_PROGRESS",
      executionPaused: false,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NOT_READY");
  });

  it("allows read-only diagnostics before READY", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set()) });
    const r = gate.evaluate(intent({ lane: "conversation", action: "getRuntimeStatus" }), {
      lifecycle: "SETUP_IN_PROGRESS",
      executionPaused: false,
    });
    expect(r.ok).toBe(true);
  });

  it("enforces whitelist when target is set", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set(["good"])) });
    const bad = gate.evaluate(intent({ lane: "execution", action: "getPortfolioStatus", target: "bad" }), {
      lifecycle: "READY",
      executionPaused: false,
    });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("TARGET_NOT_WHITELISTED");

    const good = gate.evaluate(intent({ lane: "execution", action: "getPortfolioStatus", target: "good" }), {
      lifecycle: "READY",
      executionPaused: false,
    });
    expect(good.ok).toBe(true);
  });
});

describe("ApprovalPolicy classes", () => {
  const policy = new ApprovalPolicy();

  it("classifies reads as AUTO_EXECUTE", () => {
    expect(policy.classify(intent({ lane: "execution", action: "queryRates" }))).toBe("AUTO_EXECUTE");
  });

  it("classifies allowlisted execution as AUTO_EXECUTE and whitelist changes as REQUIRE_APPROVAL", () => {
    expect(policy.classify(intent({ lane: "execution", action: "proposeRebalance" }))).toBe("AUTO_EXECUTE");
    expect(policy.classify(intent({ lane: "execution", action: "deposit" }))).toBe("AUTO_EXECUTE");
    expect(policy.classify(intent({ lane: "execution", action: "requestWhitelistExpansion" }))).toBe(
      "REQUIRE_APPROVAL",
    );
  });

  it("classifies unknown actions as AUTO_BLOCK", () => {
    expect(policy.classify(intent({ lane: "execution", action: "unknownAction" }))).toBe("AUTO_BLOCK");
  });

  it("supports overrides", () => {
    const p = new ApprovalPolicy({ unknownAction: "AUTO_EXECUTE" });
    expect(p.classify(intent({ lane: "execution", action: "unknownAction" }))).toBe("AUTO_EXECUTE");
  });
});
