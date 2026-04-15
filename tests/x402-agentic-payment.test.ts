import { describe, expect, it, vi } from "vitest";

import { executeAgenticX402HttpRequest } from "../src/adapters/x402-agentic-payment.js";

function paymentRequiredHeader(): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:196",
          amount: "1000",
          asset: "0x1111111111111111111111111111111111111111",
          payTo: "0x9999999999999999999999999999999999999999",
        },
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1000",
          asset: "0x2222222222222222222222222222222222222222",
          payTo: "0x8888888888888888888888888888888888888888",
        },
      ],
    }),
    "utf8",
  ).toString("base64");
}

function onchainosPaymentStdout(from = "0x0dfddf188f102978c75882bc990d903ebe08f443"): string {
  return JSON.stringify({
    data: {
      authorization: {
        from,
        nonce: "1",
        to: "0x9999999999999999999999999999999999999999",
        validAfter: "0",
        validBefore: "9999999999",
        value: "1000",
      },
      signature: "0xsigned",
    },
  });
}

function paymentResponseHeader(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

describe("executeAgenticX402HttpRequest", () => {
  it("uses the active agentic wallet and replays with X-PAYMENT", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("payment required", {
          status: 402,
          headers: { "PAYMENT-REQUIRED": paymentRequiredHeader() },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"ok":true}', {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": paymentResponseHeader({
              billing_mode: "x402",
              payment_required: false,
              payment_id: "payment-123",
              settlement_mode: "sync",
              settlement_tx_hash: "0x76326160a7ad19aa456936b0fe1a61f7a58424b23d5043a7402805a7d32bf069",
              network: "eip155:196",
              reason_code: "paid_x402",
            }),
            "X-PAYMENT-ID": "payment-123",
          },
        }),
      );

    const executePayment = vi.fn(async () => ({
      provider: "onchainos" as const,
      lane: "x402_payment" as const,
      status: "completed" as const,
      argv: [],
      summary: "onchainos x402 payment command completed",
      stdout: onchainosPaymentStdout(),
      stderr: "",
      exitCode: 0,
    }));

    const result = await executeAgenticX402HttpRequest(
      {
        url: "https://api.omrate.com/markets/search",
        env: {
          PHALANX_X402_PAYMENT_ENABLED: "1",
          OKX_API_KEY: "okx-key",
          OKX_API_SECRET: "okx-secret",
          OKX_API_PASSPHRASE: "okx-pass",
          OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
            activeProfileId: "profile-1",
            activeWalletId: "wallet-2",
            profiles: [
              {
                profileId: "profile-1",
                email: "alpha@example.com",
                wallets: [
                  { walletId: "wallet-1", address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
                  { walletId: "wallet-2", address: "0x0dfddf188f102978c75882bc990d903ebe08f443" },
                ],
              },
            ],
          }),
        } as NodeJS.ProcessEnv,
      },
      {
        fetch: fetchMock,
        executePayment,
        balanceProbe: async () => ({ sufficient: true }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.httpStatus).toBe(200);
    expect(result.paymentRequiredByServer).toBe(true);
    expect(result.paymentAttempted).toBe(true);
    expect(result.paymentWrapped).toBe(true);
    expect(result.paymentSettled).toBe(true);
    expect(result.selection?.network).toBe("eip155:196");
    expect(result.selection?.payerAddress).toBe("0x0dfddf188f102978c75882bc990d903ebe08f443");
    expect(result.selection?.payerProfileEmail).toBe("alpha@example.com");
    expect(result.selection?.walletSource).toBe("agentic_active_wallet");
    expect(result.receipt).toMatchObject({
      paymentId: "payment-123",
      settlementMode: "sync",
      settlementTxHash: "0x76326160a7ad19aa456936b0fe1a61f7a58424b23d5043a7402805a7d32bf069",
      settlementNetwork: "eip155:196",
    });
    expect(executePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "eip155:196",
        from: "0x0dfddf188f102978c75882bc990d903ebe08f443",
      }),
      expect.any(Object),
    );
    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall?.[0]).toBe("https://api.omrate.com/markets/search");
    const replayHeaders = secondCall?.[1]?.headers as Headers;
    expect(replayHeaders.get("X-PAYMENT")).toMatch(/^.+$/);
  });

  it("polls the payment receipt endpoint when the replay header only carries payment_id", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("payment required", {
          status: 402,
          headers: { "PAYMENT-REQUIRED": paymentRequiredHeader() },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"ok":true}', {
          status: 200,
          headers: {
            "PAYMENT-RESPONSE": paymentResponseHeader({
              billing_mode: "x402",
              payment_required: false,
              payment_id: "payment-456",
              settlement_mode: "async",
              reason_code: "paid_x402",
            }),
            "X-PAYMENT-ID": "payment-456",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payment_id: "payment-456",
            settled: true,
            outcome: "paid_x402",
            network: "eip155:196",
            tx_hash: "0xlookupsettled",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const executePayment = vi.fn(async () => ({
      provider: "onchainos" as const,
      lane: "x402_payment" as const,
      status: "completed" as const,
      argv: [],
      summary: "onchainos x402 payment command completed",
      stdout: onchainosPaymentStdout(),
      stderr: "",
      exitCode: 0,
    }));

    const result = await executeAgenticX402HttpRequest(
      {
        url: "https://api.omrate.com/markets/search",
        env: {
          PHALANX_X402_PAYMENT_ENABLED: "1",
          OKX_API_KEY: "okx-key",
          OKX_API_SECRET: "okx-secret",
          OKX_API_PASSPHRASE: "okx-pass",
          OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
            profiles: [
              {
                profileId: "profile-1",
                email: "alpha@example.com",
                wallets: [{ walletId: "wallet-1", address: "0x0dfddf188f102978c75882bc990d903ebe08f443" }],
              },
            ],
          }),
        } as NodeJS.ProcessEnv,
      },
      {
        fetch: fetchMock,
        executePayment,
        balanceProbe: async () => ({ sufficient: true }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.receipt).toMatchObject({
      paymentId: "payment-456",
      settlementMode: "async",
      settlementTxHash: "0xlookupsettled",
      settlementNetwork: "eip155:196",
      settlementStatus: "paid_x402",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.omrate.com/payments/x402/payment-456");
  });

  it("returns structured failure when no accept is payable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("payment required", {
        status: 402,
        headers: { "PAYMENT-REQUIRED": paymentRequiredHeader() },
      }),
    );

    const result = await executeAgenticX402HttpRequest(
      {
        url: "https://api.omrate.com/markets/search",
        env: {
          PHALANX_X402_PAYMENT_ENABLED: "1",
          OKX_API_KEY: "okx-key",
          OKX_API_SECRET: "okx-secret",
          OKX_API_PASSPHRASE: "okx-pass",
          OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
            profiles: [
              {
                profileId: "profile-1",
                email: "alpha@example.com",
                wallets: [{ walletId: "wallet-1", address: "0x0dfddf188f102978c75882bc990d903ebe08f443" }],
              },
            ],
          }),
        } as NodeJS.ProcessEnv,
      },
      {
        fetch: fetchMock,
        balanceProbe: async () => ({ sufficient: false, balance: "0" }),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.paymentRequiredByServer).toBe(true);
    expect(result.paymentAttempted).toBe(false);
    expect(result.paymentWrapped).toBe(false);
    expect(result.paymentSettled).toBe(false);
    expect(result.fetchSummary).toMatch(/insufficient_funds/i);
  });
});
