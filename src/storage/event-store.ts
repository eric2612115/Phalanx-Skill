import { readFileSync } from "node:fs";
import { atomicWriteFile } from "./file-utils.js";

/** Event row with required freshness metadata (matches memory policy). */
export interface EventRecord<TPayload> {
  seq: number;
  payload: TPayload;
  createdAt: string;
  lastAccessedAt: string;
  lastConfirmedAt?: string;
  confidence: number;
  pinned: boolean;
}

/**
 * Append-only local event log with a hard cap.
 * Eviction is explicit: drop oldest unpinned rows first; if every row is pinned,
 * still enforce the cap by dropping the oldest pinned rows.
 */
export class EventStore<TPayload> {
  private rows: EventRecord<TPayload>[] = [];
  private nextSeq = 1;

  constructor(
    private readonly filePath: string,
    private readonly maxEvents: number,
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        this.rows = [];
        this.nextSeq = 1;
        return;
      }
      this.rows = parsed as EventRecord<TPayload>[];
      let max = 0;
      for (const r of this.rows) {
        if (typeof r.seq === "number" && r.seq > max) max = r.seq;
      }
      this.nextSeq = max + 1;
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") {
        this.rows = [];
        this.nextSeq = 1;
        return;
      }
      if (e instanceof SyntaxError) {
        this.rows = [];
        this.nextSeq = 1;
        return;
      }
      throw e;
    }
  }

  private persist(): void {
    atomicWriteFile(this.filePath, `${JSON.stringify(this.rows)}\n`);
  }

  private enforceCap(): void {
    let overflow = this.rows.length - this.maxEvents;
    if (overflow <= 0) {
      return;
    }

    const survivors: EventRecord<TPayload>[] = [];
    for (const row of this.rows) {
      if (overflow > 0 && !row.pinned) {
        overflow -= 1;
        continue;
      }
      survivors.push(row);
    }

    this.rows = survivors.slice(Math.max(0, survivors.length - this.maxEvents));
  }

  append(
    payload: TPayload,
    opts?: {
      pinned?: boolean;
      confidence?: number;
      lastConfirmedAt?: string;
    },
  ): EventRecord<TPayload> {
    const now = new Date().toISOString();
    const row: EventRecord<TPayload> = {
      seq: this.nextSeq++,
      payload,
      createdAt: now,
      lastAccessedAt: now,
      lastConfirmedAt: opts?.lastConfirmedAt,
      confidence: opts?.confidence ?? 1,
      pinned: opts?.pinned ?? false,
    };
    this.rows.push(row);
    this.enforceCap();
    this.persist();
    return row;
  }

  /** Last N events, newest last; refreshes `lastAccessedAt` on returned rows. */
  tail(limit: number): EventRecord<TPayload>[] {
    const now = new Date().toISOString();
    const start = Math.max(0, this.rows.length - limit);
    const out: EventRecord<TPayload>[] = [];
    for (let i = start; i < this.rows.length; i++) {
      const updated = { ...this.rows[i]!, lastAccessedAt: now };
      this.rows[i] = updated;
      out.push(updated);
    }
    if (out.length > 0) this.persist();
    return out;
  }

  getAll(): readonly EventRecord<TPayload>[] {
    return this.rows;
  }
}
