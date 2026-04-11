import { describe, expect, it } from "vitest";
import {
  STATE_CHANGING_ACTIONS,
  getConversationLaneToolNames,
  getExecutionLaneToolNames,
} from "../src/runtime/intents.js";
import { PolicyGate } from "../src/policy/gate.js";
import { WhitelistPolicy } from "../src/policy/whitelist-policy.js";
import type { RuntimeIntent } from "../src/runtime/types.js";

describe("lane separation", () => {
  it("treats LP execution actions as state-changing execution-only actions", () => {
    const exec = new Set(getExecutionLaneToolNames());
    const conv = new Set(getConversationLaneToolNames());

    expect(STATE_CHANGING_ACTIONS.has("depositLpPosition")).toBe(true);
    expect(STATE_CHANGING_ACTIONS.has("withdrawLpPosition")).toBe(true);
    expect(exec.has("depositLpPosition")).toBe(true);
    expect(exec.has("withdrawLpPosition")).toBe(true);
    expect(conv.has("depositLpPosition")).toBe(false);
    expect(conv.has("withdrawLpPosition")).toBe(false);
  });

  it("treats owner withdrawal actions as state-changing execution-only actions", () => {
    const exec = new Set(getExecutionLaneToolNames());
    const conv = new Set(getConversationLaneToolNames());

    expect(STATE_CHANGING_ACTIONS.has("withdrawToOwner")).toBe(true);
    expect(STATE_CHANGING_ACTIONS.has("sweepToOwner")).toBe(true);
    expect(exec.has("withdrawToOwner")).toBe(true);
    expect(exec.has("sweepToOwner")).toBe(true);
    expect(conv.has("withdrawToOwner")).toBe(false);
    expect(conv.has("sweepToOwner")).toBe(false);
  });

  it("conversation lane tool list must not include any state-changing action", () => {
    const conv = getConversationLaneToolNames();
    for (const name of conv) {
      expect(STATE_CHANGING_ACTIONS.has(name)).toBe(false);
    }
  });

  it("execution lane exposes superset including mutations", () => {
    const exec = new Set(getExecutionLaneToolNames());
    for (const m of STATE_CHANGING_ACTIONS) {
      expect(exec.has(m)).toBe(true);
    }
  });

  it("PolicyGate rejects state-changing intents on conversation lane", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set()) });
    const intent: RuntimeIntent = {
      id: "1",
      lane: "conversation",
      action: "deposit",
      payload: {},
      entrySource: "telegram",
    };
    const r = gate.evaluate(intent, { lifecycle: "READY", executionPaused: false });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LANE_VIOLATION");
  });

  it("PolicyGate rejects unknown non-state-changing intents on conversation lane", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set()) });
    const intent: RuntimeIntent = {
      id: "2",
      lane: "conversation",
      action: "explainPortfolioIdea",
      payload: {},
      entrySource: "telegram",
    };
    const r = gate.evaluate(intent, { lifecycle: "READY", executionPaused: false });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LANE_VIOLATION");
  });

  it("PolicyGate rejects LP execution intents on conversation lane", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set(["uniswap-v3"])) });
    const intent: RuntimeIntent = {
      id: "3",
      lane: "conversation",
      action: "depositLpPosition",
      payload: { protocol: "uniswap-v3" },
      entrySource: "telegram",
      target: "uniswap-v3",
    };
    const r = gate.evaluate(intent, { lifecycle: "READY", executionPaused: false });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LANE_VIOLATION");
  });

  it("PolicyGate rejects owner withdrawal intents on conversation lane", () => {
    const gate = new PolicyGate({ whitelist: new WhitelistPolicy(new Set(["pool"])) });
    const intent: RuntimeIntent = {
      id: "4",
      lane: "conversation",
      action: "withdrawToOwner",
      payload: { chain: "base", token: "USDC", amount: "1" },
      entrySource: "telegram",
      target: "pool",
    };
    const r = gate.evaluate(intent, { lifecycle: "READY", executionPaused: false });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LANE_VIOLATION");
  });
});
