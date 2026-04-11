import { LocalDb } from "../storage/local-db.js";
import type { MemoryFreshness } from "./conversation-memory.js";

export type OperationalRecord = MemoryFreshness & {
  opId: string;
  phase: string;
  detail: string;
};

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Short-lived operational state (pending steps, adapter handshakes) with bounds via `LocalDb`.
 */
export class OperationalMemory {
  constructor(private readonly db: LocalDb<OperationalRecord>) {}

  upsert(record: Omit<OperationalRecord, keyof MemoryFreshness> & Partial<MemoryFreshness>): void {
    const now = isoNow();
    const full: OperationalRecord = {
      opId: record.opId,
      phase: record.phase,
      detail: record.detail,
      createdAt: record.createdAt ?? now,
      lastAccessedAt: record.lastAccessedAt ?? now,
      lastConfirmedAt: record.lastConfirmedAt,
      confidence: record.confidence ?? 1,
      pinned: record.pinned ?? false,
    };
    this.db.upsert((r) => r.opId === record.opId, full);
  }

  touch(opId: string): void {
    const now = isoNow();
    this.db.update(
      (r) => r.opId === opId,
      (r) => ({ ...r, lastAccessedAt: now }),
    );
  }

  get(opId: string): OperationalRecord | undefined {
    return this.db.getAll().find((r) => r.opId === opId);
  }

  remove(opId: string): void {
    const next = this.db.getAll().filter((r) => r.opId !== opId);
    this.db.replaceAll([...next]);
  }

  list(): readonly OperationalRecord[] {
    return this.db.getAll();
  }
}
