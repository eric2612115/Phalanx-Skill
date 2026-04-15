import { describe, expect, it } from "vitest";

import {
  TelegramJobQueue,
  buildTelegramJobCallbackData,
  parseTelegramJobCallbackData,
} from "../src/telegram/job-queue.js";

describe("telegram job queue", () => {
  it("enqueues jobs and preserves stable #1/#2/#3 ordering", () => {
    const queue = new TelegramJobQueue();
    queue.enqueue("Deposit 8 USDC -> Aave Base");
    queue.enqueue("Deposit 8 USDC -> Morpho Base");
    queue.enqueue("Mint LP position");

    expect(queue.list().jobs.map((job, index) => `#${index + 1}:${job.summary}`)).toEqual([
      "#1:Deposit 8 USDC -> Aave Base",
      "#2:Deposit 8 USDC -> Morpho Base",
      "#3:Mint LP position",
    ]);
  });

  it("cancel removes only the targeted job", () => {
    const queue = new TelegramJobQueue();
    const a = queue.enqueue("A");
    const b = queue.enqueue("B");
    const c = queue.enqueue("C");

    queue.cancel(b.id);
    expect(queue.list().jobs.map((job) => job.id)).toEqual([a.id, c.id]);
  });

  it("edit marks one job editable and applies the next update", () => {
    const queue = new TelegramJobQueue();
    const a = queue.enqueue("A");
    queue.enqueue("B");

    queue.beginEdit(a.id);
    expect(queue.activeEditingJob()?.id).toBe(a.id);

    const updated = queue.applyEdit("A updated");
    expect(updated?.summary).toBe("A updated");
    expect(queue.list().jobs[0]?.status).toBe("queued");
  });

  it("round-trips compact callback payloads", () => {
    const raw = buildTelegramJobCallbackData("cancel", "j2");
    expect(parseTelegramJobCallbackData(raw)).toEqual({ action: "cancel", jobId: "j2" });
  });
});
