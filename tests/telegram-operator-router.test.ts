import { describe, expect, it } from "vitest";

import { classifyOperatorTelegramText } from "../src/telegram/operator-router.ts";
import { runOperatorQuery } from "../src/telegram/operator-queries.ts";
import { formatOperatorQueryPayload } from "../src/telegram/operator-formatters.ts";
import { buildOperatorFallbackReply } from "../src/telegram/fallback.ts";

function expectQueryFamily(text: string, family: string) {
  const route = classifyOperatorTelegramText(text);
  expect(route.kind).toBe("query");
  if (route.kind === "query") {
    expect(route.family).toBe(family);
  }
}

describe("telegram operator router", () => {
  it("classifies the eight query families with bounded keyword matching", () => {
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
    expect(text).toMatch(/pending|approval|readiness/i);
    expect(text).toMatch(/portfolio|balance|position/i);
    expect(text).toMatch(/event|guardian|tx/i);
    expect(text).toMatch(/whitelist|policy/i);
    expect(text).toMatch(/risk|assessment/i);
    expect(text).toMatch(/wallet|binding/i);
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
              lpPositionDetail: {
                poolAddress: "0xabc0000000000000000000000000000000000001",
                tokenId: "7",
                tickLower: -10,
                tickUpper: 10,
                liquidity: "123",
                inRange: false,
                withdrawabilitySummary: "No principal while in range; fees only.",
              },
            };
          }
          return { provider: "test", buckets: [] };
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
    expect(lpText).toMatch(/in range:\s*no/i);
  });
});
