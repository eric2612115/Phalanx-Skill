import { randomUUID } from "node:crypto";
import type { RuntimeIntent } from "./types.js";
import type { PendingOperationsTracker } from "./pending-operations.js";

export interface PendingApprovalRecord {
  readonly id: string;
  readonly intent: RuntimeIntent;
  readonly fingerprint: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly originatingIntentId: string;
  readonly executionSegment: string;
}

export interface CreatePendingApprovalMeta {
  readonly originatingIntentId?: string;
  readonly executionSegment?: string;
  readonly ttlMs?: number;
}

export type ApprovalInspectResult =
  | { readonly kind: "open"; readonly record: PendingApprovalRecord }
  | { readonly kind: "missing" }
  | { readonly kind: "consumed"; readonly resolution: "approved" | "rejected" | "expired" }
  | { readonly kind: "expired_open"; readonly record: PendingApprovalRecord };

export interface ApprovalRouterOptions {
  readonly maxPendingApprovals?: number;
  /** Default TTL for open approvals (wall clock). */
  readonly defaultApprovalTtlMs?: number;
  readonly maxConsumedTombstones?: number;
}

type InternalRecord = PendingApprovalRecord & {
  state: "open" | "consumed";
  consumedResolution?: "approved" | "rejected" | "expired";
};

/**
 * Channel-agnostic approval queue. Telegram/MCP wire into this router; they do not own approval state.
 * Retention is bounded in-memory. Consumed approvals are tombstoned briefly to reject duplicate resume.
 */
export class ApprovalRouter {
  private readonly store = new Map<string, InternalRecord>();

  constructor(private readonly options: ApprovalRouterOptions = {}) {}

  createPending(
    intent: RuntimeIntent,
    fingerprint: string,
    meta: CreatePendingApprovalMeta = {},
  ): PendingApprovalRecord {
    const maxPendingApprovals = this.options.maxPendingApprovals ?? 1000;
    const openCount = [...this.store.values()].filter((r) => r.state === "open").length;
    if (openCount >= maxPendingApprovals) {
      throw new Error("Too many pending approvals; resolve or clear existing requests first");
    }

    const ttlMs = meta.ttlMs ?? this.options.defaultApprovalTtlMs ?? 86_400_000;
    const now = Date.now();
    const id = randomUUID();
    const rec: InternalRecord = {
      id,
      intent,
      fingerprint,
      createdAt: now,
      expiresAt: now + ttlMs,
      originatingIntentId: meta.originatingIntentId ?? intent.id,
      executionSegment: meta.executionSegment ?? "protocol_execution",
      state: "open",
    };
    this.store.set(id, rec);
    this.pruneConsumedIfNeeded();
    return rec;
  }

  /**
   * Inspect an approval for resume: open (valid), expired-open, consumed tombstone, or missing.
   */
  inspectApproval(approvalId: string, nowMs: number): ApprovalInspectResult {
    const rec = this.store.get(approvalId);
    if (!rec) {
      return { kind: "missing" };
    }
    if (rec.state === "consumed") {
      return { kind: "consumed", resolution: rec.consumedResolution ?? "approved" };
    }
    if (nowMs >= rec.expiresAt) {
      return { kind: "expired_open", record: rec };
    }
    return { kind: "open", record: rec };
  }

  /**
   * Active pending record for diagnostics (open + not expired by wall clock).
   */
  get(approvalId: string): PendingApprovalRecord | undefined {
    const rec = this.store.get(approvalId);
    if (!rec || rec.state !== "open") {
      return undefined;
    }
    if (Date.now() >= rec.expiresAt) {
      return undefined;
    }
    return rec;
  }

  expireIfNeeded(approvalId: string, pendingOps: PendingOperationsTracker): PendingApprovalRecord | undefined {
    const rec = this.store.get(approvalId);
    if (!rec || rec.state !== "open") {
      return undefined;
    }
    if (Date.now() < rec.expiresAt) {
      return undefined;
    }
    rec.state = "consumed";
    rec.consumedResolution = "expired";
    pendingOps.release(rec.fingerprint);
    this.pruneConsumedIfNeeded();
    return rec;
  }

  consume(approvalId: string, resolution: "approved" | "rejected" | "expired"): void {
    const rec = this.store.get(approvalId);
    if (!rec || rec.state !== "open") {
      return;
    }
    rec.state = "consumed";
    rec.consumedResolution = resolution;
    this.pruneConsumedIfNeeded();
  }

  /**
   * Remove an open approval entirely (Telegram notify rollback). Does not tombstone.
   */
  deleteOpen(approvalId: string): void {
    const rec = this.store.get(approvalId);
    if (!rec || rec.state !== "open") {
      return;
    }
    this.store.delete(approvalId);
  }

  /** @deprecated Use deleteOpen */
  remove(approvalId: string): void {
    this.deleteOpen(approvalId);
  }

  /** Test helper: count of open approvals (not expired for size metric). */
  size(): number {
    const now = Date.now();
    return [...this.store.values()].filter((r) => r.state === "open" && now < r.expiresAt).length;
  }

  private pruneConsumedIfNeeded(): void {
    const maxTombstones = this.options.maxConsumedTombstones ?? 500;
    const consumedIds: string[] = [];
    for (const [id, rec] of this.store) {
      if (rec.state === "consumed") {
        consumedIds.push(id);
      }
    }
    if (consumedIds.length <= maxTombstones) {
      return;
    }
    const drop = consumedIds.length - maxTombstones;
    for (let i = 0; i < drop; i += 1) {
      const id = consumedIds[i];
      if (id) {
        this.store.delete(id);
      }
    }
  }
}
