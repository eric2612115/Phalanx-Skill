import { describe, expect, it } from "vitest";
import { PendingOperationsTracker } from "../src/runtime/pending-operations.js";
import { ApprovalRouter } from "../src/runtime/approval-router.js";
import type { RuntimeIntent } from "../src/runtime/types.js";

describe("PendingOperationsTracker", () => {
  it("rejects duplicate keys while first is held", () => {
    const t = new PendingOperationsTracker();
    expect(t.tryBegin("a")).toEqual({ ok: true });
    expect(t.tryBegin("a")).toEqual({ ok: false, reason: "DUPLICATE_PENDING" });
    t.release("a");
    expect(t.tryBegin("a")).toEqual({ ok: true });
  });
});

describe("ApprovalRouter", () => {
  it("stores pending records keyed by approval id", () => {
    const router = new ApprovalRouter();
    const intent: RuntimeIntent = {
      id: "i1",
      lane: "execution",
      action: "deposit",
      payload: { x: 1 },
      entrySource: "mcp",
    };
    const p = router.createPending(intent, "fp1");
    expect(p.intent).toBe(intent);
    expect(p.fingerprint).toBe("fp1");
    expect(router.get(p.id)).toBeDefined();
    router.remove(p.id);
    expect(router.get(p.id)).toBeUndefined();
  });

  it("rejects new approvals after the retention guard limit is reached", () => {
    const router = new ApprovalRouter({ maxPendingApprovals: 1 });
    const intent: RuntimeIntent = {
      id: "i1",
      lane: "execution",
      action: "deposit",
      payload: { x: 1 },
      entrySource: "mcp",
    };

    router.createPending(intent, "fp1");

    expect(() => router.createPending({ ...intent, id: "i2" }, "fp2")).toThrow(
      /Too many pending approvals/,
    );
  });
});
