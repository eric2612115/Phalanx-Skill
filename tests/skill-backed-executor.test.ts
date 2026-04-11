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

  it("uses onchainos LP execution for Uniswap LP deposit intents", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i5",
      lane: "execution",
      action: "depositLpPosition",
      payload: {
        protocol: "uniswap-v3",
        investmentId: "uniswap-base-weth-usdc-v3",
        token: "USDC",
        amount: "1000000",
        chain: "base",
      },
      entrySource: "mcp",
      target: "uniswap-v3",
    });

    expect(result).toMatchObject({
      provider: "onchainos",
      lane: "defi_execute",
      status: "tool_missing",
    });
  });

  it("uses onchainos LP execution for Pancake LP withdraw intents", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        TEST_WALLET_ADDRESS: "0x3333333333333333333333333333333333333333",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i6",
      lane: "execution",
      action: "withdrawLpPosition",
      payload: {
        protocol: "pancakeswap-v3",
        investmentId: "pancake-bsc-bnb-usdt-v3",
        chain: "bsc",
        tokenId: "12345",
        ratio: "1",
      },
      entrySource: "mcp",
      target: "pancakeswap-v3",
    });

    expect(result).toMatchObject({
      provider: "onchainos",
      lane: "defi_execute",
      status: "tool_missing",
    });
  });

  it("uses onchainos wallet send for withdrawToOwner intents", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        PHALANX_OWNER_EVM_ADDRESS: "0x4444444444444444444444444444444444444444",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i7",
      lane: "execution",
      action: "withdrawToOwner",
      payload: {
        chain: "base",
        token: "USDC",
        readableAmount: "1.5",
        contractToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
      entrySource: "mcp",
    });

    expect(result).toMatchObject({
      provider: "onchainos",
      lane: "wallet_send",
      status: "tool_missing",
    });
  });

  it("uses owner sweep orchestration for sweepToOwner intents", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        PHALANX_OWNER_EVM_ADDRESS: "0x4444444444444444444444444444444444444444",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i8",
      lane: "execution",
      action: "sweepToOwner",
      payload: {
        chain: "base",
      },
      entrySource: "mcp",
    });

    expect(result).toMatchObject({
      provider: "onchainos",
      lane: "owner_sweep",
      status: "tool_missing",
    });
  });

  it("prefers the live agent wallet over TEST_WALLET_ADDRESS when runtime mode is live", async () => {
    const { createSkillBackedExecutor } = await import("../src/executors/skill-backed.ts");

    const executor = createSkillBackedExecutor({
      env: {
        PATH: "/definitely/missing",
        PHALANX_RUNTIME_MODE: "live",
        AGENT_WALLET_ADDRESS: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        TEST_WALLET_ADDRESS: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      } as NodeJS.ProcessEnv,
    });

    const result = await executor.execute({
      id: "i9",
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
    expect((result as { argv?: string[] }).argv).toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect((result as { argv?: string[] }).argv).not.toContain("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });
});
