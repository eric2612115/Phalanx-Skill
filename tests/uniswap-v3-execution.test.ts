import { describe, expect, it } from "vitest";

import { deriveTickBoundsFromRange, executeLpPositionIntent } from "../src/adapters/lp-execution.ts";

const NPM = "0x03a520b32c04bf3beef7beb72e919cf822ed34f1";

describe("uniswap v3 direct execution lane", () => {
  it("prefers poolAddress metadata and does not require investmentId", async () => {
    const calls: string[][] = [];
    const result = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "uniswap-v3",
        poolAddress: "0x1111111111111111111111111111111111111111",
        address: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
        chain: "base",
        token: "USDC",
        amount: "1370428",
        tokenSecondary: "ETH",
        amountSecondary: "592218288409166",
        tickLower: "-199560",
        tickUpper: "-199200",
      },
      {} as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readDefiDetailImpl: async () => {
          throw new Error("readDefiDetailImpl should not run when poolAddress is provided");
        },
        readUniswapPoolMetadataImpl: async () => ({
          contract: NPM,
          fee: 3000,
          tokens: [
            {
              poolAddress: "0x4200000000000000000000000000000000000006",
              symbol: "ETH",
              native: true,
              originalAddress: "0x4200000000000000000000000000000000000006",
            },
            {
              poolAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              approvalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              symbol: "USDC",
              native: false,
              originalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            },
          ],
        }),
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: {
                  txHash: args.some((arg) => arg.startsWith("0x095ea7b3")) ? "0xapprove" : "0xmint",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            const txHash = args[args.indexOf("--tx-hash") + 1];
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash, txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(result.status).toBe("completed");
    expect(calls.some((entry) => entry[1] === "defi" && entry[2] === "detail")).toBe(false);
    expect(calls[0]?.some((arg) => arg.startsWith("0x095ea7b3"))).toBe(true);
    expect(calls[1]?.join(" ")).toContain("wallet history");
    expect(calls[2]).toContain(NPM);
  });

  it("uses direct NPM approve plus multicall mint instead of onchainos defi invest", async () => {
    const calls: string[][] = [];
    const result = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "uniswap-v3",
        investmentId: "326890603",
        address: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
        chain: "base",
        token: "USDC",
        amount: "1370428",
        tokenSecondary: "ETH",
        amountSecondary: "592218288409166",
        tickLower: "-199560",
        tickUpper: "-199200",
      },
      {} as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readDefiDetailImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "detail"],
          summary: "detail completed",
          stdout: JSON.stringify({
            ok: true,
            data: {
              investmentId: 326890603,
              contract: NPM,
              feeRate: "0.003",
              underlyingToken: [
                {
                  tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                  tokenSymbol: "USDC",
                  isBaseToken: false,
                },
                {
                  tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                  tokenSymbol: "ETH",
                  isBaseToken: true,
                },
              ],
            },
          }),
        }),
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: {
                  txHash: args.some((arg) => arg.startsWith("0x095ea7b3")) ? "0xapprove" : "0xmint",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            const txHash = args[args.indexOf("--tx-hash") + 1];
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash, txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(result.status).toBe("completed");
    expect(calls.map((entry) => entry.join(" "))).toEqual([
      expect.stringContaining("onchainos wallet contract-call"),
      expect.stringContaining("onchainos wallet history"),
      expect.stringContaining("onchainos wallet contract-call"),
      expect.stringContaining("onchainos wallet history"),
    ]);
    expect(calls.some((entry) => entry[1] === "defi" && entry[2] === "invest")).toBe(false);
    expect(calls[0]?.some((arg) => arg.startsWith("0x095ea7b3"))).toBe(true);
    expect(calls[2]).toContain(NPM);
    expect(calls[2]?.some((arg) => arg.startsWith("0xac9650d8"))).toBe(true);
    const mintCall = calls[2]?.find((arg) => arg.startsWith("0xac9650d8")) ?? "";
    expect(mintCall.indexOf("4200000000000000000000000000000000000006")).toBeLessThan(
      mintCall.indexOf("833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
    );
  });

  it("derives outward usable tick bounds from planner range percentages", () => {
    expect(
      deriveTickBoundsFromRange({
        currentTick: 0,
        tickSpacing: 60,
        range: "5",
      }),
    ).toEqual({
      tickLower: -540,
      tickUpper: 540,
    });
    expect(
      deriveTickBoundsFromRange({
        currentTick: 12_345,
        tickSpacing: 60,
        range: "5",
      }),
    ).toEqual({
      tickLower: 11_820,
      tickUpper: 12_840,
    });
  });

  it("derives tickLower and tickUpper from range when direct uniswap deposit only has planner range", async () => {
    const calls: string[][] = [];
    const result = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "uniswap-v3",
        poolAddress: "0x1111111111111111111111111111111111111111",
        address: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
        chain: "base",
        token: "USDC",
        amount: "1370428",
        tokenSecondary: "ETH",
        amountSecondary: "592218288409166",
        range: "5",
      },
      {
        BASE_RPC_URL: "https://base.example",
      } as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readDefiDetailImpl: async () => {
          throw new Error("readDefiDetailImpl should not run when poolAddress is provided");
        },
        readUniswapPoolMetadataImpl: async () => ({
          contract: NPM,
          fee: 3000,
          currentTick: 0,
          tickSpacing: 60,
          tokens: [
            {
              poolAddress: "0x4200000000000000000000000000000000000006",
              symbol: "ETH",
              native: true,
              originalAddress: "0x4200000000000000000000000000000000000006",
            },
            {
              poolAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              approvalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              symbol: "USDC",
              native: false,
              originalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            },
          ],
        }),
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: {
                  txHash: args.some((arg) => arg.startsWith("0x095ea7b3")) ? "0xapprove" : "0xmint",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            const txHash = args[args.indexOf("--tx-hash") + 1];
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash, txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(result.status).toBe("completed");
    expect(calls[2]?.some((arg) => arg.startsWith("0xac9650d8"))).toBe(true);
  });

  it("derives explicit tick bounds from range-only payloads before direct mint", async () => {
    const calls: string[][] = [];
    const result = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "uniswap-v3",
        poolAddress: "0x1111111111111111111111111111111111111111",
        address: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
        chain: "base",
        token: "USDC",
        amount: "1370428",
        tokenSecondary: "ETH",
        amountSecondary: "592218288409166",
        range: "5",
      },
      { BASE_RPC_URL: "https://base.example" } as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readDefiDetailImpl: async () => {
          throw new Error("readDefiDetailImpl should not run when poolAddress is provided");
        },
        readUniswapPoolMetadataImpl: async () => ({
          contract: NPM,
          fee: 3000,
          currentTick: 12_345,
          tickSpacing: 60,
          tokens: [
            {
              poolAddress: "0x4200000000000000000000000000000000000006",
              symbol: "ETH",
              native: true,
              originalAddress: "0x4200000000000000000000000000000000000006",
            },
            {
              poolAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              approvalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              symbol: "USDC",
              native: false,
              originalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            },
          ],
        }),
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: {
                  txHash: args.some((arg) => arg.startsWith("0x095ea7b3")) ? "0xapprove" : "0xmint",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            const txHash = args[args.indexOf("--tx-hash") + 1];
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash, txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(result.status).toBe("completed");
    expect(calls[2]?.some((arg) => arg.startsWith("0xac9650d8"))).toBe(true);
  });

  it("can follow a deposit with Onchain OS discovery and then direct withdraw without manually supplying tokenId", async () => {
    const calls: string[][] = [];
    let discoveredTokenId: string | undefined;
    const readDefiDetailImpl = async () => ({
      provider: "onchainos" as const,
      status: "completed" as const,
      argv: ["onchainos", "defi", "detail"],
      summary: "detail completed",
      stdout: JSON.stringify({
        ok: true,
        data: {
          investmentId: 326890603,
          contract: NPM,
          feeRate: "0.003",
          underlyingToken: [
            {
              tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              tokenSymbol: "USDC",
              isBaseToken: false,
            },
            {
              tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              tokenSymbol: "ETH",
              isBaseToken: true,
            },
          ],
        },
      }),
    });

    const depositResult = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "uniswap-v3",
        investmentId: "326890603",
        address: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
        chain: "base",
        token: "USDC",
        amount: "1370428",
        tokenSecondary: "ETH",
        amountSecondary: "592218288409166",
        tickLower: "-199560",
        tickUpper: "-199200",
      },
      {} as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readDefiDetailImpl,
        readDefiPositionsImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "positions"],
          summary: "positions after deposit",
          stdout: JSON.stringify({
            ok: true,
            data: {
              positions: discoveredTokenId ? [{ tokenId: discoveredTokenId, platformId: "plat-uni-1" }] : [],
            },
          }),
        }),
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            const txHash = args.some((arg) => arg.startsWith("0x095ea7b3"))
              ? "0xapprove"
              : args.some((arg) => arg.startsWith("0xac9650d8"))
                ? "0xmint"
                : "0xwithdraw";
            if (txHash === "0xmint") {
              discoveredTokenId = "4942499";
            }
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: { txHash } }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            const txHash = args[args.indexOf("--tx-hash") + 1];
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash, txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        readUniswapPositionImpl: async (input) => {
          expect(input.tokenId).toBe("4942499");
          return {
            nonce: 0n,
            operator: "0x0000000000000000000000000000000000000000",
            token0: "0x4200000000000000000000000000000000000006",
            token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            fee: 3000,
            tickLower: -199560,
            tickUpper: -199200,
            liquidity: 3180904181569n,
            feeGrowthInside0LastX128: 0n,
            feeGrowthInside1LastX128: 0n,
            tokensOwed0: 0n,
            tokensOwed1: 0n,
          };
        },
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(depositResult.status).toBe("completed");
    expect(discoveredTokenId).toBe("4942499");

    const withdrawResult = await executeLpPositionIntent(
      "withdrawLpPosition",
      {
        protocol: "uniswap-v3",
        investmentId: "326890603",
        address: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
        chain: "base",
        ratio: "1",
      },
      {} as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readDefiDetailImpl,
        readDefiPositionsImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "positions"],
          summary: "positions after deposit",
          stdout: JSON.stringify({
            ok: true,
            data: {
              positions: discoveredTokenId ? [{ tokenId: discoveredTokenId, platformId: "plat-uni-1" }] : [],
            },
          }),
        }),
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            const txHash = args.some((arg) => arg.startsWith("0x095ea7b3"))
              ? "0xapprove"
              : args.some((arg) => arg.startsWith("0xac9650d8"))
                ? "0xmint"
                : "0xwithdraw";
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: { txHash } }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            const txHash = args[args.indexOf("--tx-hash") + 1];
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash, txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        readUniswapPositionImpl: async (input) => {
          expect(input.tokenId).toBe("4942499");
          return {
            nonce: 0n,
            operator: "0x0000000000000000000000000000000000000000",
            token0: "0x4200000000000000000000000000000000000006",
            token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            fee: 3000,
            tickLower: -199560,
            tickUpper: -199200,
            liquidity: 3180904181569n,
            feeGrowthInside0LastX128: 0n,
            feeGrowthInside1LastX128: 0n,
            tokensOwed0: 0n,
            tokensOwed1: 0n,
          };
        },
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(withdrawResult.status).toBe("completed");
    expect(calls.some((entry) => entry[1] === "defi" && entry[2] === "invest")).toBe(false);
    expect(calls.some((entry) => entry[1] === "defi" && entry[2] === "withdraw")).toBe(false);
    expect(calls.filter((entry) => entry[0] === "onchainos" && entry[1] === "wallet" && entry[2] === "contract-call"))
      .toHaveLength(3);
  });

  it("uses direct NPM multicall for withdraw instead of onchainos defi withdraw", async () => {
    const calls: string[][] = [];
    const result = await executeLpPositionIntent(
      "withdrawLpPosition",
      {
        protocol: "uniswap-v3",
        investmentId: "326890603",
        address: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
        chain: "base",
        tokenId: "4942499",
        ratio: "1",
      },
      {} as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readDefiDetailImpl: async () => ({
          provider: "onchainos",
          status: "completed",
          argv: ["onchainos", "defi", "detail"],
          summary: "detail completed",
          stdout: JSON.stringify({
            ok: true,
            data: {
              investmentId: 326890603,
              contract: NPM,
              feeRate: "0.003",
              underlyingToken: [
                {
                  tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                  tokenSymbol: "ETH",
                  isBaseToken: true,
                },
                {
                  tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                  tokenSymbol: "USDC",
                  isBaseToken: false,
                },
              ],
            },
          }),
        }),
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: { txHash: "0xwithdraw" } }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash: "0xwithdraw", txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        readUniswapPositionImpl: async () => ({
          nonce: 0n,
          operator: "0x0000000000000000000000000000000000000000",
          token0: "0x4200000000000000000000000000000000000006",
          token1: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          fee: 3000,
          tickLower: -199560,
          tickUpper: -199200,
          liquidity: 3180904181569n,
          feeGrowthInside0LastX128: 0n,
          feeGrowthInside1LastX128: 0n,
          tokensOwed0: 0n,
          tokensOwed1: 0n,
        }),
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(result.status).toBe("completed");
    expect(calls.map((entry) => entry.join(" "))).toEqual([
      expect.stringContaining("onchainos wallet contract-call"),
      expect.stringContaining("onchainos wallet history"),
    ]);
    expect(calls.some((entry) => entry[1] === "defi" && entry[2] === "withdraw")).toBe(false);
    expect(calls[0]).toContain(NPM);
    expect(calls[0]?.some((arg) => arg.startsWith("0xac9650d8"))).toBe(true);
    expect(calls[0]?.some((arg) => arg.includes("0c49ccbe"))).toBe(true);
    expect(calls[0]?.some((arg) => arg.includes("fc6f7865"))).toBe(true);
  });

  it("keeps pancakeswap v3 on the original onchainos defi route", async () => {
    const calls: string[][] = [];
    const result = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "pancakeswap-v3",
        investmentId: "pancake-bsc-bnb-usdt-v3",
        address: "0x1111111111111111111111111111111111111111",
        chain: "bsc",
        token: "USDT",
        amount: "1000000",
        tokenSecondary: "BNB",
        amountSecondary: "1000000000000000",
        range: "5",
      },
      {} as NodeJS.ProcessEnv,
      "pancakeswap-v3",
      {
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "defi" && args[1] === "invest") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: {
                  dataList: [
                    {
                      callDataType: "DEPOSIT",
                      from: "0x1111111111111111111111111111111111111111",
                      to: "0x2222222222222222222222222222222222222222",
                      serializedData: "0xdeadbeef",
                      value: "0x0",
                    },
                  ],
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: { txHash: "0xpancake" } }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash: "0xpancake", txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
      } as never,
    );

    expect(result.status).toBe("completed");
    expect(calls[0]?.join(" ")).toContain("onchainos defi invest");
    expect(calls.some((entry) => entry[1] === "wallet" && entry[2] === "contract-call")).toBe(true);
  });

  it("returns LP_WALLET_UNRESOLVED for direct uniswap live execution when no wallet can be resolved", async () => {
    const result = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "uniswap-v3",
        poolAddress: "0x1111111111111111111111111111111111111111",
        chain: "base",
        token: "USDC",
        amount: "1370428",
        tokenSecondary: "ETH",
        amountSecondary: "592218288409166",
        tickLower: "-199560",
        tickUpper: "-199200",
      },
      {
        PHALANX_RUNTIME_MODE: "live",
      } as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        resolveExecutionWalletAddressImpl: async () => undefined,
      } as never,
    );

    expect(result).toMatchObject({
      mode: "lp_execution_invalid",
      code: "LP_WALLET_UNRESOLVED",
    });
  });

  it("uses TEST_WALLET_ADDRESS for direct uniswap dry-run execution when payload address is absent", async () => {
    const calls: string[][] = [];
    const result = await executeLpPositionIntent(
      "depositLpPosition",
      {
        protocol: "uniswap-v3",
        poolAddress: "0x1111111111111111111111111111111111111111",
        chain: "base",
        token: "USDC",
        amount: "1370428",
        tokenSecondary: "ETH",
        amountSecondary: "592218288409166",
        tickLower: "-199560",
        tickUpper: "-199200",
      },
      {
        TEST_WALLET_ADDRESS: "0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93",
      } as NodeJS.ProcessEnv,
      "uniswap-v3",
      {
        readUniswapPoolMetadataImpl: async () => ({
          contract: NPM,
          fee: 3000,
          tokens: [
            {
              poolAddress: "0x4200000000000000000000000000000000000006",
              symbol: "ETH",
              native: true,
              originalAddress: "0x4200000000000000000000000000000000000006",
            },
            {
              poolAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              approvalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              symbol: "USDC",
              native: false,
              originalAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            },
          ],
        }),
        resolveExecutionWalletAddressImpl: async () => undefined,
        runCmdImpl: async (command, args) => {
          calls.push([command, ...args]);
          if (args[0] === "wallet" && args[1] === "contract-call") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: {
                  txHash: args.some((arg) => arg.startsWith("0x095ea7b3")) ? "0xapprove" : "0xmint",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            const txHash = args[args.indexOf("--tx-hash") + 1];
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({ ok: true, data: [{ txHash, txStatus: "SUCCESS" }] }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
        nowSecondsImpl: () => 1_775_962_100,
      } as never,
    );

    expect(result.status).toBe("completed");
    expect(result.executedSteps?.[0]?.from).toBe("0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93");
    expect(result.executedSteps?.[1]?.from).toBe("0xc9cad2450ab7155f2c40a87da32f9ab67cfefe93");
  });
});
