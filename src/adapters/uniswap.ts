/**
 * Uniswap V3 LP adapter: explicit plan vs execution; viem reads when RPC, manager, and token id are configured.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { createPublicClient, http, type Abi, type Address } from "viem";
import { isAddress } from "viem";

const execFileAsync = promisify(execFile);

export type UniswapPlannerSkillDiscovery = {
  readonly provider: "uniswap";
  readonly lane: "liquidity_planner_skill";
  readonly status: "available" | "tool_missing";
  readonly summary: string;
  readonly skillRoot?: string;
  readonly skillFile?: string;
};

export type UniswapLiquidityPlannerInvocationInput = {
  readonly chain: string;
  readonly tokenA: string;
  readonly tokenB: string;
  readonly positionType: "v2" | "v3" | "v4";
};

export type UniswapPlannerDexPoolSummary = {
  readonly pairAddress?: string;
  readonly pairLabel?: string;
  readonly version?: string;
  readonly liquidityUsd?: number;
  readonly volumeH24?: number;
  readonly dexId?: string;
  readonly baseTokenSymbol?: string;
  readonly baseTokenAddress?: string;
  readonly quoteTokenSymbol?: string;
  readonly quoteTokenAddress?: string;
};

export type UniswapLiquidityPlannerInvocationPlan = {
  readonly provider: "uniswap";
  readonly lane: "liquidity_planner_skill";
  readonly status: "planned" | "tool_missing" | "invalid_input";
  readonly summary: string;
  readonly skillFile?: string;
  readonly prompt: string;
  /** Original invocation parameters (carried for official skill execution / downstream). */
  readonly input: UniswapLiquidityPlannerInvocationInput;
};

/** Result of loading and validating the on-disk Uniswap/uniswap-ai liquidity-planner SKILL.md surface. */
export type UniswapLiquidityPlannerExecutionResult = {
  readonly provider: "uniswap";
  readonly lane: "liquidity_planner_skill";
  readonly status: "skipped" | "completed" | "failed" | "invalid_official_skill";
  readonly summary: string;
  readonly officialSurface?: {
    readonly skillFile: string;
    readonly skillName: string;
    readonly skillVersion?: string;
    readonly author: string;
    readonly repositoryPath:
      | "packages/plugins/uniswap-driver/skills/liquidity-planner/SKILL.md"
      | ".agents/skills/liquidity-planner/SKILL.md";
  };
  readonly officialInvocation?: {
    readonly skillsCliListJson: {
      readonly cwd: string;
      readonly exitCode: number;
      readonly matchedLiquidityPlanner: boolean;
      readonly stderrTail?: string;
    };
  };
  readonly dataPlane?: {
    readonly source: "dexscreener_token_pairs_v1";
    readonly network: string;
    readonly tokenProbeAddress: string;
    readonly uniswapPools: readonly UniswapPlannerDexPoolSummary[];
  };
  readonly downstream?: {
    readonly deepLinkBase?: string;
    readonly planningPrompt: string;
    readonly chain: string;
    readonly tokenA: string;
    readonly tokenB: string;
    readonly positionType: "v2" | "v3" | "v4";
  };
  /** Structured handoff for runtime / execution lane (beyond logging). */
  readonly runtimeDownstream?: {
    readonly executionTarget: "uniswap-v3";
    readonly executionAction: "depositLpPosition";
    readonly positionCreateBaseUrl: string;
    readonly topUniswapPools: readonly UniswapPlannerDexPoolSummary[];
    readonly plannerInput: UniswapLiquidityPlannerInvocationInput;
    readonly payloadTemplate: {
      readonly protocol: "uniswap-v3";
      readonly chain: string;
      readonly investmentId: string;
      readonly token: string;
      readonly tokenSecondary: string;
      readonly amount: string;
      readonly amountSecondary: string;
      readonly range: string;
      readonly positionType: "v2" | "v3" | "v4";
      readonly poolAddress?: string;
    };
    readonly missingExecutionFields: readonly ("investmentId" | "amount" | "amountSecondary" | "range")[];
  };
};

/** Test / sandbox hooks (defaults: global fetch + npx skills list). */
export type UniswapPlannerExecutionHooks = {
  readonly fetchImpl?: typeof fetch;
  readonly execFileImpl?: (
    command: string,
    args: readonly string[],
    options: { cwd: string; maxBuffer?: number; encoding: "utf8" },
  ) => Promise<{ stdout: string; stderr: string }>;
};

const OFFICIAL_LIQUIDITY_PLANNER_SKILL_REL =
  "packages/plugins/uniswap-driver/skills/liquidity-planner/SKILL.md" as const;

const DEFAULT_UNISWAP_POSITION_CREATE_BASE = "https://app.uniswap.org/positions/create";

function extractYamlFrontmatter(skillMd: string): string | undefined {
  const m = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m?.[1];
}

function parseLiquidityPlannerOfficialFrontmatter(
  frontmatter: string,
): { ok: true; name: string; author: string; version?: string } | { ok: false } {
  const nameLine = frontmatter.match(/^\s*name:\s*(.+)$/m);
  const rawName = nameLine?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  if (rawName !== "liquidity-planner") {
    return { ok: false };
  }
  const authorLine = frontmatter.match(/^\s*author:\s*(.+)$/m);
  const rawAuthor = authorLine?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  if (rawAuthor.toLowerCase() !== "uniswap") {
    return { ok: false };
  }
  const verLine = frontmatter.match(/^\s*version:\s*(.+)$/m);
  const rawVer = verLine?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  return { ok: true, name: rawName, author: rawAuthor, version: rawVer || undefined };
}

const SKILLS_CLI_LIQUIDITY_PLANNER_SUFFIX = ".agents/skills/liquidity-planner/SKILL.md" as const;

function isTrustedLiquidityPlannerSkillPath(skillFile: string): boolean {
  const norm = skillFile.replace(/\\/g, "/");
  return (
    norm.endsWith(OFFICIAL_LIQUIDITY_PLANNER_SKILL_REL) ||
    norm.endsWith(SKILLS_CLI_LIQUIDITY_PLANNER_SUFFIX)
  );
}

function repositoryPathLabel(
  skillFile: string,
):
  | typeof OFFICIAL_LIQUIDITY_PLANNER_SKILL_REL
  | ".agents/skills/liquidity-planner/SKILL.md" {
  const norm = skillFile.replace(/\\/g, "/");
  if (norm.endsWith(OFFICIAL_LIQUIDITY_PLANNER_SKILL_REL)) {
    return OFFICIAL_LIQUIDITY_PLANNER_SKILL_REL;
  }
  return ".agents/skills/liquidity-planner/SKILL.md";
}

function inferUniswapSkillsProjectRootFromSkillFile(skillFile: string): string | undefined {
  const norm = skillFile.replace(/\\/g, "/");
  const suffix = "/.agents/skills/liquidity-planner/SKILL.md";
  if (!norm.toLowerCase().endsWith(suffix.toLowerCase())) {
    return undefined;
  }
  return skillFile.slice(0, skillFile.length - suffix.length);
}

function resolveSkillsVerifyCwd(skillFile: string, env: NodeJS.ProcessEnv): string | undefined {
  const inferred = inferUniswapSkillsProjectRootFromSkillFile(skillFile);
  if (inferred) return inferred;
  const forced = (env.PHALANX_UNISWAP_SKILLS_PROJECT_ROOT ?? "").trim();
  return forced || undefined;
}

function chainToDexScreenerNetwork(chain: string): string | undefined {
  const c = chain.trim().toLowerCase();
  const aliases: Record<string, string> = {
    base: "base",
    ethereum: "ethereum",
    eth: "ethereum",
    mainnet: "ethereum",
    arbitrum: "arbitrum",
    optimism: "optimism",
    polygon: "polygon",
    unichain: "unichain",
  };
  return aliases[c];
}

function resolveLiquidityPlannerProbeAddress(chain: string, token: string): string | undefined {
  const t = token.trim();
  if (isAddress(t)) return t;
  const net = chainToDexScreenerNetwork(chain);
  if (!net) return undefined;
  const sym = t.toLowerCase();
  const table: Record<string, Record<string, string>> = {
    base: {
      eth: "0x4200000000000000000000000000000000000006",
      weth: "0x4200000000000000000000000000000000000006",
      usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      usdbc: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    },
    ethereum: {
      eth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
  };
  return table[net]?.[sym];
}

function mapDexPoolRow(row: unknown): UniswapPlannerDexPoolSummary {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const dexId = typeof r.dexId === "string" ? r.dexId : undefined;
  const pairAddress = typeof r.pairAddress === "string" ? r.pairAddress : undefined;
  const labels = Array.isArray(r.labels) ? r.labels : [];
  const version = typeof labels[0] === "string" ? labels[0] : undefined;
  const baseToken =
    r.baseToken && typeof r.baseToken === "object" ? (r.baseToken as Record<string, unknown>) : {};
  const quoteToken =
    r.quoteToken && typeof r.quoteToken === "object" ? (r.quoteToken as Record<string, unknown>) : {};
  const bSym = typeof baseToken.symbol === "string" ? baseToken.symbol : "";
  const qSym = typeof quoteToken.symbol === "string" ? quoteToken.symbol : "";
  const bAddr = typeof baseToken.address === "string" ? baseToken.address : "";
  const qAddr = typeof quoteToken.address === "string" ? quoteToken.address : "";
  const pairLabel = bSym && qSym ? `${bSym}/${qSym}` : undefined;
  const liq = r.liquidity && typeof r.liquidity === "object" ? (r.liquidity as Record<string, unknown>) : {};
  const liquidityUsd = typeof liq.usd === "number" ? liq.usd : undefined;
  const vol = r.volume && typeof r.volume === "object" ? (r.volume as Record<string, unknown>) : {};
  const volumeH24 = typeof vol.h24 === "number" ? vol.h24 : undefined;
  return {
    dexId,
    pairAddress,
    pairLabel,
    version,
    liquidityUsd,
    volumeH24,
    baseTokenSymbol: bSym || undefined,
    baseTokenAddress: bAddr || undefined,
    quoteTokenSymbol: qSym || undefined,
    quoteTokenAddress: qAddr || undefined,
  };
}

function normalizePlannerTokenMatchKey(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "weth":
      return "eth";
    case "wbase":
      return "base";
    default:
      return normalized;
  }
}

function poolMatchesRequestedTokens(
  pool: UniswapPlannerDexPoolSummary,
  tokenA: string,
  tokenB: string,
): boolean {
  const requestedA = normalizePlannerTokenMatchKey(tokenA);
  const requestedB = normalizePlannerTokenMatchKey(tokenB);
  if (!requestedA || !requestedB) {
    return false;
  }
  const baseKeys = [
    normalizePlannerTokenMatchKey(pool.baseTokenSymbol),
    normalizePlannerTokenMatchKey(pool.baseTokenAddress),
  ].filter((value) => value.length > 0);
  const quoteKeys = [
    normalizePlannerTokenMatchKey(pool.quoteTokenSymbol),
    normalizePlannerTokenMatchKey(pool.quoteTokenAddress),
  ].filter((value) => value.length > 0);
  const forward = baseKeys.includes(requestedA) && quoteKeys.includes(requestedB);
  const reverse = baseKeys.includes(requestedB) && quoteKeys.includes(requestedA);
  return forward || reverse;
}

function pickRuntimePool(
  pools: readonly UniswapPlannerDexPoolSummary[],
  positionType: "v2" | "v3" | "v4",
  tokenA: string,
  tokenB: string,
): UniswapPlannerDexPoolSummary | undefined {
  const addressable = pools.filter((pool) => typeof pool.pairAddress === "string");
  return (
    addressable.find((pool) => pool.version === positionType && poolMatchesRequestedTokens(pool, tokenA, tokenB)) ??
    addressable.find((pool) => poolMatchesRequestedTokens(pool, tokenA, tokenB)) ??
    addressable.find((pool) => pool.version === positionType) ??
    addressable[0]
  );
}

function parseSkillsListForLiquidityPlanner(stdout: string): boolean {
  try {
    const data = JSON.parse(stdout) as unknown;
    if (!Array.isArray(data)) return false;
    return data.some(
      (x) => Boolean(x && typeof x === "object" && (x as { name?: string }).name === "liquidity-planner"),
    );
  } catch {
    return false;
  }
}

async function runSkillsListJsonVerify(
  cwd: string,
  execImpl: NonNullable<UniswapPlannerExecutionHooks["execFileImpl"]>,
): Promise<{ exitCode: number; matched: boolean; stderrTail?: string }> {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  try {
    const { stdout, stderr } = await execImpl(npx, ["--yes", "skills", "list", "--json"], {
      cwd,
      maxBuffer: 10_000_000,
      encoding: "utf8",
    });
    const matched = parseSkillsListForLiquidityPlanner(stdout);
    return { exitCode: 0, matched, stderrTail: stderr ? stderr.slice(-400) : undefined };
  } catch (e) {
    const err = e as { code?: number; stderr?: string | Buffer };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    const tail =
      typeof err.stderr === "string"
        ? err.stderr
        : Buffer.isBuffer(err.stderr)
          ? err.stderr.toString("utf8")
          : String(e);
    return { exitCode, matched: false, stderrTail: tail.slice(-400) };
  }
}

async function fetchUniswapPoolsDexScreener(
  network: string,
  tokenAddress: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; pools: UniswapPlannerDexPoolSummary[] } | { ok: false; summary: string }> {
  const url = `https://api.dexscreener.com/token-pairs/v1/${network}/${tokenAddress}`;
  try {
    const res = await fetchFn(url, { method: "GET" });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, summary: `DexScreener HTTP ${res.status}` };
    }
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return { ok: false, summary: "DexScreener response was not a JSON array" };
    }
    const uniswap = parsed
      .filter(
        (row) =>
          row &&
          typeof row === "object" &&
          typeof (row as { dexId?: string }).dexId === "string" &&
          String((row as { dexId: string }).dexId).toLowerCase() === "uniswap",
      )
      .map(mapDexPoolRow);
    return { ok: true, pools: uniswap };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, summary: msg.replace(/\s+/g, " ").slice(0, 200) };
  }
}

function mergeDexPoolSummaries(
  left: readonly UniswapPlannerDexPoolSummary[],
  right: readonly UniswapPlannerDexPoolSummary[],
): UniswapPlannerDexPoolSummary[] {
  const seen = new Set<string>();
  const merged: UniswapPlannerDexPoolSummary[] = [];
  for (const pool of [...left, ...right]) {
    const pairAddress = pool.pairAddress?.toLowerCase();
    const dedupeKey = pairAddress || `${pool.dexId ?? ""}:${pool.pairLabel ?? ""}:${pool.version ?? ""}`;
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    merged.push(pool);
  }
  return merged;
}

function extractDeepLinkBaseFromSkillMarkdown(skillMd: string): string | undefined {
  const m = skillMd.match(/https:\/\/app\.uniswap\.org\/positions\/create\b/);
  return m ? DEFAULT_UNISWAP_POSITION_CREATE_BASE : undefined;
}

/**
 * Execute the official Uniswap AI liquidity-planner path: validate installed SKILL.md,
 * run `npx skills list --json` when a skills-CLI project root is known, then run the
 * DexScreener token-pairs step documented in the official skill (Step 3).
 */
export async function executeUniswapLiquidityPlannerInvocation(
  plan: UniswapLiquidityPlannerInvocationPlan,
  env: NodeJS.ProcessEnv = process.env,
  hooks?: UniswapPlannerExecutionHooks,
): Promise<UniswapLiquidityPlannerExecutionResult> {
  if (plan.status !== "planned" || !plan.skillFile) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "skipped",
      summary:
        plan.status === "invalid_input"
          ? "Liquidity planner execution skipped: invalid planner input."
          : "Liquidity planner execution skipped: official skill not installed or not planned.",
    };
  }

  if (!isTrustedLiquidityPlannerSkillPath(plan.skillFile)) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "invalid_official_skill",
      summary:
        "Skill file is not a trusted Uniswap liquidity-planner path (uniswap-ai monorepo or skills CLI .agents install).",
    };
  }

  let raw: string;
  try {
    raw = readFileSync(plan.skillFile, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "failed",
      summary: `Failed to read skill file: ${msg.replace(/\s+/g, " ").slice(0, 200)}`,
    };
  }

  const fm = extractYamlFrontmatter(raw);
  if (fm === undefined) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "invalid_official_skill",
      summary: "SKILL.md missing YAML frontmatter; not a valid official liquidity-planner skill file.",
    };
  }

  const parsed = parseLiquidityPlannerOfficialFrontmatter(fm);
  if (!parsed.ok) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "invalid_official_skill",
      summary:
        "SKILL.md frontmatter does not match official liquidity-planner skill (expected name: liquidity-planner and metadata author uniswap).",
    };
  }

  const deepLinkBase = extractDeepLinkBaseFromSkillMarkdown(raw) ?? DEFAULT_UNISWAP_POSITION_CREATE_BASE;
  const { chain, tokenA, tokenB, positionType } = plan.input;

  const fetchFn = hooks?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const execImpl =
    hooks?.execFileImpl ??
    (async (command, args, options) => {
      const r = await execFileAsync(command, [...args], {
        cwd: options.cwd,
        maxBuffer: options.maxBuffer ?? 10_000_000,
        encoding: "utf8",
      });
      return { stdout: String(r.stdout), stderr: String(r.stderr) };
    });

  const verifyCwd = resolveSkillsVerifyCwd(plan.skillFile, env);
  let officialInvocation: UniswapLiquidityPlannerExecutionResult["officialInvocation"];
  if (verifyCwd) {
    const ver = await runSkillsListJsonVerify(verifyCwd, execImpl);
    officialInvocation = {
      skillsCliListJson: {
        cwd: verifyCwd,
        exitCode: ver.exitCode,
        matchedLiquidityPlanner: ver.matched,
        stderrTail: ver.stderrTail,
      },
    };
    if (ver.exitCode !== 0 || !ver.matched) {
      return {
        provider: "uniswap",
        lane: "liquidity_planner_skill",
        status: "failed",
        summary:
          ver.exitCode !== 0
            ? `Official skills CLI list failed (exit ${ver.exitCode}); install with: npx skills add Uniswap/uniswap-ai -y --skill liquidity-planner`
            : "skills list --json did not report liquidity-planner; official install missing or incomplete.",
        officialInvocation,
      };
    }
  }

  const net = chainToDexScreenerNetwork(chain);
  const primaryProbe = net ? resolveLiquidityPlannerProbeAddress(chain, tokenA) : undefined;
  const secondaryProbe = net ? resolveLiquidityPlannerProbeAddress(chain, tokenB) : undefined;
  if (!net || !primaryProbe) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "failed",
      summary:
        !net
          ? `Unsupported or unknown chain for DexScreener probe: ${chain}`
          : `Could not resolve probe token address for ${tokenA} on ${chain}; pass an ERC-20 address.`,
      officialSurface: {
        skillFile: plan.skillFile,
        skillName: parsed.name,
        skillVersion: parsed.version,
        author: parsed.author,
        repositoryPath: repositoryPathLabel(plan.skillFile),
      },
      officialInvocation,
    };
  }

  const primaryDex = await fetchUniswapPoolsDexScreener(net, primaryProbe, fetchFn);
  if (!primaryDex.ok) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "failed",
      summary: `Liquidity planner data plane failed: ${primaryDex.summary}`,
      officialSurface: {
        skillFile: plan.skillFile,
        skillName: parsed.name,
        skillVersion: parsed.version,
        author: parsed.author,
        repositoryPath: repositoryPathLabel(plan.skillFile),
      },
      officialInvocation,
    };
  }
  let pools = primaryDex.pools;
  if (secondaryProbe && secondaryProbe.toLowerCase() !== primaryProbe.toLowerCase()) {
    const secondaryDex = await fetchUniswapPoolsDexScreener(net, secondaryProbe, fetchFn);
    if (secondaryDex.ok) {
      pools = mergeDexPoolSummaries(primaryDex.pools, secondaryDex.pools);
    }
  }

  const dataPlane = {
    source: "dexscreener_token_pairs_v1" as const,
    network: net,
    tokenProbeAddress: primaryProbe,
    uniswapPools: pools,
  };

  const runtimePool = pickRuntimePool(pools, positionType, tokenA, tokenB);

  return {
    provider: "uniswap",
    lane: "liquidity_planner_skill",
    status: "completed",
    summary:
      "Official Uniswap liquidity-planner skill validated; skills CLI check (when applicable) and DexScreener pool discovery completed.",
    officialSurface: {
      skillFile: plan.skillFile,
      skillName: parsed.name,
      skillVersion: parsed.version,
      author: parsed.author,
      repositoryPath: repositoryPathLabel(plan.skillFile),
    },
    officialInvocation,
    dataPlane,
    downstream: {
      deepLinkBase,
      planningPrompt: plan.prompt,
      chain,
      tokenA,
      tokenB,
      positionType,
    },
    runtimeDownstream: {
      executionTarget: "uniswap-v3",
      executionAction: "depositLpPosition",
      positionCreateBaseUrl: deepLinkBase,
      topUniswapPools: pools.slice(0, 8),
      plannerInput: plan.input,
      payloadTemplate: {
        protocol: "uniswap-v3",
        chain,
        investmentId: "",
        token: tokenA,
        tokenSecondary: tokenB,
        amount: "",
        amountSecondary: "",
        range: "",
        positionType,
        poolAddress: runtimePool?.pairAddress,
      },
      missingExecutionFields: ["investmentId", "amount", "amountSecondary", "range"],
    },
  };
}

function pickUniswapPlannerSkillFileFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const explicitFile = (env.PHALANX_UNISWAP_SKILL_FILE ?? "").trim();
  if (explicitFile && existsSync(explicitFile)) {
    return explicitFile;
  }

  const projectPwd = (env.PWD ?? process.cwd()).trim();
  if (projectPwd) {
    const p = join(projectPwd, ".agents/skills/liquidity-planner/SKILL.md");
    if (existsSync(p)) return p;
  }

  const skillsProj = (env.PHALANX_UNISWAP_SKILLS_PROJECT_ROOT ?? "").trim();
  if (skillsProj) {
    const p = join(skillsProj, ".agents/skills/liquidity-planner/SKILL.md");
    if (existsSync(p)) return p;
  }

  const root = (env.PHALANX_UNISWAP_SKILL_ROOT ?? "").trim();
  if (!root) return undefined;
  const candidates = [
    join(root, "packages/plugins/uniswap-driver/skills/liquidity-planner/SKILL.md"),
    join(root, "liquidity-planner/SKILL.md"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function inferSkillRootForDiscovery(skillFile: string, env: NodeJS.ProcessEnv): string | undefined {
  const root = (env.PHALANX_UNISWAP_SKILL_ROOT ?? "").trim();
  if (root) return root;
  const skillsProj = (env.PHALANX_UNISWAP_SKILLS_PROJECT_ROOT ?? "").trim();
  if (skillsProj) return skillsProj;
  return inferUniswapSkillsProjectRootFromSkillFile(skillFile);
}

export function discoverUniswapPlannerSkill(
  env: NodeJS.ProcessEnv = process.env,
): UniswapPlannerSkillDiscovery {
  const skillFile = pickUniswapPlannerSkillFileFromEnv(env);
  if (!skillFile) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "tool_missing",
      summary:
        "Uniswap liquidity-planner skill not found; run `npx skills add Uniswap/uniswap-ai -y --skill liquidity-planner` in your project or set PHALANX_UNISWAP_SKILL_ROOT / PHALANX_UNISWAP_SKILL_FILE / PHALANX_UNISWAP_SKILLS_PROJECT_ROOT.",
    };
  }
  return {
    provider: "uniswap",
    lane: "liquidity_planner_skill",
    status: "available",
    summary: "Uniswap liquidity-planner skill discovered.",
    skillRoot: inferSkillRootForDiscovery(skillFile, env),
    skillFile,
  };
}

export function planUniswapLiquidityPlannerInvocation(
  input: UniswapLiquidityPlannerInvocationInput,
  env: NodeJS.ProcessEnv = process.env,
): UniswapLiquidityPlannerInvocationPlan {
  const discovery = discoverUniswapPlannerSkill(env);
  const chain = input.chain.trim();
  const tokenA = input.tokenA.trim();
  const tokenB = input.tokenB.trim();
  if (!chain || !tokenA || !tokenB) {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "invalid_input",
      summary: "chain, tokenA, and tokenB are required for liquidity planning.",
      prompt: "",
      input,
    };
  }
  const prompt =
    `Use the installed liquidity-planner skill to plan a ${input.positionType} liquidity position ` +
    `on ${chain} for ${tokenA}/${tokenB}. Return structured planning outputs including suggested range, ` +
    `reasoning summary, and any deep link or execution parameters needed downstream.`;
  if (discovery.status !== "available") {
    return {
      provider: "uniswap",
      lane: "liquidity_planner_skill",
      status: "tool_missing",
      summary: discovery.summary,
      prompt,
      input,
    };
  }
  return {
    provider: "uniswap",
    lane: "liquidity_planner_skill",
    status: "planned",
    summary: "Uniswap liquidity-planner invocation prepared against the discovered skill.",
    skillFile: discovery.skillFile,
    prompt,
    input,
  };
}

/**
 * MCP / runtime entry: plan + official invocation (skills CLI verify when applicable, DexScreener data plane).
 */
export async function runUniswapLiquidityPlannerForPayload(
  payload: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
  hooks?: UniswapPlannerExecutionHooks,
): Promise<UniswapLiquidityPlannerExecutionResult> {
  const chain =
    typeof payload.chain === "string" && payload.chain.trim() ? payload.chain.trim() : "base";
  const tokenA = typeof payload.tokenA === "string" ? payload.tokenA.trim() : "";
  const tokenB = typeof payload.tokenB === "string" ? payload.tokenB.trim() : "";
  const pt = payload.positionType;
  const positionType = pt === "v2" || pt === "v3" || pt === "v4" ? pt : "v3";
  const plan = planUniswapLiquidityPlannerInvocation({ chain, tokenA, tokenB, positionType }, env);
  return executeUniswapLiquidityPlannerInvocation(plan, env, hooks);
}

export type UniswapLpPlanInput = {
  readonly chain: string;
};

/** Minimal NonfungiblePositionManager.positions(uint256) return shape we surface. */
export const UNISWAP_V3_POSITIONS_ABI = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const satisfies Abi;

export type UniswapLpLiveRouting = {
  readonly rpcEnvKey: string;
  readonly rpcUrl?: string;
  readonly positionManagerEnv: string;
  readonly positionManager?: Address;
  readonly tokenIdEnv: string;
  readonly tokenId?: bigint;
};

export type UniswapLpAdapterPlan = {
  readonly provider: "uniswap";
  readonly status: "planned" | "unsupported" | "live_ready" | "live_config_missing";
  readonly summary: string;
  readonly chain: string;
  readonly executionNote: string;
  readonly live: UniswapLpLiveRouting;
};

export type UniswapLpReadResult = {
  readonly provider: "uniswap";
  readonly status: "skipped" | "completed" | "failed";
  readonly summary: string;
  readonly position?: {
    token0: Address;
    token1: Address;
    fee: number;
    tickLower: number;
    tickUpper: number;
    liquidity: string;
  };
};

function pickUniswapRpc(
  chain: string,
  env: NodeJS.ProcessEnv,
): { url?: string; key: string } {
  const dedicated = (env.PHALANX_UNISWAP_RPC_URL ?? "").trim();
  if (dedicated) return { url: dedicated, key: "PHALANX_UNISWAP_RPC_URL" };
  const c = chain.toLowerCase();
  if (c.includes("xlayer")) {
    const u = (env.XLAYER_RPC_URL ?? "").trim();
    return { url: u || undefined, key: "XLAYER_RPC_URL" };
  }
  const base = (env.BASE_RPC_URL ?? "").trim();
  return { url: base || undefined, key: "BASE_RPC_URL" };
}

function parseTokenId(raw: string | undefined): bigint | undefined {
  const t = (raw ?? "").trim();
  if (!t) return undefined;
  try {
    return BigInt(t);
  } catch {
    return undefined;
  }
}

export function resolveUniswapLiveRouting(
  chain: string,
  env: NodeJS.ProcessEnv = process.env,
): UniswapLpLiveRouting {
  const { url, key } = pickUniswapRpc(chain, env);
  const pmRaw = (env.PHALANX_UNISWAP_V3_POSITION_MANAGER ?? "").trim();
  const tokenId = parseTokenId(env.PHALANX_UNISWAP_POSITION_TOKEN_ID);
  const positionManager =
    pmRaw && isAddress(pmRaw) ? (pmRaw as Address) : undefined;

  return {
    rpcEnvKey: key,
    rpcUrl: url,
    positionManagerEnv: "PHALANX_UNISWAP_V3_POSITION_MANAGER",
    positionManager,
    tokenIdEnv: "PHALANX_UNISWAP_POSITION_TOKEN_ID",
    tokenId,
  };
}

export function planUniswapLpRead(
  input: UniswapLpPlanInput,
  env: NodeJS.ProcessEnv = process.env,
): UniswapLpAdapterPlan {
  const chain = input.chain.trim() || "unknown";
  const live = resolveUniswapLiveRouting(chain, env);
  const hasAll = Boolean(live.rpcUrl && live.positionManager && live.tokenId !== undefined);

  return {
    provider: "uniswap",
    status: hasAll ? "live_ready" : "live_config_missing",
    summary: hasAll
      ? "Uniswap V3 position read plan ready; execution uses viem readContract on the configured manager."
      : "Uniswap LP plan recorded; set RPC (BASE_RPC_URL / PHALANX_UNISWAP_RPC_URL), PHALANX_UNISWAP_V3_POSITION_MANAGER, and PHALANX_UNISWAP_POSITION_TOKEN_ID for live reads.",
    chain,
    executionNote:
      "Planning is synchronous; call executeUniswapLpReadPlan after policy, risk, and approval — execution performs RPC reads only.",
    live,
  };
}

export async function executeUniswapLpReadPlan(
  plan: UniswapLpAdapterPlan,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UniswapLpReadResult> {
  if (plan.status !== "live_ready") {
    return {
      provider: "uniswap",
      status: "skipped",
      summary: plan.summary,
    };
  }

  const { rpcUrl, positionManager, tokenId } = plan.live;
  if (!rpcUrl || !positionManager || tokenId === undefined) {
    return {
      provider: "uniswap",
      status: "skipped",
      summary: "live routing incomplete",
    };
  }

  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const res = (await client.readContract({
      address: positionManager,
      abi: UNISWAP_V3_POSITIONS_ABI as unknown as Abi,
      functionName: "positions",
      args: [tokenId],
    })) as readonly [
      bigint,
      Address,
      Address,
      Address,
      number,
      number,
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];

    const [, , token0, token1, fee, tickLower, tickUpper, liquidity] = res;
    return {
      provider: "uniswap",
      status: "completed",
      summary: "positions(uint256) read succeeded",
      position: {
        token0,
        token1,
        fee: Number(fee),
        tickLower: Number(tickLower),
        tickUpper: Number(tickUpper),
        liquidity: liquidity.toString(),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: "uniswap",
      status: "failed",
      summary: msg.replace(/\s+/g, " ").slice(0, 240),
    };
  }
}

/** Uniswap V3 Quoter-compatible `quoteExactInputSingle` (read-only; no swap submission). */
export const UNISWAP_V3_QUOTE_EXACT_INPUT_SINGLE_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const satisfies Abi;

export type UniswapSwapQuotePlanInput = {
  readonly chain: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string;
  readonly fee?: number;
};

export type UniswapSwapQuoteLiveRouting = {
  readonly rpcEnvKey: string;
  readonly rpcUrl?: string;
  readonly quoterEnv: string;
  readonly quoter?: Address;
  readonly tokenIn?: Address;
  readonly tokenOut?: Address;
  readonly fee: number;
  readonly amountIn?: bigint;
  readonly sqrtPriceLimitX96: bigint;
};

export type UniswapSwapQuoteAdapterPlan = {
  readonly provider: "uniswap";
  readonly lane: "swap_quote";
  readonly status: "live_ready" | "live_config_missing" | "invalid_input";
  readonly summary: string;
  readonly chain: string;
  readonly executionNote: string;
  readonly live: UniswapSwapQuoteLiveRouting;
};

export type UniswapSwapQuoteReadResult = {
  readonly provider: "uniswap";
  readonly lane: "swap_quote";
  readonly status: "skipped" | "completed" | "failed";
  readonly summary: string;
  readonly amountOut?: string;
};

function parseSwapAmountIn(raw: string): bigint | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  try {
    const v = BigInt(t);
    return v >= 0n ? v : undefined;
  } catch {
    return undefined;
  }
}

function pickUniswapQuoterAddress(env: NodeJS.ProcessEnv): string | undefined {
  const q = (env.PHALANX_UNISWAP_V3_QUOTER ?? env.PHALANX_UNISWAP_V3_QUOTER_V2 ?? "").trim();
  return q.length > 0 ? q : undefined;
}

export function resolveUniswapSwapQuoteRouting(
  chain: string,
  input: Pick<UniswapSwapQuotePlanInput, "tokenIn" | "tokenOut" | "amountIn" | "fee">,
  env: NodeJS.ProcessEnv = process.env,
): UniswapSwapQuoteLiveRouting {
  const { url, key } = pickUniswapRpc(chain, env);
  const quoterRaw = pickUniswapQuoterAddress(env);
  const quoter = quoterRaw && isAddress(quoterRaw) ? (quoterRaw as Address) : undefined;
  const t0 = input.tokenIn.trim();
  const t1 = input.tokenOut.trim();
  const tokenIn = isAddress(t0) ? (t0 as Address) : undefined;
  const tokenOut = isAddress(t1) ? (t1 as Address) : undefined;
  const amountIn = parseSwapAmountIn(input.amountIn);
  const fee = input.fee ?? 3000;

  return {
    rpcEnvKey: key,
    rpcUrl: url,
    quoterEnv: "PHALANX_UNISWAP_V3_QUOTER",
    quoter,
    tokenIn,
    tokenOut,
    fee,
    amountIn,
    sqrtPriceLimitX96: 0n,
  };
}

/**
 * Plan a read-only V3 quote (execution submits no transaction).
 */
export function planUniswapSwapQuoteExecution(
  input: UniswapSwapQuotePlanInput,
  env: NodeJS.ProcessEnv = process.env,
): UniswapSwapQuoteAdapterPlan {
  const chain = input.chain.trim() || "unknown";
  const live = resolveUniswapSwapQuoteRouting(chain, input, env);
  if (live.amountIn === undefined) {
    return {
      provider: "uniswap",
      lane: "swap_quote",
      status: "invalid_input",
      summary: "amountIn must be a non-negative integer string (wei) for quoting.",
      chain,
      executionNote:
        "Planning is synchronous; execution calls Quoter.quoteExactInputSingle via viem readContract only.",
      live,
    };
  }

  const hasAll = Boolean(live.rpcUrl && live.quoter && live.tokenIn && live.tokenOut);
  return {
    provider: "uniswap",
    lane: "swap_quote",
    status: hasAll ? "live_ready" : "live_config_missing",
    summary: hasAll
      ? "Uniswap V3 swap quote plan ready; execution performs a quoter static read."
      : "Configure PHALANX_UNISWAP_V3_QUOTER, RPC (BASE_RPC_URL / PHALANX_UNISWAP_RPC_URL), tokenIn, tokenOut, and amountIn for live quotes.",
    chain,
    executionNote:
      "Planning is synchronous; call executeUniswapSwapQuotePlan after policy gates — execution is RPC read-only (no swap submission).",
    live,
  };
}

export async function executeUniswapSwapQuotePlan(
  plan: UniswapSwapQuoteAdapterPlan,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UniswapSwapQuoteReadResult> {
  void env;
  if (plan.status !== "live_ready") {
    return {
      provider: "uniswap",
      lane: "swap_quote",
      status: "skipped",
      summary: plan.summary,
    };
  }

  const { rpcUrl, quoter, tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96 } = plan.live;
  if (!rpcUrl || !quoter || !tokenIn || !tokenOut || amountIn === undefined) {
    return {
      provider: "uniswap",
      lane: "swap_quote",
      status: "skipped",
      summary: "swap quote routing incomplete",
    };
  }

  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const amountOut = (await client.readContract({
      address: quoter,
      abi: UNISWAP_V3_QUOTE_EXACT_INPUT_SINGLE_ABI as unknown as Abi,
      functionName: "quoteExactInputSingle",
      args: [tokenIn, tokenOut, fee, amountIn, sqrtPriceLimitX96],
    })) as bigint;

    return {
      provider: "uniswap",
      lane: "swap_quote",
      status: "completed",
      summary: "quoteExactInputSingle succeeded",
      amountOut: amountOut.toString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      provider: "uniswap",
      lane: "swap_quote",
      status: "failed",
      summary: msg.replace(/\s+/g, " ").slice(0, 240),
    };
  }
}
