import { randomUUID } from "node:crypto";
import type { RuntimeIntent } from "./types.js";

export interface PendingApprovalRecord {
  readonly id: string;
  readonly intent: RuntimeIntent;
  readonly fingerprint: string;
  readonly createdAt: number;
}

export interface ApprovalRouterOptions {
  readonly maxPendingApprovals?: number;
}

/**
 * Channel-agnostic approval queue. Telegram/MCP wire into this router; they do not own approval state.
 * Retention is intentionally bounded in-memory for Task 6 to avoid silent unbounded growth.
 */
export class ApprovalRouter {
  private readonly byId = new Map<string, PendingApprovalRecord>();

  constructor(private readonly options: ApprovalRouterOptions = {}) {}

  createPending(intent: RuntimeIntent, fingerprint: string): PendingApprovalRecord {
    const maxPendingApprovals = this.options.maxPendingApprovals ?? 1000;
    if (this.byId.size >= maxPendingApprovals) {
      throw new Error("Too many pending approvals; resolve or clear existing requests first");
    }

    const id = randomUUID();
    const rec: PendingApprovalRecord = {
      id,
      intent,
      fingerprint,
      createdAt: Date.now(),
    };
    this.byId.set(id, rec);
    return rec;
  }

  get(approvalId: string): PendingApprovalRecord | undefined {
    return this.byId.get(approvalId);
  }

  remove(approvalId: string): void {
    this.byId.delete(approvalId);
  }

  /** Test helper: count of open approvals. */
  size(): number {
    return this.byId.size;
  }
}
