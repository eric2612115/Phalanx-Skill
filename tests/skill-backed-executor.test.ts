import { describe, expect, it } from "vitest";

describe("skill-backed executor", () => {
  it("uses onchainos swap execution for swap intents", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i1",
      lane: "execution",
      action: "swap",
      payload: {
        fromTokenAddress: "0x1111111111111111111111111111111111111111",
        toTokenAddress: "0x2222222222222222222222222222222222222222",
        readableAmount: "1.5",
        chain: "base",
      },
      entrySource: "mcp",
      target: "uniswap-v3",
    });

    expect(result).toMatchObject({
      provider: "onchainos",
      lane: "swap_execute",
      status: "tool_missing",
    });
  });

  it("returns governance summary instead of executing skill for whitelist changes", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor();
    const result = await executor.execute({
      id: "i2",
      lane: "execution",
      action: "requestWhitelistExpansion",
      payload: { target: "uniswap-v3" },
      entrySource: "mcp",
      target: "whitelist-admin",
    });

    expect(result).toMatchObject({
      mode: "governance_change",
      action: "requestWhitelistExpansion",
      target: "whitelist-admin",
    });
  });

  it("uses onchainos defi invest for deposit intents", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i3",
      lane: "execution",
      action: "deposit",
      payload: {
        investmentId: "morpho-usdc",
        token: "USDC",
        amount: "1000000",
        chain: "ethereum",
      },
      entrySource: "mcp",
      target: "morpho-vaults",
    });

    expect(result).toMatchObject({
      provider: "onchainos",
      status: "tool_missing",
    });
  });

  it("uses onchainos defi withdraw for withdraw intents", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i4",
      lane: "execution",
      action: "withdraw",
      payload: {
        investmentId: "morpho-usdc",
        chain: "ethereum",
        ratio: "1",
        platformId: "morpho",
      },
      entrySource: "mcp",
      target: "morpho-vaults",
    });

    expect(result).toMatchObject({
      provider: "onchainos",
      status: "tool_missing",
    });
  });
});
