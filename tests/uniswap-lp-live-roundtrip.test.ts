import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "../scripts/uniswap-lp-live-roundtrip.ts");
const scriptSource = readFileSync(scriptPath, "utf8");

describe("uniswap-lp-live-roundtrip script contract", () => {
  it("carries planner-selected poolAddress into the derived withdraw payload", () => {
    expect(scriptSource).toContain("poolAddress:");
    expect(scriptSource).toContain("depositPayload.poolAddress");
  });

  it("requires a newly discovered tokenId before continuing to withdraw", () => {
    expect(scriptSource).toContain("beforeTokenIds");
    expect(scriptSource).toContain("newTokenId");
    expect(scriptSource).toContain("attempt <= 6");
    expect(scriptSource).toContain("setTimeout(resolve, 5000)");
    expect(scriptSource).toContain("Deposit did not produce a new LP tokenId");
  });
});
