import { resolve } from "node:path";

import { Bot } from "grammy";

import { createPhalanxHost } from "../src/app/host.js";
import {
  extractOnchainosDefiPositionIdentifiers,
  parseOnchainosDefiProducts,
  readOnchainosDefiList,
  readOnchainosDefiPositionDetail,
  readOnchainosDefiPositions,
} from "../src/adapters/onchainos.js";
import { loadRuntimeConfigValues } from "../src/config/store.js";
import { createTelegramApprovalNotifier } from "../src/telegram/live.js";

type PlannerHandoff = {
  readonly action: string;
  readonly target: string;
  readonly payloadTemplate: Record<string, unknown>;
};

type RoundtripOutput = {
  readonly mode: "uniswap_lp_live_roundtrip";
  readonly configPath: string;
  readonly startup: ReturnType<ReturnType<typeof createPhalanxHost>["getStartupSummary"]>;
  readonly walletAddress: string;
  readonly productDiscovery: {
    readonly chain: string;
    readonly scannedPages: number;
    readonly requestedInvestmentId: string;
    readonly exactMatchCount: number;
    readonly heuristicCandidateCount: number;
    readonly matchedProducts: unknown[];
    readonly pageSummaries: unknown[];
  };
  readonly plannerResult: unknown;
  readonly depositPayload: Record<string, unknown>;
  depositActionResult?: unknown;
  depositCallbackResult?: unknown;
  positionsAfterDeposit?: unknown;
  positionDetailAfterDeposit?: unknown;
  derivedWithdrawPayload?: Record<string, unknown>;
  withdrawActionResult?: unknown;
  withdrawCallbackResult?: unknown;
  positionsAfterWithdraw?: unknown;
  positionDetailAfterWithdraw?: unknown;
};

function callbackSummary(result: Awaited<ReturnType<ReturnType<typeof createPhalanxHost>["handleTelegramCallback"]>>): string {
  if (!result.handled) {
    return "Approval callback ignored.";
  }
  if (result.decision === "reject") {
    return "Rejected. Pending action was cancelled.";
  }
  if (result.runtimeOutcome?.type === "executed") {
    return "Approved. Action resumed through RuntimeCore and executed.";
  }
  return "Approval handled.";
}

function resolveWalletAddress(env: NodeJS.ProcessEnv): string | undefined {
  return (env.PHALANX_WALLET_ADDRESS ?? env.AGENT_WALLET_ADDRESS ?? "").trim() || undefined;
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = (env[key] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required env ${key}`);
  }
  return value;
}

function numberEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = (env[key] ?? "").trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env ${key}: ${raw}`);
  }
  return parsed;
}

function extractPlannerPayloadTemplate(result: unknown): PlannerHandoff {
  const root = result as {
    ok?: boolean;
    data?: {
      adapterResult?: {
        runtimeDownstream?: {
          executionTarget?: string;
          executionAction?: string;
          payloadTemplate?: Record<string, unknown>;
        };
      };
    };
  };
  if (!root?.ok) {
    throw new Error("Planner MCP call did not succeed.");
  }
  const downstream = root.data?.adapterResult?.runtimeDownstream;
  if (!downstream?.executionAction || !downstream.executionTarget || !downstream.payloadTemplate) {
    throw new Error("Planner did not return a complete runtimeDownstream handoff.");
  }
  return {
    action: downstream.executionAction,
    target: downstream.executionTarget,
    payloadTemplate: downstream.payloadTemplate,
  };
}

function buildDepositPayload(payloadTemplate: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const amountSecondary = (env.PHALANX_LP_AMOUNT_SECONDARY ?? "").trim();
  const tokenSecondary =
    (env.PHALANX_LP_TOKEN_SECONDARY ?? "").trim() ||
    (typeof payloadTemplate.tokenSecondary === "string" ? payloadTemplate.tokenSecondary : "");
  const tickLower =
    (env.PHALANX_LP_TICK_LOWER ?? "").trim() ||
    (typeof payloadTemplate.tickLower === "string" ? payloadTemplate.tickLower : "");
  const tickUpper =
    (env.PHALANX_LP_TICK_UPPER ?? "").trim() ||
    (typeof payloadTemplate.tickUpper === "string" ? payloadTemplate.tickUpper : "");
  const range =
    (env.PHALANX_LP_RANGE ?? "").trim() ||
    (env.PHALANX_SMOKE_LP_RANGE ?? "").trim() ||
    (typeof payloadTemplate.range === "string" ? payloadTemplate.range : "");
  return {
    ...payloadTemplate,
    investmentId:
      (env.PHALANX_LP_INVESTMENT_ID ?? "").trim() ||
      (env.PHALANX_SMOKE_LP_INVESTMENT_ID ?? "").trim() ||
      requiredEnv(env, "PHALANX_LP_INVESTMENT_ID"),
    token:
      (env.PHALANX_LP_TOKEN ?? "").trim() || (typeof payloadTemplate.token === "string" ? payloadTemplate.token : ""),
    tokenSecondary: tokenSecondary || undefined,
    amount:
      (env.PHALANX_LP_AMOUNT ?? "").trim() ||
      (env.PHALANX_SMOKE_LP_AMOUNT ?? "").trim() ||
      requiredEnv(env, "PHALANX_LP_AMOUNT"),
    amountSecondary:
      amountSecondary || (env.PHALANX_SMOKE_LP_AMOUNT_SECONDARY ?? "").trim() || undefined,
    tickLower: tickLower || undefined,
    tickUpper: tickUpper || undefined,
    range: range || undefined,
  };
}

function looksLikeLpProduct(product: {
  readonly platformName?: string;
  readonly name?: string;
  readonly productGroup?: string;
  readonly detailPath?: string;
}): boolean {
  const joined = [product.platformName, product.name, product.productGroup, product.detailPath]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  return /(uniswap|liquidity|lp)/i.test(joined);
}

async function discoverProducts(
  chain: string,
  investmentId: string,
  pages: number,
  env: NodeJS.ProcessEnv,
): Promise<RoundtripOutput["productDiscovery"]> {
  const matchedProducts: unknown[] = [];
  let exactMatchCount = 0;
  let heuristicCandidateCount = 0;
  const pageSummaries: unknown[] = [];
  for (let pageNum = 1; pageNum <= pages; pageNum += 1) {
    const result = await readOnchainosDefiList({ chain, pageNum, env });
    const products = result.stdout ? parseOnchainosDefiProducts(result.stdout) : [];
    const matches = products.filter((product) => {
      const exact = product.investmentId === investmentId;
      const heuristic = looksLikeLpProduct(product);
      if (exact) exactMatchCount += 1;
      if (!exact && heuristic) heuristicCandidateCount += 1;
      return exact || heuristic;
    });
    pageSummaries.push({
      pageNum,
      status: result.status,
      productCount: products.length,
      matchedCount: matches.length,
      summary: result.summary,
    });
    for (const match of matches) {
      matchedProducts.push(match);
    }
  }
  return {
    chain,
    scannedPages: pages,
    requestedInvestmentId: investmentId,
    exactMatchCount,
    heuristicCandidateCount,
    matchedProducts,
    pageSummaries,
  };
}

function deriveWithdrawPayload(
  depositPayload: Record<string, unknown>,
  baseIdentifiers: { platformIds: string[]; tokenIds: string[] },
  detailIdentifiers: { platformIds: string[]; tokenIds: string[] },
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const tokenId =
    (env.PHALANX_LP_WITHDRAW_TOKEN_ID ?? "").trim() || detailIdentifiers.tokenIds[0] || baseIdentifiers.tokenIds[0];
  const platformId =
    (env.PHALANX_LP_WITHDRAW_PLATFORM_ID ?? "").trim() ||
    detailIdentifiers.platformIds[0] ||
    baseIdentifiers.platformIds[0];
  if (!tokenId && !(env.PHALANX_LP_WITHDRAW_RATIO ?? "").trim() && !(env.PHALANX_LP_WITHDRAW_AMOUNT ?? "").trim()) {
    throw new Error(
      "Could not derive LP withdraw identifiers. Provide PHALANX_LP_WITHDRAW_TOKEN_ID, PHALANX_LP_WITHDRAW_RATIO, or PHALANX_LP_WITHDRAW_AMOUNT.",
    );
  }
  return {
    protocol: "uniswap-v3",
    investmentId: String(depositPayload.investmentId ?? ""),
    chain: String(depositPayload.chain ?? "base"),
    platformId: platformId || undefined,
    tokenId: tokenId || undefined,
    ratio: (env.PHALANX_LP_WITHDRAW_RATIO ?? "").trim() || "1",
    amount: (env.PHALANX_LP_WITHDRAW_AMOUNT ?? "").trim() || undefined,
  };
}

async function main(): Promise<void> {
  const configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env");
  const runtimeEnv = loadRuntimeConfigValues(configPath, process.env);
  const token = runtimeEnv.TELEGRAM_BOT_TOKEN?.trim();
  const ownerChatId = Number(runtimeEnv.TELEGRAM_ALLOWED_USER_ID?.trim() ?? "");
  const walletAddress = resolveWalletAddress(runtimeEnv);
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in config.env");
  }
  if (!Number.isFinite(ownerChatId)) {
    throw new Error("Missing TELEGRAM_ALLOWED_USER_ID in config.env");
  }
  if (!walletAddress) {
    throw new Error("Missing PHALANX_WALLET_ADDRESS or AGENT_WALLET_ADDRESS for live LP roundtrip.");
  }

  const chain = (runtimeEnv.PHALANX_LP_CHAIN ?? "base").trim();
  const pagesToScan = numberEnv(runtimeEnv, "PHALANX_LP_DISCOVERY_PAGES", 10);
  const approvalTimeoutMs = numberEnv(runtimeEnv, "PHALANX_TELEGRAM_APPROVAL_SMOKE_TIMEOUT_MS", 180000);

  const host = createPhalanxHost({
    configValues: runtimeEnv,
    approvalNotifyTimeoutMs: numberEnv(runtimeEnv, "PHALANX_APPROVAL_NOTIFY_TIMEOUT_MS", 8000),
  });
  const bot = new Bot(token);

  let callbackResolve:
    | ((value: Awaited<ReturnType<ReturnType<typeof createPhalanxHost>["handleTelegramCallback"]>>) => void)
    | undefined;
  let callbackReject: ((reason?: unknown) => void) | undefined;
  let callbackTimer: ReturnType<typeof setTimeout> | undefined;

  function waitForCallback(): Promise<Awaited<ReturnType<ReturnType<typeof createPhalanxHost>["handleTelegramCallback"]>>> {
    if (callbackResolve || callbackReject) {
      throw new Error("Already waiting for a Telegram callback.");
    }
    return new Promise((resolve, reject) => {
      callbackResolve = resolve;
      callbackReject = reject;
      callbackTimer = setTimeout(() => {
        callbackResolve = undefined;
        callbackReject = undefined;
        reject(new Error(`Timed out waiting for Telegram approval callback after ${approvalTimeoutMs}ms`));
      }, approvalTimeoutMs);
    });
  }

  bot.on("callback_query:data", async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const result = await host.handleTelegramCallback(callbackData);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(callbackSummary(result));
    if (callbackTimer) {
      clearTimeout(callbackTimer);
    }
    callbackTimer = undefined;
    const resolve = callbackResolve;
    callbackResolve = undefined;
    callbackReject = undefined;
    resolve?.(result);
  });

  bot.catch((error) => {
    if (callbackTimer) {
      clearTimeout(callbackTimer);
    }
    callbackTimer = undefined;
    const reject = callbackReject;
    callbackResolve = undefined;
    callbackReject = undefined;
    reject?.(error);
  });

  const notifier = createTelegramApprovalNotifier({
    getOwnerChatId: () => ownerChatId,
    sendMessage: async (chatId, text, extra) => {
      await bot.api.sendMessage(chatId, text, extra as never);
    },
  });
  host.bindTelegramApprovalNotifier(notifier);

  void bot.start();
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const plannerResult = await host.invokeMcp("phalanx_uniswap_liquidity_plan", {
    chain,
    tokenA: runtimeEnv.PHALANX_LP_TOKEN_A ?? "USDC",
    tokenB: runtimeEnv.PHALANX_LP_TOKEN_B ?? "ETH",
    positionType: "v3",
  });
  const handoff = extractPlannerPayloadTemplate(plannerResult);
  const depositPayload = buildDepositPayload(handoff.payloadTemplate, runtimeEnv);
  const productDiscovery = await discoverProducts(
    chain,
    String(depositPayload.investmentId ?? ""),
    pagesToScan,
    runtimeEnv,
  );

  const output: RoundtripOutput = {
    mode: "uniswap_lp_live_roundtrip",
    configPath,
    startup: host.getStartupSummary(),
    walletAddress,
    productDiscovery,
    plannerResult,
    depositPayload,
  };

  output.depositActionResult = await host.invokeMcp("phalanx_action", {
    action: handoff.action,
    payload: depositPayload,
    target: handoff.target,
  });
  console.log(JSON.stringify(output, null, 2));

  if (
    output.depositActionResult &&
    typeof output.depositActionResult === "object" &&
    "ok" in output.depositActionResult &&
    output.depositActionResult.ok &&
    output.depositActionResult.data?.kind === "pending_approval"
  ) {
    output.depositCallbackResult = await waitForCallback();
    console.log(JSON.stringify(output, null, 2));
  }

  output.positionsAfterDeposit = await readOnchainosDefiPositions({
    address: walletAddress,
    chains: [chain],
    chain,
    env: runtimeEnv,
  });
  const baseIdentifiers = extractOnchainosDefiPositionIdentifiers(
    (output.positionsAfterDeposit as { stdout?: string } | undefined)?.stdout ?? "",
  );
  const detailPlatformId = (runtimeEnv.PHALANX_LP_WITHDRAW_PLATFORM_ID ?? "").trim() || baseIdentifiers.platformIds[0];
  if (detailPlatformId) {
    output.positionDetailAfterDeposit = await readOnchainosDefiPositionDetail({
      address: walletAddress,
      chain,
      platformId: detailPlatformId,
      env: runtimeEnv,
    });
  }
  const detailIdentifiers = extractOnchainosDefiPositionIdentifiers(
    (output.positionDetailAfterDeposit as { stdout?: string } | undefined)?.stdout ?? "",
  );
  output.derivedWithdrawPayload = deriveWithdrawPayload(depositPayload, baseIdentifiers, detailIdentifiers, runtimeEnv);

  output.withdrawActionResult = await host.invokeMcp("phalanx_action", {
    action: "withdrawLpPosition",
    payload: output.derivedWithdrawPayload,
    target: "uniswap-v3",
  });
  console.log(JSON.stringify(output, null, 2));

  if (
    output.withdrawActionResult &&
    typeof output.withdrawActionResult === "object" &&
    "ok" in output.withdrawActionResult &&
    output.withdrawActionResult.ok &&
    output.withdrawActionResult.data?.kind === "pending_approval"
  ) {
    output.withdrawCallbackResult = await waitForCallback();
    console.log(JSON.stringify(output, null, 2));
  }

  output.positionsAfterWithdraw = await readOnchainosDefiPositions({
    address: walletAddress,
    chains: [chain],
    chain,
    env: runtimeEnv,
  });
  if (detailPlatformId) {
    output.positionDetailAfterWithdraw = await readOnchainosDefiPositionDetail({
      address: walletAddress,
      chain,
      platformId: detailPlatformId,
      env: runtimeEnv,
    });
  }

  console.log(JSON.stringify(output, null, 2));
  bot.stop();
}

await main();
