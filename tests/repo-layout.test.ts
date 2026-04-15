import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repo layout", () => {
  it("exposes build, start, dev, and test scripts", () => {
    const raw = readFileSync(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.build).toBeTruthy();
    expect(pkg.scripts?.start).toBeTruthy();
    expect(pkg.scripts?.dev).toBeTruthy();
    expect(pkg.scripts?.test).toBeTruthy();
  });

  it("includes PM2 runtime packaging config", () => {
    expect(existsSync(join(root, "ecosystem.config.cjs"))).toBe(true);
  });

  it("includes bootstrap entry at src/index.ts", () => {
    expect(existsSync(join(root, "src", "index.ts"))).toBe(true);
  });

  it("includes TypeScript and Vitest config", () => {
    expect(existsSync(join(root, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(root, "vitest.config.ts"))).toBe(true);
  });

  it("includes the active kernel migration matrix", () => {
    expect(existsSync(join(root, "docs", "kernel-migration-matrix.md"))).toBe(true);
  });

  it("does not execute main when imported", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const entryUrl = pathToFileURL(join(root, "src", "index.ts")).href;

    await import(`${entryUrl}?import-check=${Date.now()}`);

    expect(logSpy).not.toHaveBeenCalled();
  });
});
