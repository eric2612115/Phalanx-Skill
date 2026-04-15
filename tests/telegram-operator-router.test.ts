import { describe, expect, it } from "vitest";

import { classifyOperatorTelegramText } from "../src/telegram/operator-router.ts";
import { runOperatorQuery } from "../src/telegram/operator-queries.ts";
import { formatOperatorQueryPayload } from "../src/telegram/operator-formatters.ts";
import {
  buildOperatorStartReply,
  buildOperatorFallbackReply,
  buildTelegramStartKeyboardRows,
  buildTelegramFaqReply,
  buildOperatorHelpReply,
  isOperatorHelpCommand,
  isOperatorStartCommand,
} from "../src/telegram/fallback.ts";

function expectQueryFamily(text: string, family: string) {
  const route = classifyOperatorTelegramText(text);
  expect(route.kind).toBe("query");
  if (route.kind === "query") {
    expect(route.family).toBe(family);
  }
}

describe("telegram operator router", () => {
  it("classifies the nine query families with bounded keyword matching", () => {
    expectQueryFamily("pending approvals?", "readiness_pending");
    expectQueryFamily("lp position detail?", "lp_position_detail");
    expectQueryFamily("show my lp position", "lp_position_detail");
    expectQueryFamily("show my uniswap position", "lp_position_detail");
    expectQueryFamily("show portfolio", "portfolio_balances");
    expectQueryFamily("recent events", "recent_events");
    expectQueryFamily("what next", "why_blocked_next");
    expectQueryFamily("current whitelist", "whitelist_policy");
    expectQueryFamily("risk summary", "risk_guardian");
    expectQueryFamily("agent wallet", "wallets_binding");
    expectQueryFamily("x402 summary", "runtime_execution_context");
    expectQueryFamily("payment summary for last run", "runtime_execution_context");
    expectQueryFamily("execution context summary", "runtime_execution_context");
  });

  it("returns fallback for unsupported open-ended text", () => {
    expect(classifyOperatorTelegramText("write me a poem about defi")).toEqual({ kind: "fallback" });
    expect(classifyOperatorTelegramText("   ").kind).toBe("fallback");
  });

  it("keeps short ambiguous needles bounded by explicit rule order", () => {
    expectQueryFamily("status", "readiness_pending");
    expectQueryFamily("guardian action", "recent_events");
    expectQueryFamily("policy summary", "whitelist_policy");
  });

  it("fallback reply lists capabilities without pretending to be a general assistant", () => {
    const text = buildOperatorFallbackReply();
    expect(text.toLowerCase()).toMatch(/keyword|bounded|not.*chat|phalanx/i);
    expect(text).toMatch(/\/help/);
    expect(text.toLowerCase()).toMatch(/private chat/);
    expect(text).toMatch(/pending|approval|readiness/i);
    expect(text).toMatch(/portfolio|balance|position/i);
    expect(text).toMatch(/event|guardian|tx/i);
    expect(text).toMatch(/whitelist|policy/i);
    expect(text).toMatch(/risk|assessment/i);
    expect(text).toMatch(/wallet|binding/i);
  });

  it("detects /help, /help@bot, and plain help as help commands", () => {
    expect(isOperatorHelpCommand("/help")).toBe(true);
    expect(isOperatorHelpCommand("  /help@my_phalanx_bot  ")).toBe(true);
    expect(isOperatorHelpCommand("help")).toBe(true);
    expect(isOperatorHelpCommand("HELP")).toBe(true);
    expect(isOperatorHelpCommand("/help_extra")).toBe(false);
    expect(isOperatorHelpCommand("what help")).toBe(false);
    expect(isOperatorHelpCommand("")).toBe(false);
  });

  it("detects /start, /start@bot, and plain start as start commands", () => {
    expect(isOperatorStartCommand("/start")).toBe(true);
    expect(isOperatorStartCommand("  /start@agent_phalanx_bot ")).toBe(true);
    expect(isOperatorStartCommand("start")).toBe(true);
    expect(isOperatorStartCommand("/start_more")).toBe(false);
    expect(isOperatorStartCommand("starting now")).toBe(false);
    expect(isOperatorStartCommand("")).toBe(false);
  });

  it("help reply is static, names AgentPhalanx, and describes bounded READY queries", () => {
    const text = buildOperatorHelpReply();
    expect(text).toMatch(/AgentPhalanx/i);
    expect(text.toLowerCase()).toMatch(/not an open-ended|not.*open.*assistant|keyword/);
    expect(text).toMatch(/\/claim|claim/i);
    expect(text.toLowerCase()).toMatch(/config\.env/);
    expect(text.toLowerCase()).toMatch(/service\.env/);
    expect(text).toMatch(/smoke:live/);
    expect(text).toMatch(/smoke:deposit-mainline|deposit-mainline/);
    expect(text).toMatch(/smoke:allocation-mainline|allocation-mainline/);
    expect(text).toMatch(/TELEGRAM_ALLOWED_USER_ID/);
    for (const line of [
      /readiness|pending/i,
      /portfolio|balance|position/i,
      /event|guardian/i,
      /blocked|what next/i,
      /whitelist|policy/i,
      /risk/i,
      /wallet|binding/i,
    ]) {
      expect(text).toMatch(line);
    }
  });

  it("start reply introduces AgentPhalanx, onboarding, FAQ, and bounded routing", () => {
    const text = buildOperatorStartReply();
    expect(text).toMatch(/AgentPhalanx/i);
    expect(text).toMatch(/\/claim/i);
    expect(text).toMatch(/OKX API/i);
    expect(text).toMatch(/OTP/i);
    expect(text).toMatch(/wallet/i);
    expect(text.toLowerCase()).toMatch(/bounded|source|docs|not.*open-ended|not.*general/i);
  });

  it("document-grounded FAQ reply cites curated sources for supported onboarding questions", () => {
    const text = buildTelegramFaqReply("Why can OMRATE_API_KEY be skipped?");
    expect(text).toBeTruthy();
    expect(text ?? "").toMatch(/x402|402|required/i);
    expect(text ?? "").toMatch(/README\.md/i);
    expect(text ?? "").toMatch(/live-demo-runbook/i);
    expect(text ?? "").not.toMatch(/free-form|anything/i);
  });

  it("start keyboard includes claim, FAQ prompts, and operator shortcuts", () => {
    const rows = buildTelegramStartKeyboardRows();
    const flat = rows.flat();
    expect(flat).toContain("/claim");
    expect(flat).toContain("Why OKX API trio?");
    expect(flat).toContain("Why can OMRATE_API_KEY be skipped?");
    expect(flat).toContain("What is OKX login email?");
    expect(flat).toContain("Why is OTP required?");
    expect(flat).toContain("How is wallet address recorded?");
    expect(flat).toContain("status");
    expect(flat).toContain("x402 summary");
  });

  it("runs queries through providers and formats concise Telegram text", async () => {
    const { createPhalanxHost } = await import("../src/app/host.ts");
    const { OPERATOR_LP_POSITION_DETAIL_SCOPE } = await import("../src/operator/providers/portfolio-provider.ts");
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "whitelist-admin"],
      executor: {
        execute: async (intent) => {
          if (
            intent.action === "getPortfolioStatus" &&
            intent.payload?.operatorScope === OPERATOR_LP_POSITION_DETAIL_SCOPE
          ) {
            return {
              provider: "test",
              chain: "base",
              platformId: "plat-uni-1",
              lpPositionDetail: {
                protocol: "uniswap-v3",
                platformLabel: "Uniswap V3",
                token0Symbol: "USDC",
                token1Symbol: "ETH",
                feeTier: "3000",
                poolAddress: "0xabc0000000000000000000000000000000000001",
                tokenId: "7",
                tickLower: -10,
                tickUpper: 10,
                currentTick: 2,
                liquidity: "123",
                inRange: false,
                withdrawable: true,
                withdrawabilitySummary: "No principal while in range; fees only.",
                lastUpdatedAt: "1710000000",
              },
            };
          }
          return {
            provider: "test",
            buckets: [],
            executionEvidence: {
              milestones: { portfolio_push_ready: true },
            },
          };
        },
      },
    });

    const readiness = await runOperatorQuery(host, "readiness_pending");
    const readinessText = formatOperatorQueryPayload(readiness).join("\n");
    expect(readinessText).toMatch(/READY|readiness|pending/i);

    const policy = await runOperatorQuery(host, "whitelist_policy");
    const policyText = formatOperatorQueryPayload(policy).join("\n");
    expect(policyText).toMatch(/whitelist|pool/i);

    const lp = await runOperatorQuery(host, "lp_position_detail");
    const lpText = formatOperatorQueryPayload(lp).join("\n");
    expect(lpText).toMatch(/0xabc/i);
    expect(lpText).toMatch(/token id:\s*7/i);
    expect(lpText).toMatch(/-10\s*→\s*10/);
    expect(lpText).toMatch(/liquidity:\s*123/i);
    expect(lpText).toMatch(/chain:\s*base/i);
    expect(lpText).toMatch(/protocol:\s*uniswap-v3/i);
    expect(lpText).toMatch(/platform id:\s*plat-uni-1/i);
    expect(lpText).toMatch(/platform:\s*Uniswap V3/i);
    expect(lpText).toMatch(/pair:\s*USDC\/ETH/i);
    expect(lpText).toMatch(/fee tier:\s*3000/i);
    expect(lpText).toMatch(/in range:\s*no/i);
    expect(lpText).toMatch(/current tick:\s*2/i);
    expect(lpText).toMatch(/withdrawable:\s*yes/i);
    expect(lpText).toMatch(/last updated:\s*1710000000/i);

    const portfolioPayload = await runOperatorQuery(host, "portfolio_balances");
    const portfolioText = formatOperatorQueryPayload(portfolioPayload).join("\n");
    expect(portfolioText).toMatch(/portfolio follow-up/i);
    expect(portfolioText).toMatch(/ready:\s*yes/i);
    expect(portfolioText).not.toMatch(/sent:/i);
  });
});
