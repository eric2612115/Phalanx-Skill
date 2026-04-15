import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("skill kernel boundary", () => {
  it("exposes a skill-first startup command", () => {
    const raw = readFileSync(join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["start:skill"]).toBeTruthy();
    expect(pkg.scripts?.start).toBe(pkg.scripts?.["start:skill"]);
    expect(pkg.scripts?.["start:compat"]).toBeTruthy();
  });

  it("keeps the skill bootstrap free of direct Telegram and guardian startup", () => {
    const entry = readFileSync(join(root, "src", "app", "skill-runtime-bootstrap.ts"), "utf8");

    expect(entry).not.toMatch(/startTelegramBotPolling/);
    expect(entry).not.toMatch(/maybeStartGuardianFromEnv/);
  });
});
