import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  discoverUniswapPlannerSkill,
  executeUniswapLiquidityPlannerInvocation,
  planUniswapLiquidityPlannerInvocation,
} from "../src/adapters/uniswap.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function officialStubSkillMd(): string {
  return [
    "---",
    "name: liquidity-planner",
    "description: Test stub matching Uniswap/uniswap-ai skill contract.",
    "metadata:",
    " author: uniswap",
    " version: '0.2.0'",
    "---",
    "",
    "Plan pools via DexScreener:",
    "",
    "```bash",
    'curl -s "https://api.dexscreener.com/token-pairs/v1/{network}/{address}"',
    "```",
    "",
    "Base URL: `https://app.uniswap.org/positions/create`",
    "",
  ].join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("official Uniswap liquidity planner (skills CLI path + data plane)", () => {
  it("discovers liquidity-planner from current project .agents directory without extra env", () => {
    const discovery = discoverUniswapPlannerSkill({
      PWD: repoRoot,
    } as NodeJS.ProcessEnv);

    expect(discovery.status).toBe("available");
    expect(discovery.skillFile?.replace(/\\/g, "/")).toMatch(/\.agents\/skills\/liquidity-planner\/SKILL\.md$/);
  });

  it("discovers liquidity-planner under .agents/skills when PHALANX_UNISWAP_SKILLS_PROJECT_ROOT is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-skills-cli-"));
    const skillDir = join(dir, ".agents/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), officialStubSkillMd(), "utf8");

    const discovery = discoverUniswapPlannerSkill({
      PHALANX_UNISWAP_SKILLS_PROJECT_ROOT: dir,
    });

    expect(discovery.status).toBe("available");
    expect(discovery.skillFile?.replace(/\\/g, "/")).toMatch(/\.agents\/skills\/liquidity-planner\/SKILL\.md$/);
  });

  it("runs official skills list --json and DexScreener step when hooks succeed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-skills-cli-exec-"));
    const skillDir = join(dir, ".agents/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), officialStubSkillMd(), "utf8");

    const mockPools = [
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "0xabc",
        labels: ["v3"],
        baseToken: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        quoteToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
        liquidity: { usd: 12345 },
        volume: { h24: 999 },
      },
    ];

    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ name: "liquidity-planner", path: skillDir, scope: "project" }]),
      stderr: "",
    });

    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockPools), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const plan = planUniswapLiquidityPlannerInvocation(
      { chain: "base", tokenA: "USDC", tokenB: "ETH", positionType: "v3" },
      { PHALANX_UNISWAP_SKILLS_PROJECT_ROOT: dir },
    );
    expect(plan.status).toBe("planned");

    const exec = await executeUniswapLiquidityPlannerInvocation(plan, process.env, {
      fetchImpl: fetch as unknown as typeof fetch,
      execFileImpl: execFile,
    });

    expect(exec.status).toBe("completed");
    expect(exec.officialInvocation?.skillsCliListJson?.matchedLiquidityPlanner).toBe(true);
    expect(exec.officialInvocation?.skillsCliListJson?.exitCode).toBe(0);
    expect(exec.dataPlane?.uniswapPools).toHaveLength(1);
    expect(exec.dataPlane?.uniswapPools[0]?.pairAddress).toBe("0xabc");
    expect(exec.runtimeDownstream?.executionTarget).toBe("uniswap-v3");
    expect(exec.runtimeDownstream?.executionAction).toBe("depositLpPosition");
    expect(exec.runtimeDownstream?.payloadTemplate?.protocol).toBe("uniswap-v3");
    expect(exec.runtimeDownstream?.payloadTemplate?.chain).toBe("base");
    expect(exec.runtimeDownstream?.payloadTemplate?.tokenSecondary).toBe("ETH");
    expect(exec.runtimeDownstream?.payloadTemplate?.range).toBe("");
    expect(exec.runtimeDownstream?.topUniswapPools?.[0]?.dexId).toBe("uniswap");
    expect(exec.runtimeDownstream?.missingExecutionFields).toContain("range");
    expect(execFile).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it("prefers a pool whose version matches the requested positionType for payloadTemplate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-skills-cli-exec-"));
    const skillDir = join(dir, ".agents/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), officialStubSkillMd(), "utf8");

    const mockPools = [
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        labels: ["v4"],
        baseToken: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        quoteToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
        liquidity: { usd: 30000 },
        volume: { h24: 1000 },
      },
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "0x1111111111111111111111111111111111111111",
        labels: ["v3"],
        baseToken: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        quoteToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
        liquidity: { usd: 12345 },
        volume: { h24: 999 },
      },
    ];

    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ name: "liquidity-planner", path: skillDir, scope: "project" }]),
      stderr: "",
    });

    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockPools), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const plan = planUniswapLiquidityPlannerInvocation(
      { chain: "base", tokenA: "USDC", tokenB: "ETH", positionType: "v3" },
      { PHALANX_UNISWAP_SKILLS_PROJECT_ROOT: dir },
    );
    expect(plan.status).toBe("planned");

    const exec = await executeUniswapLiquidityPlannerInvocation(plan, process.env, {
      fetchImpl: fetch as unknown as typeof fetch,
      execFileImpl: execFile,
    });

    expect(exec.status).toBe("completed");
    expect(exec.runtimeDownstream?.payloadTemplate?.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(exec.runtimeDownstream?.topUniswapPools?.[0]?.version).toBe("v4");
    expect(exec.runtimeDownstream?.topUniswapPools?.[1]?.version).toBe("v3");
  });

  it("filters candidate pools by the requested token pair before picking runtime pool", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-skills-cli-exec-"));
    const skillDir = join(dir, ".agents/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), officialStubSkillMd(), "utf8");

    const mockPools = [
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "0x2222222222222222222222222222222222222222",
        labels: ["v3"],
        baseToken: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        quoteToken: { symbol: "SHIB", address: "0x9999999999999999999999999999999999999999" },
        liquidity: { usd: 50000 },
        volume: { h24: 2000 },
      },
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "0x1111111111111111111111111111111111111111",
        labels: ["v3"],
        baseToken: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        quoteToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
        liquidity: { usd: 12345 },
        volume: { h24: 999 },
      },
    ];

    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ name: "liquidity-planner", path: skillDir, scope: "project" }]),
      stderr: "",
    });

    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockPools), { status: 200, headers: { "content-type": "application/json" } }),
    );

    const plan = planUniswapLiquidityPlannerInvocation(
      { chain: "base", tokenA: "USDC", tokenB: "ETH", positionType: "v3" },
      { PHALANX_UNISWAP_SKILLS_PROJECT_ROOT: dir },
    );
    expect(plan.status).toBe("planned");

    const exec = await executeUniswapLiquidityPlannerInvocation(plan, process.env, {
      fetchImpl: fetch as unknown as typeof fetch,
      execFileImpl: execFile,
    });

    expect(exec.status).toBe("completed");
    expect(exec.runtimeDownstream?.payloadTemplate?.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(exec.runtimeDownstream?.topUniswapPools?.[0]?.pairAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  it("merges tokenA and tokenB probe pools so ETH pairs are discoverable on Base", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-skills-cli-exec-"));
    const skillDir = join(dir, ".agents/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), officialStubSkillMd(), "utf8");

    const usdcPools = [
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "0x2222222222222222222222222222222222222222",
        labels: ["v3"],
        baseToken: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        quoteToken: { symbol: "USDbC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA" },
        liquidity: { usd: 50000 },
        volume: { h24: 2000 },
      },
    ];
    const wethPools = [
      {
        chainId: "base",
        dexId: "uniswap",
        pairAddress: "0x1111111111111111111111111111111111111111",
        labels: ["v3"],
        baseToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
        quoteToken: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        liquidity: { usd: 12345 },
        volume: { h24: 999 },
      },
    ];

    const execFile = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ name: "liquidity-planner", path: skillDir, scope: "project" }]),
      stderr: "",
    });

    const fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")) {
        return new Response(JSON.stringify(usdcPools), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/0x4200000000000000000000000000000000000006")) {
        return new Response(JSON.stringify(wethPools), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const plan = planUniswapLiquidityPlannerInvocation(
      { chain: "base", tokenA: "USDC", tokenB: "ETH", positionType: "v3" },
      { PHALANX_UNISWAP_SKILLS_PROJECT_ROOT: dir },
    );
    expect(plan.status).toBe("planned");

    const exec = await executeUniswapLiquidityPlannerInvocation(plan, process.env, {
      fetchImpl: fetch as unknown as typeof fetch,
      execFileImpl: execFile,
    });

    expect(exec.status).toBe("completed");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(exec.runtimeDownstream?.payloadTemplate?.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(exec.runtimeDownstream?.topUniswapPools).toHaveLength(2);
  });
});
