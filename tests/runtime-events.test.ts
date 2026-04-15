import { describe, expect, it } from "vitest";

import { extractRuntimeTxRefs } from "../src/runtime/events.js";

describe("extractRuntimeTxRefs", () => {
  it("includes x402 settlement tx hashes from execution evidence receipts", () => {
    const txRefs = extractRuntimeTxRefs({
      executionEvidence: {
        payment: {
          receipt: {
            settlementTxHash: "0xsettlement",
          },
        },
      },
    });

    expect(txRefs).toEqual(["0xsettlement"]);
  });
});
