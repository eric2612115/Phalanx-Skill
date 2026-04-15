import type { PolicyContext, RuntimeIntent, RuntimeOutcome } from "./types.js";
import type { RiskEvaluationContext } from "../risk/context.js";
import type { PolicyGate } from "../policy/gate.js";
import type { RiskEngine } from "../risk/engine.js";
import type { ApprovalPolicy } from "../policy/approval-policy.js";
import { fingerprintForPending, isStateChangingAction } from "./intents.js";
import { ApprovalRouter } from "./approval-router.js";
import { inferExecutionSegment } from "./approval-resume.js";
import { PendingOperationsTracker } from "./pending-operations.js";
import { buildRuntimeEvent, extractRuntimeExecutionEvidence, extractRuntimeTxRefs, type RuntimeEvent } from "./events.js";

export interface ExecutionAdapter {
  execute(intent: RuntimeIntent): Promise<unknown>;
}

export interface RuntimeCoreDeps {
  readonly policyGate: PolicyGate;
  readonly riskEngine: RiskEngine;
  readonly approvalPolicy: ApprovalPolicy;
  readonly approvalRouter: ApprovalRouter;
  readonly pendingOps: PendingOperationsTracker;
  readonly executor: ExecutionAdapter;
  readonly emitEvent?: (event: RuntimeEvent) => void | Promise<void>;
  getPolicyContext(): PolicyContext;
  getRiskContext(): RiskEvaluationContext;
}

/**
 * Central orchestrator: PolicyGate -> RiskEngine -> approval class -> ApprovalRouter or ExecutionAdapter.
 */
export class RuntimeCore {
  constructor(private readonly deps: RuntimeCoreDeps) {}

  private async emitEvent(event: RuntimeEvent): Promise<void> {
    await this.deps.emitEvent?.(event);
  }

  async handleIntent(intent: RuntimeIntent): Promise<RuntimeOutcome> {
    await this.emitEvent(
      buildRuntimeEvent(intent, "intent_received", {
        summary: `Runtime received ${intent.action} intent`,
      }),
    );
    const policyCtx = this.deps.getPolicyContext();
    const riskCtx = this.deps.getRiskContext();

    const policyResult = this.deps.policyGate.evaluate(intent, policyCtx);
    if (!policyResult.ok) {
      await this.emitEvent(
        buildRuntimeEvent(intent, "blocked", {
          summary: policyResult.message ?? "Blocked by policy",
          reason: policyResult.code,
        }),
      );
      return {
        type: "blocked",
        intentId: intent.id,
        stage: "policy",
        code: policyResult.code ?? "POLICY_BLOCK",
        message: policyResult.message ?? "Blocked by policy",
      };
    }

    const riskResult = this.deps.riskEngine.evaluate(intent, riskCtx);
    if (!riskResult.ok) {
      await this.emitEvent(
        buildRuntimeEvent(intent, "blocked", {
          summary: riskResult.message ?? "Blocked by risk engine",
          reason: riskResult.code,
        }),
      );
      return {
        type: "blocked",
        intentId: intent.id,
        stage: "risk",
        code: riskResult.code ?? "RISK_BLOCK",
        message: riskResult.message ?? "Blocked by risk engine",
      };
    }

    const approvalClass = this.deps.approvalPolicy.classify(intent);
    if (approvalClass === "AUTO_BLOCK") {
      await this.emitEvent(
        buildRuntimeEvent(intent, "blocked", {
          summary: "Action is not allowed",
          reason: "AUTO_BLOCK",
        }),
      );
      return {
        type: "blocked",
        intentId: intent.id,
        stage: "approval_class",
        code: "AUTO_BLOCK",
        message: "Action is not allowed",
      };
    }

    const fp = fingerprintForPending(intent);

    if (approvalClass === "REQUIRE_APPROVAL") {
      const hold = this.deps.pendingOps.tryBegin(fp);
      if (!hold.ok) {
        await this.emitEvent(
          buildRuntimeEvent(intent, "rejected", {
            summary: "An overlapping operation is already in flight",
            reason: hold.reason,
          }),
        );
        return {
          type: "rejected",
          intentId: intent.id,
          code: hold.reason,
          message: "An overlapping operation is already in flight",
        };
      }
      let pending;
      try {
        pending = this.deps.approvalRouter.createPending(intent, fp, {
          originatingIntentId: intent.id,
          executionSegment: inferExecutionSegment(intent),
        });
      } catch (error) {
        this.deps.pendingOps.release(fp);
        throw error;
      }
      await this.emitEvent(
        buildRuntimeEvent(intent, "awaiting_approval", {
          approvalId: pending.id,
          summary: `Approval required for ${intent.action}`,
        }),
      );
      return {
        type: "pending_approval",
        intentId: intent.id,
        approvalId: pending.id,
      };
    }

    if (isStateChangingAction(intent.action)) {
      const hold = this.deps.pendingOps.tryBegin(fp);
      if (!hold.ok) {
        await this.emitEvent(
          buildRuntimeEvent(intent, "rejected", {
            summary: "An overlapping operation is already in flight",
            reason: hold.reason,
          }),
        );
        return {
          type: "rejected",
          intentId: intent.id,
          code: hold.reason,
          message: "An overlapping operation is already in flight",
        };
      }
      try {
        const adapterResult = await this.deps.executor.execute(intent);
        await this.emitEvent(
          buildRuntimeEvent(intent, "executed", {
            summary: `Executed ${intent.action}`,
            txRefs: extractRuntimeTxRefs(adapterResult),
            executionEvidence: extractRuntimeExecutionEvidence(adapterResult),
          }),
        );
        return { type: "executed", intentId: intent.id, adapterResult };
      } finally {
        this.deps.pendingOps.release(fp);
      }
    }

    const adapterResult = await this.deps.executor.execute(intent);
    await this.emitEvent(
      buildRuntimeEvent(intent, "executed", {
        summary: `Executed ${intent.action}`,
        txRefs: extractRuntimeTxRefs(adapterResult),
        executionEvidence: extractRuntimeExecutionEvidence(adapterResult),
      }),
    );
    return { type: "executed", intentId: intent.id, adapterResult };
  }

  /**
   * After external approval, re-run policy and risk then execute. Releases pending fingerprint on completion.
   */
  async submitApprovalDecision(approvalId: string, approved: boolean): Promise<RuntimeOutcome> {
    const now = Date.now();
    const inspected = this.deps.approvalRouter.inspectApproval(approvalId, now);

    if (inspected.kind === "missing") {
      return {
        type: "rejected",
        intentId: "",
        code: "UNKNOWN_APPROVAL",
        message: "No pending approval for id",
      };
    }

    if (inspected.kind === "consumed") {
      return {
        type: "rejected",
        intentId: "",
        code: "APPROVAL_ALREADY_CONSUMED",
        message: "This approval was already resolved and cannot be reused",
      };
    }

    if (inspected.kind === "expired_open") {
      const rec = inspected.record;
      this.deps.approvalRouter.consume(approvalId, "expired");
      this.deps.pendingOps.release(rec.fingerprint);
      await this.emitEvent(
        buildRuntimeEvent(rec.intent, "rejected", {
          approvalId,
          summary: "Approval expired before resume",
          reason: "APPROVAL_EXPIRED",
        }),
      );
      return {
        type: "rejected",
        intentId: rec.intent.id,
        code: "APPROVAL_EXPIRED",
        message: "Approval request expired; submit a new intent",
      };
    }

    const rec = inspected.record;
    const intent = rec.intent;
    const fp = rec.fingerprint;

    if (!approved) {
      this.deps.approvalRouter.consume(approvalId, "rejected");
      this.deps.pendingOps.release(fp);
      await this.emitEvent(
        buildRuntimeEvent(intent, "rejected", {
          approvalId,
          summary: "User rejected approval",
          reason: "APPROVAL_REJECTED",
        }),
      );
      return {
        type: "rejected",
        intentId: intent.id,
        code: "APPROVAL_REJECTED",
        message: "User rejected approval",
      };
    }

    const policyCtx = this.deps.getPolicyContext();
    const riskCtx = this.deps.getRiskContext();

    const policyResult = this.deps.policyGate.evaluate(intent, policyCtx);
    if (!policyResult.ok) {
      this.deps.approvalRouter.consume(approvalId, "rejected");
      this.deps.pendingOps.release(fp);
      await this.emitEvent(
        buildRuntimeEvent(intent, "blocked", {
          approvalId,
          summary: policyResult.message ?? "Blocked by policy on resume",
          reason: policyResult.code,
        }),
      );
      return {
        type: "blocked",
        intentId: intent.id,
        stage: "policy",
        code: policyResult.code ?? "POLICY_BLOCK",
        message: policyResult.message ?? "Blocked by policy on resume",
      };
    }

    const riskResult = this.deps.riskEngine.evaluate(intent, riskCtx);
    if (!riskResult.ok) {
      this.deps.approvalRouter.consume(approvalId, "rejected");
      this.deps.pendingOps.release(fp);
      await this.emitEvent(
        buildRuntimeEvent(intent, "blocked", {
          approvalId,
          summary: riskResult.message ?? "Blocked by risk engine on resume",
          reason: riskResult.code,
        }),
      );
      return {
        type: "blocked",
        intentId: intent.id,
        stage: "risk",
        code: riskResult.code ?? "RISK_BLOCK",
        message: riskResult.message ?? "Blocked by risk engine on resume",
      };
    }

    this.deps.approvalRouter.consume(approvalId, "approved");
    try {
      await this.emitEvent(
        buildRuntimeEvent(intent, "approval_resumed", {
          approvalId,
          summary: `Approval granted for ${intent.action}`,
        }),
      );
      const adapterResult = await this.deps.executor.execute(intent);
      await this.emitEvent(
        buildRuntimeEvent(intent, "executed", {
          approvalId,
          summary: `Executed ${intent.action}`,
          txRefs: extractRuntimeTxRefs(adapterResult),
          executionEvidence: extractRuntimeExecutionEvidence(adapterResult),
        }),
      );
      return { type: "executed", intentId: intent.id, adapterResult };
    } finally {
      this.deps.pendingOps.release(fp);
    }
  }
}
