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
  it("classifies the seven query families with bounded keyword matching", () => {
    expectQueryFamily("pending approvals?", "readiness_pending");
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
    const host = createPhalanxHost({
      lifecycle: "READY",
      whitelistTargets: ["pool", "whitelist-admin"],
    });

    const readiness = await runOperatorQuery(host, "readiness_pending");
    const readinessText = formatOperatorQueryPayload(readiness).join("\n");
    expect(readinessText).toMatch(/READY|readiness|pending/i);

    const policy = await runOperatorQuery(host, "whitelist_policy");
    const policyText = formatOperatorQueryPayload(policy).join("\n");
    expect(policyText).toMatch(/whitelist|pool/i);
  });
});
