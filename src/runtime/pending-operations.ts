/**
 * Tracks in-flight operation keys to reject overlapping duplicates.
 */
export class PendingOperationsTracker {
  private readonly keys = new Set<string>();

  tryBegin(key: string): { ok: true } | { ok: false; reason: "DUPLICATE_PENDING" } {
    if (this.keys.has(key)) {
      return { ok: false, reason: "DUPLICATE_PENDING" };
    }
    this.keys.add(key);
    return { ok: true };
  }

  release(key: string): void {
    this.keys.delete(key);
  }

  /** Test / diagnostics only. */
  has(key: string): boolean {
    return this.keys.has(key);
  }
}
