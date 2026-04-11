import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { LocalDb } from "../src/storage/local-db";
import { EventStore } from "../src/storage/event-store";
import type { ProfileFactRecord } from "../src/memory/profile-memory";
import { ProfileMemory } from "../src/memory/profile-memory";
import { OperationalMemory } from "../src/memory/operational-memory";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "phalanx-mem-"));
}

describe("memory compactor", () => {
  it("replaces stale conversation entries with summaries while keeping pinned facts", async () => {
    const { compactConversationMemory } = await import("../src/memory/compactor.js");
    const result = await compactConversationMemory({
      recent: [{ text: "latest", pinned: false }],
      stale: [{ text: "old", pinned: false }],
      pinned: [{ text: "riskProfile=balanced", pinned: true }],
    });
    expect(result.pinned).toHaveLength(1);
    expect(result.summaries.length).toBeGreaterThan(0);
    expect(result.pinned[0]?.text).toBe("riskProfile=balanced");
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0]?.text).toBe("latest");
  });

  it("promotes pinned rows from stale into pinned and still summarizes unpinned stale", async () => {
    const { compactConversationMemory } = await import("../src/memory/compactor.js");
    const result = await compactConversationMemory({
      recent: [],
      stale: [
        { text: "ephemeral", pinned: false },
        { text: "must-keep", pinned: true },
      ],
      pinned: [],
    });
    expect(result.pinned).toHaveLength(1);
    expect(result.pinned[0]?.text).toBe("must-keep");
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.summary).toContain("ephemeral");
    expect(result.summaries[0]?.summary).not.toContain("must-keep");
  });

  it("does not emit summaries when there is no unpinned stale content", async () => {
    const { compactConversationMemory } = await import("../src/memory/compactor.js");
    const result = await compactConversationMemory({
      recent: [{ text: "x", pinned: false }],
      stale: [],
      pinned: [],
    });
    expect(result.summaries).toHaveLength(0);
  });
});

describe("LocalDb bounds", () => {
  it("drops least-recently-accessed rows when over maxEntries", () => {
    const dir = tempDir();
    try {
      const path = join(dir, "db.json");
      type Row = { id: string; lastAccessedAt: string };
      const db = new LocalDb<Row>(path, { maxEntries: 2 });
      db.upsert(() => false, { id: "a", lastAccessedAt: "2026-01-01T00:00:00.000Z" });
      db.upsert(() => false, { id: "b", lastAccessedAt: "2026-01-02T00:00:00.000Z" });
      db.upsert(() => false, { id: "c", lastAccessedAt: "2026-01-03T00:00:00.000Z" });
      const ids = db.getAll().map((r) => r.id).sort();
      expect(ids).toEqual(["b", "c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("EventStore bounds", () => {
  it("evicts unpinned events before pinned ones", () => {
    const dir = tempDir();
    try {
      const path = join(dir, "events.json");
      const store = new EventStore<string>(path, 2);
      store.append("u1", { pinned: false });
      store.append("u2", { pinned: false });
      store.append("p1", { pinned: true });
      const payloads = store.getAll().map((r) => r.payload);
      expect(payloads).toContain("p1");
      expect(payloads).not.toContain("u1");
      expect(store.getAll()).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evicts the oldest pinned event when overflow happens with only pinned rows", () => {
    const dir = tempDir();
    try {
      const path = join(dir, "events.json");
      const store = new EventStore<string>(path, 2);
      store.append("p1", { pinned: true });
      store.append("p2", { pinned: true });
      store.append("p3", { pinned: true });
      expect(store.getAll().map((r) => r.payload)).toEqual(["p2", "p3"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ProfileMemory freshness", () => {
  it("persists facts with createdAt, lastAccessedAt, confidence, pinned", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "profile.json");
      const db = new LocalDb<ProfileFactRecord>(path, { maxEntries: 100 });
      const mem = new ProfileMemory(db);
      mem.setFact("risk", "balanced", { pinned: true, confidence: 0.9 });
      const fact = mem.getFact("risk");
      expect(fact).toBeDefined();
      expect(fact?.pinned).toBe(true);
      expect(fact?.confidence).toBe(0.9);
      expect(fact?.createdAt).toMatch(/^\d{4}-/);
      expect(fact?.lastAccessedAt).toMatch(/^\d{4}-/);
      await new Promise((r) => setTimeout(r, 5));
      mem.touch("risk");
      const touched = mem.getFact("risk");
      expect(touched?.lastAccessedAt).not.toBe(fact?.lastAccessedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves createdAt when updating an existing fact", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "profile.json");
      const db = new LocalDb<ProfileFactRecord>(path, { maxEntries: 100 });
      const mem = new ProfileMemory(db);
      mem.setFact("risk", "balanced", { pinned: true, confidence: 0.9 });
      const first = mem.getFact("risk");
      await new Promise((r) => setTimeout(r, 5));
      mem.setFact("risk", "aggressive", { pinned: true, confidence: 0.7 });
      const second = mem.getFact("risk");
      expect(second?.value).toBe("aggressive");
      expect(second?.createdAt).toBe(first?.createdAt);
      expect(second?.lastAccessedAt).not.toBe(first?.lastAccessedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("OperationalMemory", () => {
  it("stores operational rows with freshness fields", () => {
    const dir = tempDir();
    try {
      const path = join(dir, "ops.json");
      const db = new LocalDb<import("../src/memory/operational-memory").OperationalRecord>(path, {
        maxEntries: 50,
      });
      const mem = new OperationalMemory(db);
      mem.upsert({ opId: "op-1", phase: "probe", detail: "ok" });
      const row = mem.get("op-1");
      expect(row?.confidence).toBe(1);
      expect(row?.pinned).toBe(false);
      expect(row?.createdAt).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
