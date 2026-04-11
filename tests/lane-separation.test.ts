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
});
