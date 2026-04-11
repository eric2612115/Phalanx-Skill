import type {
  ConversationMemoryState,
  ConversationSummary,
  ConversationTurn,
} from "./conversation-memory.js";

function normalizeTurn(
  e: ConversationMemoryState["recent"][number],
  forcePinned?: boolean,
): ConversationTurn {
  const now = new Date().toISOString();
  const pinned = forcePinned === true ? true : (e.pinned ?? false);
  return {
    text: e.text,
    createdAt: e.createdAt ?? now,
    lastAccessedAt: e.lastAccessedAt ?? now,
    lastConfirmedAt: e.lastConfirmedAt,
    confidence: e.confidence ?? 1,
    pinned,
  };
}

function summaryFromStale(stale: ConversationTurn[]): ConversationSummary {
  const now = new Date().toISOString();
  const parts = stale.map((s) => s.text);
  let summary = parts.join(" | ");
  if (summary.length > 2000) {
    summary = `${summary.slice(0, 1997)}...`;
  }
  if (summary.length === 0) {
    summary = "older chat compacted";
  }
  const confidences = stale.map((s) => s.confidence);
  const confidence = confidences.length > 0 ? Math.min(...confidences) : 1;
  return {
    summary,
    createdAt: now,
    lastAccessedAt: now,
    confidence,
    pinned: false,
  };
}

/**
 * Summary-first compaction: unpinned stale turns collapse into one or more summaries;
 * pinned durable facts in `pinned` and any stale row marked pinned are preserved verbatim.
 */
export function compactConversationMemory(state: ConversationMemoryState): {
  pinned: ConversationTurn[];
  summaries: ConversationSummary[];
  recent: ConversationTurn[];
} {
  const recent = state.recent.map((r) => normalizeTurn(r));
  const pinnedInput = state.pinned.map((p) => normalizeTurn(p, true));

  const promoted: ConversationTurn[] = [];
  const staleUnpinned: ConversationTurn[] = [];
  for (const s of state.stale) {
    const n = normalizeTurn(s);
    if (n.pinned) {
      promoted.push({ ...n, pinned: true });
    } else {
      staleUnpinned.push(n);
    }
  }

  const summaries: ConversationSummary[] = [];
  if (staleUnpinned.length > 0) {
    summaries.push(summaryFromStale(staleUnpinned));
  }

  const pinnedByText = new Map<string, ConversationTurn>();
  for (const p of [...pinnedInput, ...promoted]) {
    pinnedByText.set(p.text, { ...p, pinned: true });
  }
  const pinned = [...pinnedByText.values()];

  return {
    pinned,
    summaries,
    recent,
  };
}
