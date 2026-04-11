import { describe, expect, it } from "vitest";
import { RiskEngine } from "../src/risk/engine.js";
import type { RuntimeIntent } from "../src/runtime/types.js";

function intent(payload: Record<string, unknown> = {}): RuntimeIntent {
  return {
    id: "r1",
    lane: "execution",
    action: "deposit",
    payload,
    entrySource: "mcp",
  };
}

describe("RiskEngine", () => {
  it("returns the same result for the same intent and context (deterministic)", () => {
    const engine = new RiskEngine();
    const ctx = { now: 1_700_000_000_000 };
    const a = engine.evaluate(intent({}), ctx);
    const b = engine.evaluate(intent({}), ctx);
    expect(a).toEqual(b);
  });

  it("fails operational rule on stale data flag", () => {
    const engine = new RiskEngine();
    const r = engine.evaluate(intent({ dataStale: true }), { now: 1 });
    expect(r.ok).toBe(false);
    expect(r.failedRule).toBe("operational");
    expect(r.code).toBe("STALE_DATA");
  });

  it("fails allocation rule on drift", () => {
    const engine = new RiskEngine();
    const r = engine.evaluate(intent({ allocationDriftBps: 600 }), { now: 1 });
    expect(r.ok).toBe(false);
    expect(r.failedRule).toBe("allocation");
    expect(r.code).toBe("ALLOCATION_DRIFT");
  });

  it("fails lending rule on low health", () => {
    const engine = new RiskEngine();
    const r = engine.evaluate(intent({ lendingHealthScore: 0.1 }), { now: 1 });
    expect(r.ok).toBe(false);
    expect(r.failedRule).toBe("lending");
    expect(r.code).toBe("LENDING_HEALTH");
  });

  it("fails lp rule when strict and out of range", () => {
    const engine = new RiskEngine();
    const r = engine.evaluate(intent({ lpStrictRange: true, lpInRange: false }), { now: 1 });
    expect(r.ok).toBe(false);
    expect(r.failedRule).toBe("lp");
    expect(r.code).toBe("LP_OUT_OF_RANGE");
  });
});
