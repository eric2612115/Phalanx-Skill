import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("telegram-first acceptance matrix doc", () => {
  it("defines exactly 20 scenario ids and core observability contracts", () => {
    const path = resolve(process.cwd(), "docs/telegram-first-acceptance-matrix.md");
    const raw = readFileSync(path, "utf8");

    const ids = Array.from(raw.matchAll(/\| (S\d{2}) \|/g)).map((match) => match[1]);
    expect(ids).toEqual([
      "S01",
      "S02",
      "S03",
      "S04",
      "S05",
      "S06",
      "S07",
      "S08",
      "S09",
      "S10",
      "S11",
      "S12",
      "S13",
      "S14",
      "S15",
      "S16",
      "S17",
      "S18",
      "S19",
      "S20",
    ]);
    expect(raw).toContain("Telegram input / trigger");
    expect(raw).toContain("Expected runtime / operator surfaces");
    expect(raw).toContain("grouped explorer links");
    expect(raw).toContain("report_failed");
    expect(raw).toContain("x402 summary");
  });
});
