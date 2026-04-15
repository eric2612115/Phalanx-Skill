import { describe, expect, it, vi } from "vitest";

import { selectBestX402Accept } from "../src/adapters/x402-accept-selection.js";
import type { X402AcceptOption } from "../src/adapters/x402.js";

const XLAYER_ACCEPT: X402AcceptOption = {
  scheme: "exact",
  network: "eip155:196",
  amount: "1000",
  asset: "0x1111111111111111111111111111111111111111",
  payTo: "0x9999999999999999999999999999999999999999",
};

const BASE_ACCEPT: X402AcceptOption = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "1000",
  asset: "0x2222222222222222222222222222222222222222",
  payTo: "0x8888888888888888888888888888888888888888",
};

describe("selectBestX402Accept", () => {
  it("prefers X Layer over Base when both are payable", async () => {
    const result = await selectBestX402Accept({
      accepts: [BASE_ACCEPT, XLAYER_ACCEPT],
      payerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      balanceProbe: async () => ({ sufficient: true }),
    });

    expect(result.status).toBe("selected");
    expect(result.accept?.network).toBe("eip155:196");
  });

  it("falls back to Base when X Layer is present but insufficient", async () => {
    const result = await selectBestX402Accept({
      accepts: [XLAYER_ACCEPT, BASE_ACCEPT],
      payerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      balanceProbe: async (input) => ({ sufficient: input.network === "eip155:8453" }),
    });

    expect(result.status).toBe("selected");
    expect(result.accept?.network).toBe("eip155:8453");
  });

  it("probes balances against the active agentic wallet address", async () => {
    const balanceProbe = vi.fn(async () => ({ sufficient: true }));
    const result = await selectBestX402Accept({
      accepts: [XLAYER_ACCEPT],
      payerAddress: "0x0dfddf188f102978c75882bc990d903ebe08f443",
      balanceProbe,
    });

    expect(result.status).toBe("selected");
    expect(balanceProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: "0x0dfddf188f102978c75882bc990d903ebe08f443",
        network: "eip155:196",
      }),
    );
  });

  it("returns explicit insufficient_funds when no supported accept is payable", async () => {
    const result = await selectBestX402Accept({
      accepts: [XLAYER_ACCEPT, BASE_ACCEPT],
      payerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      balanceProbe: async () => ({ sufficient: false, balance: "0" }),
    });

    expect(result.status).toBe("insufficient_funds");
    expect(result.accept).toBeUndefined();
    expect(result.summary).toMatch(/insufficient/i);
  });

  it("treats PHALANX_X402_NETWORK as an explicit debug override rather than a silent default", async () => {
    const result = await selectBestX402Accept({
      accepts: [XLAYER_ACCEPT, BASE_ACCEPT],
      payerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      networkOverride: "eip155:8453",
      balanceProbe: async () => ({ sufficient: true }),
    });

    expect(result.status).toBe("selected");
    expect(result.accept?.network).toBe("eip155:8453");
    expect(result.summary).toMatch(/override/i);
  });
});
