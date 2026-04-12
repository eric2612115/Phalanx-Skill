import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";

import {
  buildOnchainosContractCallCommand,
  buildOnchainosDefiListCommand,
  buildOnchainosDefiPositionDetailCommand,
  buildOnchainosDefiPositionsCommand,
  buildOnchainosExecutionCommand,
  buildOnchainosSwapExecutionCommand,
  buildOnchainosWalletBalanceCommand,
  buildOnchainosWalletSendCommand,
  buildOnchainosTxDetailCommand,
  buildOnchainosX402PaymentCommand,
  buildOnchainosRuntimeEnv,
  executeOnchainosDefiExecution,
  executeOnchainosWalletSend,
  executeOnchainosX402Payment,
  extractOnchainosDefiPositionIdentifiers,
  listOnchainosCapabilities,
  parseOnchainosDefiProducts,
  parseOnchainosDefiExecutionPlan,
  parseOnchainosTxDetailStatus,
  portfolioPathContract,
  readOnchainosDefiList,
  readOnchainosWalletBalance,
  readOnchainosDefiPositionDetail,
  readOnchainosDefiPositions,
  readOnchainosPortfolio,
} from "../src/adapters/onchainos.ts";
import {
  planSweepToOwnerTransfers,
  resolveOwnerWithdrawConfig,
} from "../src/adapters/owner-withdraw.ts";
import {
  executeOmRateQuery,
  planOmRateQuery,
  probeOmRateHttp,
  summarizeOmRateAdapterEnv,
} from "../src/adapters/omrate.ts";
import {
  executePancakeSwapLpReadPlan,
  executePancakeSwapSwapQuotePlan,
  planPancakeSwapLpRead,
  planPancakeSwapSwapQuoteExecution,
} from "../src/adapters/pancakeswap.ts";
import {
  discoverUniswapPlannerSkill,
  executeUniswapLiquidityPlannerInvocation,
  executeUniswapLpReadPlan,
  executeUniswapSwapQuotePlan,
  planUniswapLpRead,
  planUniswapLiquidityPlannerInvocation,
  planUniswapSwapQuoteExecution,
} from "../src/adapters/uniswap.ts";
import {
  assessX402PaymentReadiness,
  buildExactEvmX402PaymentProof,
  decodePaymentRequiredHeader,
  parseOnchainosX402PaymentStdout,
  describeX402AdapterSurface,
  probeHttpWithOptionalX402Payment,
  resolvePaymentAwareFetch,
  x402PaymentAwareSummary,
} from "../src/adapters/x402.ts";
import {
  buildWhitelistContractLiveConfig,
  buildWhitelistContractWriteConfig,
  checkWhitelist,
  checkWhitelistWithContract,
  interpolateWhitelistCheckArgv,
  parseAllowlistFromEnv,
  parseShellCommandWords,
  readWhitelistContractAllowance,
  summarizeWhitelistEnvCommandProbe,
  writeWhitelistContractAllowance,
} from "../src/adapters/whitelist-contract.ts";
import {
  extractWhitelistPolicyAddress,
  runDeployWhitelist,
  writeWhitelistPolicyAddressToConfig,
} from "../scripts/deploy-whitelist.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("whitelist-contract", () => {
  it("checkWhitelist returns normalized JSON with required fields", () => {
    const r = checkWhitelist({ target: "0xabc", allowlist: ["0xabc", "0xdef"] });
    expect(r).toMatchObject({
      target: "0xabc",
      allowed: true,
      canExecute: true,
      reason: expect.any(String),
    });
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("denies unknown targets when allowlist is non-empty", () => {
    const r = checkWhitelist({ target: "0xbad", allowlist: ["0xabc"] });
    expect(r.allowed).toBe(false);
    expect(r.canExecute).toBe(false);
    expect(r.target).toBe("0xbad");
  });

  it("parseAllowlistFromEnv reads PHALANX_WHITELIST", () => {
    expect(parseAllowlistFromEnv({ PHALANX_WHITELIST: " a , b " })).toEqual(["a", "b"]);
  });

  it("buildWhitelistContractLiveConfig degrades when RPC or address missing", () => {
    expect(buildWhitelistContractLiveConfig({})).toMatchObject({ ready: false });
    expect(buildWhitelistContractLiveConfig({ BASE_RPC_URL: "https://x" })).toMatchObject({
      ready: false,
    });
  });

  it("readWhitelistContractAllowance skips when not configured", async () => {
    const r = await readWhitelistContractAllowance("0x1111111111111111111111111111111111111111", {});
    expect(r.status).toBe("not_configured");
  });

  it("checkWhitelistWithContract matches list-only when live config absent", async () => {
    const r = await checkWhitelistWithContract(
      { target: "0xabc", allowlist: ["0xabc"] },
      {},
    );
    expect(r.allowed).toBe(true);
    expect(r.combinedReason).toBe("target_in_allowlist");
  });

  it("buildWhitelistContractLiveConfig rejects invalid policy address", () => {
    expect(
      buildWhitelistContractLiveConfig({
        BASE_RPC_URL: "https://rpc.example",
        WHITELIST_POLICY_ADDRESS: "not-an-address",
      }),
    ).toMatchObject({ ready: false, reason: "invalid_policy_address" });
  });

  it("buildWhitelistContractLiveConfig is ready when rpc and address are valid", () => {
    const r = buildWhitelistContractLiveConfig({
      BASE_RPC_URL: "https://rpc.example",
      WHITELIST_POLICY_ADDRESS: "0x1111111111111111111111111111111111111111",
    });
    expect(r.ready).toBe(true);
    if (r.ready) {
      expect(r.config.rpcUrl).toContain("rpc.example");
      expect(r.config.policyAddress).toMatch(/^0x/);
    }
  });

  it("buildWhitelistContractWriteConfig requires rpc, address, and owner key", () => {
    expect(
      buildWhitelistContractWriteConfig({
        BASE_RPC_URL: "https://rpc.example",
        WHITELIST_POLICY_ADDRESS: "0x1111111111111111111111111111111111111111",
      }),
    ).toMatchObject({ ready: false, reason: "invalid_policy_owner_key" });
  });

  it("writeWhitelistContractAllowance rejects non-address targets before chain I/O", async () => {
    const result = await writeWhitelistContractAllowance("uniswap-v3", true, {});
    expect(result.status).toBe("invalid_target");
  });

  it("parseShellCommandWords handles quotes", () => {
    expect(parseShellCommandWords(`cast call '0xabc' "isAllowed(address)"`)).toEqual([
      "cast",
      "call",
      "0xabc",
      "isAllowed(address)",
    ]);
  });

  it("interpolateWhitelistCheckArgv replaces target tokens", () => {
    expect(interpolateWhitelistCheckArgv(["echo", "{target}"], "0xabc")).toEqual(["echo", "0xabc"]);
  });

  it("summarizeWhitelistEnvCommandProbe normalizes probe records", () => {
    const ok = summarizeWhitelistEnvCommandProbe({
      argv: ["true"],
      ok: true,
      exitCode: 0,
      stdout: "yes",
      stderr: "",
    });
    expect(ok.status).toBe("completed");

    const missing = summarizeWhitelistEnvCommandProbe({
      argv: ["nope-bin-xyz"],
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      spawnError: { code: "ENOENT", message: "not found" },
    });
    expect(missing.status).toBe("tool_missing");
  });
});

describe("omrate adapter (contract)", () => {
  it("planOmRateQuery is x402-aware conceptually without requiring credentials", () => {
    const withX = planOmRateQuery(
      { path: "/v1/foo", method: "GET", x402Aware: true },
      { OMRATE_API_BASE: "https://api.example" },
    );
    expect(withX.provider).toBe("omrate");
    expect(withX.x402.required).toBe(true);
    expect(withX.request.path).toBe("/v1/foo");
    expect(withX.status).toBe("planned");
  });

  it("marks tool_missing when base URL is absent", () => {
    const r = planOmRateQuery({ path: "/x" }, {});
    expect(r.status).toBe("tool_missing");
    expect(r.summary.toLowerCase()).toMatch(/base|omrate|url/i);
  });

  it("executeOmRateQuery skips when base URL is absent", async () => {
    const r = await executeOmRateQuery({ path: "/health" }, {});
    expect(r.status).toBe("skipped");
  });

  it("executeOmRateQuery uses mock fetch when planned", async () => {
    const mockFetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const r = await executeOmRateQuery(
      { path: "/v1/ping", method: "GET" },
      { OMRATE_API_BASE: "https://api.test", OMRATE_API_KEY: "k" },
      { fetch: mockFetch },
    );
    expect(r.status).toBe("completed");
    expect(mockFetch).toHaveBeenCalled();
    expect(r.paymentWrapped).toBe(false);
  });

  it("summarizeOmRateAdapterEnv reflects base and key presence", () => {
    const empty = summarizeOmRateAdapterEnv({});
    expect(empty.baseConfigured).toBe(false);
    const ok = summarizeOmRateAdapterEnv({
      OMRATE_API_BASE: "https://api.example/",
      OMRATE_API_KEY: "secret",
    });
    expect(ok.baseConfigured).toBe(true);
    expect(ok.apiKeyConfigured).toBe(true);
  });

  it("probeOmRateHttp skips when base URL is absent", async () => {
    const r = await probeOmRateHttp({ path: "/health" }, {});
    expect(r.provider).toBe("omrate");
    expect(r.status).toBe("skipped");
    expect(r.env.baseConfigured).toBe(false);
  });

  it("probeOmRateHttp uses mock fetch when base is configured", async () => {
    const mockFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await probeOmRateHttp(
      { path: "/ok" },
      { OMRATE_API_BASE: "https://api.test" },
      { fetch: mockFetch },
    );
    expect(r.status).toBe("completed");
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe("x402 adapter (contract)", () => {
  it("describeX402AdapterSurface returns stable contract fields", () => {
    const s = describeX402AdapterSurface();
    expect(s.provider).toBe("x402");
    expect(s.layers).toContain("payment");
    expect(s.notes.some((n) => n.length > 0)).toBe(true);
  });

  it("x402PaymentAwareSummary does not require npm or network", () => {
    const r = x402PaymentAwareSummary({ resource: "https://pay.example/resource" });
    expect(r.status).toBe("unsupported");
    expect(r.paymentLayer).toBe("x402");
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it("resolvePaymentAwareFetch stays plain when payment disabled", async () => {
    const r = await resolvePaymentAwareFetch({}, globalThis.fetch);
    expect(r.paymentWrapped).toBe(false);
    expect(r.fetchImpl).toBe(globalThis.fetch);
  });

  it("assessX402PaymentReadiness stays unsupported when payment disabled", async () => {
    const r = await assessX402PaymentReadiness({});
    expect(r.status).toBe("unsupported");
  });

  it("probeHttpWithOptionalX402Payment uses plain mode and mock fetch", async () => {
    const mockFetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await probeHttpWithOptionalX402Payment("https://example.test/x", {}, {
      paymentMode: "plain",
      fetch: mockFetch,
    });
    expect(r.status).toBe("completed");
    expect(r.paymentWrapped).toBe(false);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("decodePaymentRequiredHeader parses OmRate PAYMENT-REQUIRED", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        accepts: [{ network: "eip155:196", amount: "1000", asset: "0xasset", payTo: "0xpayto", scheme: "exact" }],
      }),
      "utf8",
    ).toString("base64");

    const decoded = decodePaymentRequiredHeader(encoded);
    expect(decoded.x402Version).toBe(1);
    expect(decoded.accepts[0]?.network).toBe("eip155:196");
  });

  it("parseOnchainosX402PaymentStdout extracts authorization and signature", () => {
    const parsed = parseOnchainosX402PaymentStdout(
      JSON.stringify({
        ok: true,
        data: {
          authorization: {
            from: "0xfrom",
            nonce: "0xnonce",
            to: "0xto",
            validAfter: "0",
            validBefore: "123",
            value: "1000",
          },
          signature: "0xsig",
        },
      }),
    );

    expect(parsed?.authorization.from).toBe("0xfrom");
    expect(parsed?.signature).toBe("0xsig");
  });

  it("buildExactEvmX402PaymentProof wraps onchainos output into replay proof", () => {
    const proof = buildExactEvmX402PaymentProof({
      requestUrl: "http://127.0.0.1:8006/markets/demo/history?interval=1h",
      accept: {
        scheme: "exact",
        network: "eip155:196",
        amount: "1000",
        asset: "0xasset",
        payTo: "0xpayto",
        maxTimeoutSeconds: 300,
        extra: { name: "USDT0", version: "1" },
      },
      payment: {
        authorization: {
          from: "0xfrom",
          nonce: "0xnonce",
          to: "0xto",
          validAfter: "0",
          validBefore: "123",
          value: "1000",
        },
        signature: "0xsig",
      },
    });

    const decoded = JSON.parse(Buffer.from(proof, "base64").toString("utf8"));
    expect(decoded.paymentPayload.payload.signature).toBe("0xsig");
    expect(decoded.paymentRequirements.resource).toBe("http://127.0.0.1:8006/markets/demo/history?interval=1h");
    expect(decoded.chainIndex).toBe("196");
  });
});

describe("deploy-whitelist script (contract)", () => {
  it("returns unsupported when PHALANX_WHITELIST_DEPLOY_CMD is unset", async () => {
    const r = await runDeployWhitelist({});
    expect(r.status).toBe("unsupported");
    expect(r.summary.toLowerCase()).toMatch(/docker|review|not executed|phalanx_whitelist_deploy_cmd/i);
  });

  it("extractWhitelistPolicyAddress finds an address in deploy output", () => {
    const address = extractWhitelistPolicyAddress(
      "deployment complete\nWhitelistPolicy deployed at 0x1111111111111111111111111111111111111111\n",
    );
    expect(address).toBe("0x1111111111111111111111111111111111111111");
  });

  it("writeWhitelistPolicyAddressToConfig persists the deployed address", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-whitelist-config-"));
    const configPath = join(dir, "config.env");
    writeFileSync(configPath, "PHALANX_RUNTIME_MODE=live\n", "utf8");

    const outcome = writeWhitelistPolicyAddressToConfig(
      "0x1111111111111111111111111111111111111111",
      configPath,
    );

    expect(outcome.updated).toBe(true);
    expect(readFileSync(configPath, "utf8")).toContain(
      "WHITELIST_POLICY_ADDRESS=0x1111111111111111111111111111111111111111",
    );
  });
});

describe("uniswap adapter swap quote (contract)", () => {
  it("discoverUniswapPlannerSkill returns tool_missing when no skill root is configured", () => {
    const emptyPwd = mkdtempSync(join(tmpdir(), "phalanx-uniswap-empty-"));
    const discovery = discoverUniswapPlannerSkill({ PWD: emptyPwd } as NodeJS.ProcessEnv);
    expect(discovery.status).toBe("tool_missing");
  });

  it("discoverUniswapPlannerSkill finds liquidity-planner skill under configured root", () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-uniswap-skill-"));
    const root = join(dir, "uniswap-ai");
    const skillDir = join(root, "packages/plugins/uniswap-driver/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# liquidity planner\n", {
      encoding: "utf8",
      flag: "w",
    });

    const discovery = discoverUniswapPlannerSkill({
      PHALANX_UNISWAP_SKILL_ROOT: root,
    });

    expect(discovery.status).toBe("available");
    expect(discovery.skillFile).toContain("liquidity-planner/SKILL.md");
  });

  it("planUniswapLiquidityPlannerInvocation degrades without installed skill", () => {
    const emptyPwd = mkdtempSync(join(tmpdir(), "phalanx-uniswap-empty-"));
    const plan = planUniswapLiquidityPlannerInvocation(
      {
        chain: "base",
        tokenA: "ETH",
        tokenB: "USDC",
        positionType: "v3",
      },
      { PWD: emptyPwd } as NodeJS.ProcessEnv,
    );
    expect(plan.status).toBe("tool_missing");
  });

  it("executeUniswapLiquidityPlannerInvocation skips when planner plan is not planned", async () => {
    const emptyPwd = mkdtempSync(join(tmpdir(), "phalanx-uniswap-empty-"));
    const plan = planUniswapLiquidityPlannerInvocation(
      { chain: "base", tokenA: "ETH", tokenB: "USDC", positionType: "v3" },
      { PWD: emptyPwd } as NodeJS.ProcessEnv,
    );
    const exec = await executeUniswapLiquidityPlannerInvocation(plan, { PWD: emptyPwd } as NodeJS.ProcessEnv);
    expect(exec.status).toBe("skipped");
    expect(exec.officialSurface).toBeUndefined();
  });

  it("executeUniswapLiquidityPlannerInvocation rejects non-official skill markdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-uniswap-bad-skill-"));
    const root = join(dir, "uniswap-ai");
    const skillDir = join(root, "packages/plugins/uniswap-driver/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: not-the-official-skill\nmetadata:\n author: other\n---\n\nbody\n",
      "utf8",
    );

    const plan = planUniswapLiquidityPlannerInvocation(
      { chain: "base", tokenA: "ETH", tokenB: "USDC", positionType: "v3" },
      { PHALANX_UNISWAP_SKILL_ROOT: root, PWD: dir } as NodeJS.ProcessEnv,
    );
    expect(plan.status).toBe("planned");
    const exec = await executeUniswapLiquidityPlannerInvocation(
      plan,
      { PHALANX_UNISWAP_SKILL_ROOT: root, PWD: dir } as NodeJS.ProcessEnv,
    );
    expect(exec.status).toBe("invalid_official_skill");
    expect(exec.summary.toLowerCase()).toMatch(/official|uniswap|liquidity-planner/i);
  });

  it("executeUniswapLiquidityPlannerInvocation completes on official-shaped liquidity-planner SKILL.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phalanx-uniswap-good-skill-"));
    const root = join(dir, "uniswap-ai");
    const skillDir = join(root, "packages/plugins/uniswap-driver/skills/liquidity-planner");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: liquidity-planner",
        "description: Test stub matching Uniswap/uniswap-ai skill contract.",
        "metadata:",
        " author: uniswap",
        " version: '0.2.0'",
        "---",
        "",
        "# Liquidity Position Planning",
        "",
        "Base URL: `https://app.uniswap.org/positions/create`",
        "",
      ].join("\n"),
      "utf8",
    );

    const plan = planUniswapLiquidityPlannerInvocation(
      { chain: "base", tokenA: "ETH", tokenB: "USDC", positionType: "v3" },
      { PHALANX_UNISWAP_SKILL_ROOT: root },
    );
    expect(plan.status).toBe("planned");
    const exec = await executeUniswapLiquidityPlannerInvocation(
      plan,
      { PHALANX_UNISWAP_SKILL_ROOT: root },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    expect(exec.status).toBe("completed");
    expect(exec.officialSurface).toMatchObject({
      skillName: "liquidity-planner",
      author: "uniswap",
      skillFile: expect.stringContaining("liquidity-planner/SKILL.md"),
    });
    expect(exec.downstream?.deepLinkBase).toBe("https://app.uniswap.org/positions/create");
    expect(exec.downstream?.positionType).toBe("v3");
    expect(exec.dataPlane?.uniswapPools).toEqual([]);
    expect(exec.runtimeDownstream?.executionTarget).toBe("uniswap-v3");
  });

  it("planUniswapSwapQuoteExecution marks invalid_input for bad amount", () => {
    const p = planUniswapSwapQuoteExecution({
      chain: "base",
      tokenIn: "0x2222222222222222222222222222222222222222",
      tokenOut: "0x3333333333333333333333333333333333333333",
      amountIn: "not-a-uint",
    });
    expect(p.status).toBe("invalid_input");
  });

  it("planUniswapSwapQuoteExecution is live_config_missing without quoter", () => {
    const p = planUniswapSwapQuoteExecution(
      {
        chain: "base",
        tokenIn: "0x2222222222222222222222222222222222222222",
        tokenOut: "0x3333333333333333333333333333333333333333",
        amountIn: "1",
      },
      { BASE_RPC_URL: "https://rpc.example" },
    );
    expect(p.status).toBe("live_config_missing");
  });

  it("executeUniswapSwapQuotePlan skips when plan is not live_ready", async () => {
    const plan = planUniswapSwapQuoteExecution(
      { chain: "base", tokenIn: "0x2222222222222222222222222222222222222222", tokenOut: "0x3333333333333333333333333333333333333333", amountIn: "1" },
      {},
    );
    const r = await executeUniswapSwapQuotePlan(plan);
    expect(r.status).toBe("skipped");
  });
});

describe("pancakeswap adapter swap quote (contract)", () => {
  it("planPancakeSwapSwapQuoteExecution marks invalid_input for bad amount", () => {
    const p = planPancakeSwapSwapQuoteExecution({
      chain: "bsc",
      tokenIn: "0x2222222222222222222222222222222222222222",
      tokenOut: "0x3333333333333333333333333333333333333333",
      amountIn: "-1",
    });
    expect(p.status).toBe("invalid_input");
  });

  it("executePancakeSwapSwapQuotePlan skips without full routing", async () => {
    const plan = planPancakeSwapSwapQuoteExecution(
      {
        chain: "bsc",
        tokenIn: "0x2222222222222222222222222222222222222222",
        tokenOut: "0x3333333333333333333333333333333333333333",
        amountIn: "1",
      },
      {},
    );
    const r = await executePancakeSwapSwapQuotePlan(plan);
    expect(r.status).toBe("skipped");
  });
});

describe("uniswap / pancakeswap LP read (contract)", () => {
  it("planUniswapLpRead degrades without full live config", () => {
    const p = planUniswapLpRead({ chain: "base" }, {});
    expect(p.status).toBe("live_config_missing");
  });

  it("executeUniswapLpReadPlan skips when live config missing", async () => {
    const p = planUniswapLpRead({ chain: "base" }, {});
    const r = await executeUniswapLpReadPlan(p);
    expect(r.status).toBe("skipped");
  });

  it("planPancakeSwapLpRead degrades without full live config", () => {
    const p = planPancakeSwapLpRead({ chain: "bsc" }, {});
    expect(p.status).toBe("live_config_missing");
  });

  it("executePancakeSwapLpReadPlan skips when live config missing", async () => {
    const p = planPancakeSwapLpRead({ chain: "bsc" }, {});
    const r = await executePancakeSwapLpReadPlan(p);
    expect(r.status).toBe("skipped");
  });
});

describe("onchainos adapter (contract)", () => {
  it("listOnchainosCapabilities does not throw and returns normalized shape", async () => {
    const r = await listOnchainosCapabilities("base");
    expect(r.provider).toBe("onchainos");
    expect(["available", "tool_missing", "failed"]).toContain(r.status);
    expect(Array.isArray(r.capabilities)).toBe(true);
    expect(r).toHaveProperty("summary");
  });

  it("portfolioPathContract describes CLI template without requiring binary", () => {
    const r = portfolioPathContract("base");
    expect(r.provider).toBe("onchainos");
    expect(r.path.type).toBe("cli");
    expect(r.path.argvTemplate.join(" ")).toContain("portfolio all-balances");
    expect(r.path.argvTemplate).toContain("--chains");
    expect(r.baseline).toMatch(/docker|review/i);
  });

  it("buildOnchainosRuntimeEnv forwards OKX credentials without leaking unrelated keys", () => {
    const env = buildOnchainosRuntimeEnv({
      OKX_API_KEY: "key",
      OKX_API_SECRET: "secret",
      OKX_API_PASSPHRASE: "pass",
      FOO: "bar",
    });

    expect(env.OKX_API_KEY).toBe("key");
    expect(env.OKX_API_SECRET).toBe("secret");
    expect(env.OKX_API_PASSPHRASE).toBe("pass");
    expect(env.OKX_SECRET_KEY).toBe("secret");
    expect(env.OKX_PASSPHRASE).toBe("pass");
    expect(env.FOO).toBeUndefined();
  });

  it("buildOnchainosExecutionCommand shapes a lending invest argv", () => {
    const cmd = buildOnchainosExecutionCommand({
      kind: "lending_deposit",
      investmentId: "aave-usdt",
      address: "0x1111111111111111111111111111111111111111",
      token: "USDT",
      amount: "1",
      chain: "base",
    });

    expect(cmd.argv.join(" ")).toContain("onchainos defi invest");
    expect(cmd.argv).toContain("--investment-id");
    expect(cmd.argv).toContain("aave-usdt");
  });

  it("buildOnchainosExecutionCommand shapes a lending withdraw argv", () => {
    const cmd = buildOnchainosExecutionCommand({
      kind: "lending_withdraw",
      investmentId: "morpho-usdc",
      address: "0x1111111111111111111111111111111111111111",
      chain: "ethereum",
      ratio: "1",
      platformId: "morpho",
    });

    expect(cmd.argv.join(" ")).toContain("onchainos defi withdraw");
    expect(cmd.argv).toContain("--investment-id");
    expect(cmd.argv).toContain("morpho-usdc");
    expect(cmd.argv).toContain("--ratio");
  });

  it("buildOnchainosExecutionCommand shapes an LP deposit argv", () => {
    const cmd = buildOnchainosExecutionCommand({
      kind: "lp_deposit",
      protocol: "uniswap-v3",
      investmentId: "uniswap-base-weth-usdc-v3",
      address: "0x1111111111111111111111111111111111111111",
      chain: "base",
      token: "USDC",
      amount: "1000000",
      tokenSecondary: "ETH",
      amountSecondary: "500000000000000",
      range: "5",
    });

    expect(cmd.argv.join(" ")).toContain("onchainos defi invest");
    expect(cmd.argv).toContain("--investment-id");
    expect(cmd.argv).toContain("uniswap-base-weth-usdc-v3");
    expect(cmd.argv).toContain("--token2");
    expect(cmd.argv).toContain("ETH");
    expect(cmd.argv).toContain("--amount2");
    expect(cmd.argv).toContain("500000000000000");
    expect(cmd.argv).toContain("--range");
    expect(cmd.argv).toContain("5");
    expect(cmd.argv).not.toContain("--platform-id");
  });

  it("buildOnchainosExecutionCommand shapes an LP withdraw argv", () => {
    const cmd = buildOnchainosExecutionCommand({
      kind: "lp_withdraw",
      protocol: "pancakeswap-v3",
      investmentId: "pancake-bsc-bnb-usdt-v3",
      address: "0x1111111111111111111111111111111111111111",
      chain: "bsc",
      platformId: "98765",
      tokenId: "12345",
      ratio: "1",
    });

    expect(cmd.argv.join(" ")).toContain("onchainos defi withdraw");
    expect(cmd.argv).toContain("--platform-id");
    expect(cmd.argv).toContain("98765");
    expect(cmd.argv).toContain("--token-id");
    expect(cmd.argv).toContain("12345");
    expect(cmd.argv).not.toContain("--collect-fees");
    expect(cmd.argv).not.toContain("--pool-address");
  });

  it("buildOnchainosDefiListCommand shapes a paginated product discovery argv", () => {
    const cmd = buildOnchainosDefiListCommand({
      chain: "base",
      pageNum: 3,
    });

    expect(cmd.argv).toEqual(["onchainos", "defi", "list", "--chain", "base", "--page-num", "3"]);
  });

  it("parseOnchainosDefiProducts normalizes numeric investment ids into strings", () => {
    const products = parseOnchainosDefiProducts(
      JSON.stringify({
        ok: true,
        data: {
          list: [
            {
              chainIndex: "8453",
              investmentId: 22709,
              name: "USDC/ETH",
              platformName: "Uniswap V3",
              productGroup: "LP",
              detailPath: "/defi/uniswap/22709",
            },
          ],
        },
      }),
    );

    expect(products).toEqual([
      {
        chainIndex: "8453",
        investmentId: "22709",
        name: "USDC/ETH",
        platformName: "Uniswap V3",
        productGroup: "LP",
        detailPath: "/defi/uniswap/22709",
      },
    ]);
  });

  it("extractOnchainosDefiPositionIdentifiers finds platform and token ids recursively", () => {
    const identifiers = extractOnchainosDefiPositionIdentifiers(
      JSON.stringify({
        ok: true,
        data: {
          groups: [
            {
              analysisPlatformId: "777",
              positions: [
                {
                  tokenId: "12345",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(identifiers.platformIds).toEqual(["777"]);
    expect(identifiers.tokenIds).toEqual(["12345"]);
  });

  it("parseOnchainosDefiExecutionPlan extracts contract-call steps from stdout", () => {
    const parsed = parseOnchainosDefiExecutionPlan(
      JSON.stringify({
        ok: true,
        data: {
          dataList: [
            {
              callDataType: "APPROVE",
              from: "0x1111111111111111111111111111111111111111",
              to: "0x2222222222222222222222222222222222222222",
              serializedData: "0xaaaa",
              value: "0x0",
            },
            {
              callDataType: "DEPOSIT",
              from: "0x1111111111111111111111111111111111111111",
              to: "0x3333333333333333333333333333333333333333",
              serializedData: "0xbbbb",
              value: "0x0",
            },
          ],
        },
      }),
    );

    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]?.callDataType).toBe("APPROVE");
    expect(parsed?.[1]?.serializedData).toBe("0xbbbb");
  });

  it("buildOnchainosContractCallCommand shapes wallet contract-call argv", () => {
    const cmd = buildOnchainosContractCallCommand({
      chain: "base",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      inputData: "0xaaaa",
      force: true,
    });

    expect(cmd.argv.join(" ")).toContain("onchainos wallet contract-call");
    expect(cmd.argv).toContain("8453");
    expect(cmd.argv).toContain("--input-data");
    expect(cmd.argv).toContain("0xaaaa");
    expect(cmd.argv).toContain("--force");
  });

  it("buildOnchainosTxDetailCommand shapes wallet history tx-hash argv", () => {
    const cmd = buildOnchainosTxDetailCommand({
      address: "0x1111111111111111111111111111111111111111",
      chain: "8453",
      txHash: "0xabc",
    });

    expect(cmd.argv.join(" ")).toContain("onchainos wallet history");
    expect(cmd.argv).toContain("--tx-hash");
    expect(cmd.argv).toContain("0xabc");
  });

  it("parseOnchainosTxDetailStatus extracts SUCCESS from history response", () => {
    const parsed = parseOnchainosTxDetailStatus(
      JSON.stringify({
        ok: true,
        data: [
          {
            txHash: "0xabc",
            txStatus: "SUCCESS",
          },
        ],
      }),
    );

    expect(parsed?.txHash).toBe("0xabc");
    expect(parsed?.txStatus).toBe("SUCCESS");
  });

  it("buildOnchainosSwapExecutionCommand shapes a skill-backed swap argv", () => {
    const cmd = buildOnchainosSwapExecutionCommand({
      fromTokenAddress: "0x1111111111111111111111111111111111111111",
      toTokenAddress: "0x2222222222222222222222222222222222222222",
      chain: "base",
      wallet: "0x3333333333333333333333333333333333333333",
      readableAmount: "1.5",
      slippage: "0.5",
    });

    expect(cmd.argv.join(" ")).toContain("onchainos swap execute");
    expect(cmd.argv).toContain("--wallet");
    expect(cmd.argv).toContain("0x3333333333333333333333333333333333333333");
    expect(cmd.argv).toContain("--readable-amount");
  });

  it("buildOnchainosX402PaymentCommand shapes a payment x402 argv", () => {
    const cmd = buildOnchainosX402PaymentCommand({
      network: "eip155:196",
      amount: "1000",
      payTo: "0x4444444444444444444444444444444444444444",
      asset: "0x5555555555555555555555555555555555555555",
      from: "0x6666666666666666666666666666666666666666",
      maxTimeoutSeconds: 600,
    });

    expect(cmd.argv.join(" ")).toContain("onchainos payment x402-pay");
    expect(cmd.argv).toContain("--network");
    expect(cmd.argv).toContain("eip155:196");
    expect(cmd.argv).toContain("--asset");
  });

  it("buildOnchainosWalletSendCommand shapes an ERC20 owner withdrawal argv", () => {
    const cmd = buildOnchainosWalletSendCommand({
      recipient: "0x4444444444444444444444444444444444444444",
      chain: "base",
      from: "0x1111111111111111111111111111111111111111",
      readableAmount: "1.5",
      contractToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      force: true,
    });

    expect(cmd.argv.join(" ")).toContain("onchainos wallet send");
    expect(cmd.argv).toContain("--receipt");
    expect(cmd.argv).toContain("0x4444444444444444444444444444444444444444");
    expect(cmd.argv).toContain("--chain");
    expect(cmd.argv).toContain("8453");
    expect(cmd.argv).toContain("--contract-token");
    expect(cmd.argv).toContain("--readable-amount");
    expect(cmd.argv).toContain("--force");
  });

  it("buildOnchainosWalletBalanceCommand shapes a wallet balance argv", () => {
    const cmd = buildOnchainosWalletBalanceCommand({
      chain: "base",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      force: true,
    });

    expect(cmd.argv.join(" ")).toContain("onchainos wallet balance");
    expect(cmd.argv).toContain("--chain");
    expect(cmd.argv).toContain("8453");
    expect(cmd.argv).toContain("--token-address");
    expect(cmd.argv).toContain("--force");
  });

  it("executeOnchainosX402Payment degrades cleanly when binary is missing", async () => {
    const result = await executeOnchainosX402Payment(
      {
        network: "eip155:196",
        amount: "1000",
        payTo: "0x4444444444444444444444444444444444444444",
        asset: "0x5555555555555555555555555555555555555555",
      },
      {
        PATH: "/definitely/missing",
      } as NodeJS.ProcessEnv,
    );

    expect(result.provider).toBe("onchainos");
    expect(result.lane).toBe("x402_payment");
    expect(result.status).toBe("tool_missing");
  });

  it("executeOnchainosWalletSend degrades cleanly when binary is missing", async () => {
    const result = await executeOnchainosWalletSend(
      {
        recipient: "0x4444444444444444444444444444444444444444",
        chain: "base",
        readableAmount: "1.5",
        contractToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
      {
        PATH: "/definitely/missing",
      } as NodeJS.ProcessEnv,
    );

    expect(result.provider).toBe("onchainos");
    expect(result.lane).toBe("wallet_send");
    expect(result.status).toBe("tool_missing");
  });

  it("executeOnchainosDefiExecution fans out generated calldata into contract-call steps", async () => {
    const calls: string[][] = [];
    const result = await executeOnchainosDefiExecution(
      {
        kind: "lending_deposit",
        investmentId: "42610",
        address: "0x1111111111111111111111111111111111111111",
        token: "USDC",
        amount: "100000",
        chain: "base",
      },
      {} as NodeJS.ProcessEnv,
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
                      callDataType: "APPROVE",
                      from: "0x1111111111111111111111111111111111111111",
                      to: "0x2222222222222222222222222222222222222222",
                      serializedData: "0xaaaa",
                      value: "0x0",
                    },
                    {
                      callDataType: "DEPOSIT",
                      from: "0x1111111111111111111111111111111111111111",
                      to: "0x3333333333333333333333333333333333333333",
                      serializedData: "0xbbbb",
                      value: "0x0",
                    },
                  ],
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
          return {
            argv: [command, ...args],
            ok: true,
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              data: {
                txHash: args.includes("0xaaaa") ? "0xapprove" : "0xdeposit",
              },
            }),
            stderr: "",
          };
        },
        delayImpl: async () => {},
      },
    );

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(5);
    expect(calls[1]?.join(" ")).toContain("wallet contract-call");
    expect(calls[2]?.join(" ")).toContain("wallet history");
    expect(calls[3]?.join(" ")).toContain("wallet contract-call");
    expect(calls[4]?.join(" ")).toContain("wallet history");
  });

  it("executeOnchainosDefiExecution polls tx progress before sending the next step", async () => {
    const calls: string[][] = [];
    let historyPolls = 0;
    const result = await executeOnchainosDefiExecution(
      {
        kind: "lending_deposit",
        investmentId: "42610",
        address: "0x1111111111111111111111111111111111111111",
        token: "USDC",
        amount: "100000",
        chain: "base",
      },
      {} as NodeJS.ProcessEnv,
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
                      callDataType: "APPROVE",
                      from: "0x1111111111111111111111111111111111111111",
                      to: "0x2222222222222222222222222222222222222222",
                      serializedData: "0xaaaa",
                      value: "0x0",
                    },
                    {
                      callDataType: "DEPOSIT",
                      from: "0x1111111111111111111111111111111111111111",
                      to: "0x3333333333333333333333333333333333333333",
                      serializedData: "0xbbbb",
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
              stdout: JSON.stringify({
                ok: true,
                data: {
                  txHash: args.includes("0xaaaa") ? "0xapprove" : "0xdeposit",
                },
              }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            historyPolls += 1;
            const txHash = args[args.indexOf("--tx-hash") + 1];
            const txStatus =
              txHash === "0xapprove" && historyPolls === 1 ? "PENDING" : "SUCCESS";
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: [{ txHash, txStatus }],
              }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
      },
    );

    expect(result.status).toBe("completed");
    expect(calls.map((entry) => entry.join(" "))).toEqual([
      expect.stringContaining("onchainos defi invest"),
      expect.stringContaining("onchainos wallet contract-call"),
      expect.stringContaining("onchainos wallet history"),
      expect.stringContaining("onchainos wallet history"),
      expect.stringContaining("onchainos wallet contract-call"),
      expect.stringContaining("onchainos wallet history"),
    ]);
  });

  it("executeOnchainosDefiExecution fails when polled tx status returns ERROR", async () => {
    const result = await executeOnchainosDefiExecution(
      {
        kind: "lending_deposit",
        investmentId: "42610",
        address: "0x1111111111111111111111111111111111111111",
        token: "USDC",
        amount: "100000",
        chain: "base",
      },
      {} as NodeJS.ProcessEnv,
      {
        runCmdImpl: async (command, args) => {
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
                      callDataType: "APPROVE",
                      from: "0x1111111111111111111111111111111111111111",
                      to: "0x2222222222222222222222222222222222222222",
                      serializedData: "0xaaaa",
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
              stdout: JSON.stringify({ ok: true, data: { txHash: "0xapprove" } }),
              stderr: "",
            };
          }
          if (args[0] === "wallet" && args[1] === "history") {
            return {
              argv: [command, ...args],
              ok: true,
              exitCode: 0,
              stdout: JSON.stringify({
                ok: true,
                data: [{ txHash: "0xapprove", txStatus: "ERROR", failReason: "underpriced" }],
              }),
              stderr: "",
            };
          }
          throw new Error(`unexpected call ${[command, ...args].join(" ")}`);
        },
        delayImpl: async () => {},
      },
    );

    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/underpriced|error/i);
  });

  it("executeOnchainosSwapExecution degrades cleanly when binary is missing", async () => {
    const { executeOnchainosSwapExecution } = await import("../src/adapters/onchainos.ts");
    const result = await executeOnchainosSwapExecution(
      {
        fromTokenAddress: "0x1111111111111111111111111111111111111111",
        toTokenAddress: "0x2222222222222222222222222222222222222222",
        chain: "base",
        wallet: "0x3333333333333333333333333333333333333333",
        readableAmount: "1.5",
      },
      {
        PATH: "/definitely/missing",
      } as NodeJS.ProcessEnv,
    );

    expect(result.provider).toBe("onchainos");
    expect(result.lane).toBe("swap_execute");
    expect(result.status).toBe("tool_missing");
  });

  it("readOnchainosPortfolio degrades cleanly when the binary is missing", async () => {
    const result = await readOnchainosPortfolio({
      address: "0x1111111111111111111111111111111111111111",
      chains: ["base"],
    });

    expect(result.provider).toBe("onchainos");
    expect(["completed", "failed", "tool_missing"]).toContain(result.status);
    expect(result.argv.join(" ")).toContain("portfolio all-balances");
  });

  it("readOnchainosWalletBalance degrades cleanly when the binary is missing", async () => {
    const result = await readOnchainosWalletBalance({
      chain: "base",
      env: { PATH: "/definitely/missing" } as NodeJS.ProcessEnv,
    });

    expect(result.provider).toBe("onchainos");
    expect(result.status).toBe("tool_missing");
    expect(result.argv.join(" ")).toContain("wallet balance");
  });

  it("readOnchainosTxDetail degrades cleanly when the binary is missing", async () => {
    const { readOnchainosTxDetail } = await import("../src/adapters/onchainos.ts");
    const result = await readOnchainosTxDetail({
      address: "0x1111111111111111111111111111111111111111",
      chain: "ethereum",
      txHash: "0x86626434b285a1f5ff88134aa3d690301297cc26e2971a1a880aff4c456c4549",
      env: { PATH: "/definitely/missing" } as NodeJS.ProcessEnv,
    });

    expect(result.provider).toBe("onchainos");
    expect(result.status).toBe("tool_missing");
    expect(result.argv.join(" ")).toContain("wallet history");
    expect(result.argv).toContain("--tx-hash");
  });

  it("buildOnchainosDefiPositionsCommand shapes the official overview argv", () => {
    expect(
      buildOnchainosDefiPositionsCommand({
        address: "0x1111111111111111111111111111111111111111",
        chains: ["base"],
        chain: "base",
      }).argv,
    ).toEqual([
      "onchainos",
      "defi",
      "positions",
      "--address",
      "0x1111111111111111111111111111111111111111",
      "--chains",
      "base",
      "--chain",
      "base",
    ]);
  });

  it("readOnchainosDefiPositions degrades cleanly when the binary is missing", async () => {
    const result = await readOnchainosDefiPositions({
      address: "0x1111111111111111111111111111111111111111",
      chains: ["base"],
      chain: "base",
      env: { PATH: "/definitely/missing" } as NodeJS.ProcessEnv,
    });

    expect(result.provider).toBe("onchainos");
    expect(result.status).toBe("tool_missing");
    expect(result.argv.join(" ")).toContain("defi positions");
  });

  it("readOnchainosDefiList degrades cleanly when the binary is missing", async () => {
    const result = await readOnchainosDefiList({
      chain: "base",
      pageNum: 1,
      env: { PATH: "/definitely/missing" } as NodeJS.ProcessEnv,
    });

    expect(result.provider).toBe("onchainos");
    expect(result.status).toBe("tool_missing");
    expect(result.argv.join(" ")).toContain("defi list");
  });

  it("readOnchainosDefiPositionDetail degrades cleanly when the binary is missing", async () => {
    const result = await readOnchainosDefiPositionDetail({
      address: "0x1111111111111111111111111111111111111111",
      chain: "base",
      platformId: "119170",
      env: { PATH: "/definitely/missing" } as NodeJS.ProcessEnv,
    });

    expect(result.provider).toBe("onchainos");
    expect(result.status).toBe("tool_missing");
    expect(result.argv.join(" ")).toContain("defi position-detail");
    expect(result.argv).toContain("--platform-id");
  });

  it("resolveOwnerWithdrawConfig requires a fixed owner address", () => {
    expect(resolveOwnerWithdrawConfig({})).toMatchObject({
      ready: false,
      reason: "missing_owner_address",
    });
  });

  it("planSweepToOwnerTransfers keeps gas reserve on native token while sweeping ERC20 balances", () => {
    const plan = planSweepToOwnerTransfers(
      {
        chain: "base",
        ownerAddress: "0x4444444444444444444444444444444444444444",
        gasReserveWei: "100000000000000",
      },
      [
        {
          chainId: "8453",
          symbol: "BASE_ETH",
          tokenAddress: "",
          rawBalance: "277757919042307",
          decimal: "18",
        },
        {
          chainId: "8453",
          symbol: "USDC",
          tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          rawBalance: "200000",
          decimal: "6",
        },
      ],
    );

    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") {
      throw new Error("expected planned sweep");
    }
    expect(plan.transfers).toEqual([
      {
        chain: "base",
        recipient: "0x4444444444444444444444444444444444444444",
        amt: "177757919042307",
        assetKind: "native",
      },
      {
        chain: "base",
        recipient: "0x4444444444444444444444444444444444444444",
        amt: "200000",
        contractToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        assetKind: "erc20",
      },
    ]);
  });
});
