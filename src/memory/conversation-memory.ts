import { compactConversationMemory } from "./compactor.js";

/** Freshness fields required on durable memory records (spec). */
export interface MemoryFreshness {
  createdAt: string;
  lastAccessedAt: string;
  lastConfirmedAt?: string;
  confidence: number;
  pinned: boolean;
}

export type ConversationTurn = MemoryFreshness & {
  text: string;
};

export type ConversationSummary = MemoryFreshness & {
  summary: string;
};

export interface ConversationMemoryState {
  recent: Array<Partial<MemoryFreshness> & { text: string; pinned?: boolean }>;
  stale: Array<Partial<MemoryFreshness> & { text: string; pinned?: boolean }>;
  pinned: Array<Partial<MemoryFreshness> & { text: string; pinned: true }>;
}

export interface CompactedConversation {
  pinned: ConversationTurn[];
  summaries: ConversationSummary[];
  recent: ConversationTurn[];
}

const MAX_SUMMARY_ENTRIES = 64;

function isoNow(): string {
  return new Date().toISOString();
}

export function createTurn(
  text: string,
  opts?: Partial<MemoryFreshness> & { pinned?: boolean },
): ConversationTurn {
  const now = opts?.createdAt ?? opts?.lastAccessedAt ?? isoNow();
  return {
    text,
    createdAt: opts?.createdAt ?? now,
    lastAccessedAt: opts?.lastAccessedAt ?? now,
    lastConfirmedAt: opts?.lastConfirmedAt,
    confidence: opts?.confidence ?? 1,
    pinned: opts?.pinned ?? false,
  };
}

/**
 * Holds recent / stale / pinned partitions plus summary outputs from compaction.
 * Bounded by caller via moving overflow from `recent` to `stale` before compact.
 */
export class ConversationMemory {
  recent: ConversationTurn[] = [];
  stale: ConversationTurn[] = [];
  pinned: ConversationTurn[] = [];
  summaries: ConversationSummary[] = [];

  addRecent(text: string, opts?: Partial<Omit<MemoryFreshness, "pinned">>): void {
    this.recent.push(createTurn(text, { ...opts, pinned: false }));
  }

  promoteToPinned(text: string, opts?: Partial<MemoryFreshness>): void {
    this.pinned.push(createTurn(text, { ...opts, pinned: true }));
  }

  touchRecent(index: number): void {
    const t = this.recent[index];
    if (!t) return;
    this.recent[index] = { ...t, lastAccessedAt: isoNow() };
  }

  compact(): CompactedConversation {
    const out = compactConversationMemory({
      recent: this.recent,
      stale: this.stale,
      pinned: this.pinned.map((p) => ({ ...p, pinned: true as const })),
    });
    this.pinned = out.pinned;
    this.recent = out.recent;
    this.stale = [];
    this.summaries = [...this.summaries, ...out.summaries].slice(-MAX_SUMMARY_ENTRIES);
    return out;
  }
}
