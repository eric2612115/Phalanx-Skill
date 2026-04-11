import { readFileSync } from "node:fs";
import { atomicWriteFile } from "./file-utils.js";

export interface LocalDbOptions {
  /** Maximum rows retained; least-recently-accessed rows are dropped first. */
  maxEntries: number;
}

/**
 * Bounded JSON array persistence. Eviction uses `lastAccessedAt` (ISO string) ascending.
 */
export class LocalDb<T extends { lastAccessedAt: string }> {
  private rows: T[] = [];

  constructor(
    private readonly filePath: string,
    private readonly options: LocalDbOptions,
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.rows = Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") {
        this.rows = [];
        return;
      }
      if (e instanceof SyntaxError) {
        this.rows = [];
        return;
      }
      throw e;
    }
  }

  private enforceCap(): void {
    const max = this.options.maxEntries;
    const overflow = this.rows.length - max;
    if (overflow <= 0) {
      return;
    }

    const victims = new Set(
      this.rows
        .map((row, index) => ({ index, lastAccessedAt: row.lastAccessedAt }))
        .sort(
          (a, b) =>
            a.lastAccessedAt.localeCompare(b.lastAccessedAt) || a.index - b.index,
        )
        .slice(0, overflow)
        .map((entry) => entry.index),
    );

    this.rows = this.rows.filter((_, index) => !victims.has(index));
  }

  private persist(): void {
    atomicWriteFile(this.filePath, `${JSON.stringify(this.rows)}\n`);
  }

  /** Current rows (newest appends last; eviction does not sort file order). */
  getAll(): readonly T[] {
    return this.rows;
  }

  replaceAll(next: T[]): void {
    this.rows = [...next];
    this.enforceCap();
    this.persist();
  }

  upsert(match: (row: T) => boolean, row: T): void {
    const i = this.rows.findIndex(match);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    this.enforceCap();
    this.persist();
  }

  update(match: (row: T) => boolean, fn: (row: T) => T): void {
    const i = this.rows.findIndex(match);
    if (i < 0) return;
    this.rows[i] = fn(this.rows[i]!);
    this.enforceCap();
    this.persist();
  }
}
