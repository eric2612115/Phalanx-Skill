import { describe, expect, it } from "vitest";

import { executeExecutionPlan, type ExecutionPlanStep } from "../src/execution/coordinator.ts";

describe("execution coordinator", () => {
  it("waits for SUCCESS before running the next step", async () => {
    const calls: string[] = [];
    const plan: ExecutionPlanStep<string>[] = [
      { id: "approve", summary: "approve", payload: "approve" },
      { id: "deposit", summary: "deposit", payload: "deposit" },
    ];
    let polls = 0;

    const result = await executeExecutionPlan(plan, {
      confirmationPolicy: {
        isSuccess: (progress) => progress.txStatus === "SUCCESS",
        isFailure: (progress) => progress.txStatus === "ERROR" || progress.txStatus === "FAILED",
        summarizeFailure: (progress) => progress.failReason ?? progress.txStatus,
      },
      delayImpl: async () => {},
      executeStep: async (step) => {
        calls.push(`execute:${step.id}`);
        return { step, txHash: `${step.id}-tx` };
      },
      readProgress: async (broadcast) => {
        calls.push(`poll:${broadcast.step.id}`);
        polls += 1;
        if (broadcast.step.id === "approve" && polls === 1) {
          return { txHash: broadcast.txHash, txStatus: "PENDING" };
        }
        return { txHash: broadcast.txHash, txStatus: "SUCCESS" };
      },
    });

    expect(result.status).toBe("completed");
    expect(calls).toEqual([
      "execute:approve",
      "poll:approve",
      "poll:approve",
      "execute:deposit",
      "poll:deposit",
    ]);
  });

  it("fails immediately when progress reaches ERROR", async () => {
    const plan: ExecutionPlanStep<string>[] = [{ id: "approve", summary: "approve", payload: "approve" }];

    const result = await executeExecutionPlan(plan, {
      confirmationPolicy: {
        isSuccess: (progress) => progress.txStatus === "SUCCESS",
        isFailure: (progress) => progress.txStatus === "ERROR" || progress.txStatus === "FAILED",
        summarizeFailure: (progress) => progress.failReason ?? progress.txStatus,
      },
      delayImpl: async () => {},
      executeStep: async (step) => ({ step, txHash: `${step.id}-tx` }),
      readProgress: async (broadcast) => ({
        txHash: broadcast.txHash,
        txStatus: "ERROR",
        failReason: "replacement transaction underpriced",
      }),
    });

    expect(result.status).toBe("failed");
    if (result.status === "completed") {
      throw new Error("expected failure");
    }
    expect(result.summary).toMatch(/underpriced/i);
    expect(result.failedStep?.id).toBe("approve");
  });
});
