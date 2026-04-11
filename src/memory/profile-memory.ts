import { LocalDb } from "../storage/local-db.js";
import type { MemoryFreshness } from "./conversation-memory.js";

export type ProfileFactRecord = MemoryFreshness & {
  key: string;
  value: string;
};

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Durable strategy-facing facts with freshness metadata; backed by `LocalDb`.
 */
export class ProfileMemory {
  constructor(private readonly db: LocalDb<ProfileFactRecord>) {}

  setFact(
    key: string,
    value: string,
    opts?: {
      pinned?: boolean;
      confidence?: number;
      lastConfirmedAt?: string;
    },
  ): void {
    const now = isoNow();
    const existing = this.getFact(key);
    this.db.upsert(
      (r) => r.key === key,
      {
        key,
        value,
        createdAt: existing?.createdAt ?? now,
        lastAccessedAt: now,
        lastConfirmedAt: opts?.lastConfirmedAt ?? existing?.lastConfirmedAt,
        confidence: opts?.confidence ?? existing?.confidence ?? 1,
        pinned: opts?.pinned ?? existing?.pinned ?? false,
      },
    );
  }

  getFact(key: string): ProfileFactRecord | undefined {
    return this.db.getAll().find((r) => r.key === key);
  }

  touch(key: string): void {
    const now = isoNow();
    this.db.update(
      (r) => r.key === key,
      (r) => ({ ...r, lastAccessedAt: now }),
    );
  }

  list(): readonly ProfileFactRecord[] {
    return this.db.getAll();
  }
}
